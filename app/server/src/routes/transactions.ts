import { and, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  convertSplitPaySchema,
  createTxSchema,
  isoDateSchema,
  MAX_PG_INT,
  transferSchema,
  updateTxSchema,
} from "../../../shared/src/schemas";
import { TRANSACTION_TYPES } from "../../../shared/src/types";
import type { AppDb } from "../db";
import {
  categories,
  debtAccounts,
  installments,
  recurringRules,
  settlementAllocations,
  transactionSplits,
  transactions,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import { getCreditCardLimitStatus } from "../lib/ccLimit";
import { ccCycleForDate, periodBounds } from "../lib/dates";
import { reopenDebtAccountsIfNeeded } from "../lib/debtEngine";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { lockLedger } from "../lib/ledgerLock";
import { adjustGoalProgress, goalIdFromSourceRef, revertGoalContributions } from "../lib/goalLedger";
import {
  convertTransactionToInstallment,
  createTransferWithOptionalFee,
  getSettings,
} from "../lib/ledger";

const listQuerySchema = z.object({
  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
  walletId: z.coerce.number().int().positive().max(MAX_PG_INT).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursorDate: isoDateSchema.optional(),
  cursorId: z.coerce.number().int().positive().max(MAX_PG_INT).optional(),
});

export function createTransactionRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const parsed = listQuerySchema.safeParse({
      start: c.req.query("start") || undefined,
      end: c.req.query("end") || undefined,
      walletId: c.req.query("walletId") || undefined,
      type: c.req.query("type") || undefined,
      category: c.req.query("category") || undefined,
      search: c.req.query("search") || undefined,
      limit: c.req.query("limit") || undefined,
      cursorDate: c.req.query("cursorDate") || undefined,
      cursorId: c.req.query("cursorId") || undefined,
    });
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Filter transaksi tidak valid." },
        400,
      );
    }

    const q = parsed.data;
    const baseFilters: SQL[] = [];
    if (q.start) baseFilters.push(gte(transactions.transactionDate, q.start));
    if (q.end) baseFilters.push(lte(transactions.transactionDate, q.end));
    if (q.walletId) {
      baseFilters.push(
        or(eq(transactions.walletId, q.walletId), eq(transactions.toWalletId, q.walletId))!,
      );
    }
    if (q.type) baseFilters.push(eq(transactions.type, q.type));
    if (q.category) baseFilters.push(eq(transactions.category, q.category));
    if (q.search) {
      const pattern = `%${q.search.toLowerCase()}%`;
      baseFilters.push(
        or(
          sql`LOWER(${transactions.merchant}) LIKE ${pattern}`,
          sql`LOWER(${transactions.category}) LIKE ${pattern}`,
          sql`LOWER(COALESCE(${transactions.note}, '')) LIKE ${pattern}`,
        )!,
      );
    }

    const whereBase = baseFilters.length > 0 ? and(...baseFilters) : undefined;
    const cursorFilter =
      q.cursorDate && q.cursorId
        ? or(
            lt(transactions.transactionDate, q.cursorDate),
            and(eq(transactions.transactionDate, q.cursorDate), lt(transactions.id, q.cursorId)),
          )
        : undefined;
    const wherePaginated =
      whereBase && cursorFilter ? and(whereBase, cursorFilter) : (cursorFilter ?? whereBase);

    const [walletRows, settings, countRow, rows] = await Promise.all([
      db.select().from(wallets),
      getSettings(db),
      db.select({ count: sql<number>`COUNT(*)` }).from(transactions).where(whereBase),
      db
        .select()
        .from(transactions)
        .where(wherePaginated)
        .orderBy(desc(transactions.transactionDate), desc(transactions.id))
        .limit(q.limit + 1),
    ]);

    const hasMore = rows.length > q.limit;
    const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow ? { cursorDate: lastRow.transactionDate, cursorId: lastRow.id } : null;

    const walletById = new Map(walletRows.map((w) => [w.id, w]));
    const ccWallets = walletRows.filter((w) => w.type === "credit_card");
    const ccWalletMap = new Map(ccWallets.map((w) => [w.id, w]));

    const unbilledStartByWalletId = new Map<number, string>();
    if (q.end) {
      for (const card of ccWallets) {
        const cutoff = card.cutoffDay ?? settings.cardCutoffDay;
        const endCcCycle = ccCycleForDate(q.end, cutoff);
        const endCcBounds = periodBounds(endCcCycle, "cc", settings.gajianStartDay, cutoff);
        if (q.end < endCcBounds.end) {
          const startKey = q.start && endCcBounds.start < q.start ? q.start : endCcBounds.start;
          unbilledStartByWalletId.set(card.id, startKey);
        }
      }
    }

    const pageTxIds = pageRows.map((tx) => tx.id);
    const transferGroupIds = pageRows
      .map((tx) => tx.transferGroupId)
      .filter((gid): gid is string => Boolean(gid));

    const [splitRows, feeRows] = await Promise.all([
      pageTxIds.length > 0
        ? db
            .select()
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, pageTxIds))
        : [],
      transferGroupIds.length > 0
        ? db
            .select()
            .from(transactions)
            .where(
              and(
                inArray(transactions.transferGroupId, transferGroupIds),
                eq(transactions.type, "expense"),
                eq(transactions.category, "Biaya Bank"),
              ),
            )
        : [],
    ]);

    const splitsByTxId = new Map<
      number,
      Array<{
        id: number;
        category: string;
        categoryId: number | null;
        amount: number;
        note: string | null;
      }>
    >();
    for (const s of splitRows) {
      const arr = splitsByTxId.get(s.transactionId) ?? [];
      arr.push({
        id: s.id,
        category: s.category,
        categoryId: s.categoryId,
        amount: s.amount,
        note: s.note,
      });
      splitsByTxId.set(s.transactionId, arr);
    }

    const feeByGroupId = new Map<string, { id: number; amount: number }>();
    for (const f of feeRows) {
      if (f.transferGroupId) {
        feeByGroupId.set(f.transferGroupId, { id: f.id, amount: f.amount });
      }
    }

    const items = pageRows.map((tx) => {
      const srcWallet = walletById.get(tx.walletId);
      const dstWallet = tx.toWalletId ? walletById.get(tx.toWalletId) : null;
      const card = ccWalletMap.get(tx.walletId);
      const cardUnbilledStartKey = card ? unbilledStartByWalletId.get(card.id) : null;
      const isUnbilledCc = Boolean(
        card &&
          cardUnbilledStartKey &&
          tx.type === "expense" &&
          !tx.isConvertedToInstallment &&
          tx.transactionDate >= cardUnbilledStartKey &&
          (!q.end || tx.transactionDate <= q.end),
      );
      const linkedFeeTransaction =
        tx.transferGroupId && tx.type === "transfer"
          ? (feeByGroupId.get(tx.transferGroupId) ?? null)
          : null;
      return {
        ...tx,
        walletName: srcWallet?.name ?? "Dompet",
        walletType: srcWallet?.type ?? "bank",
        toWalletName: dstWallet?.name ?? null,
        isUnbilledCc,
        splits: splitsByTxId.get(tx.id) ?? undefined,
        linkedFeeTransaction,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      };
    });

    return c.json({
      items,
      nextCursor,
      totalCount: Number(countRow[0]?.count ?? 0),
    });
  });

  router.get("/quick-presets", async (c) => {
    const q = c.req.query("q")?.trim().toLowerCase();
    const [txRows, transferRows, walletRows] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(
          and(
            or(eq(transactions.type, "expense"), eq(transactions.type, "income")),
            ne(transactions.source, "system"),
          ),
        )
        .orderBy(desc(transactions.transactionDate), desc(transactions.id))
        .limit(300),
      db
        .select()
        .from(transactions)
        .where(and(eq(transactions.type, "transfer"), ne(transactions.source, "system")))
        .orderBy(desc(transactions.transactionDate), desc(transactions.id))
        .limit(100),
      db.select().from(wallets).where(eq(wallets.isActive, true)),
    ]);

    const walletMap = new Map(walletRows.map((w) => [w.id, w]));

    const merchantMap = new Map<
      string,
      {
        merchant: string;
        category: string;
        walletId: number;
        type: "expense" | "income";
        amount: number;
        count: number;
      }
    >();

    for (const tx of txRows) {
      if (tx.source === "system" || !walletMap.has(tx.walletId)) continue;
      const norm = tx.merchant.trim().toLowerCase();
      if (!norm) continue;
      const existing = merchantMap.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        merchantMap.set(norm, {
          merchant: tx.merchant.trim(),
          category: tx.category,
          walletId: tx.walletId,
          type: tx.type as "expense" | "income",
          amount: tx.amount,
          count: 1,
        });
      }
    }

    const sortedMerchants = Array.from(merchantMap.values()).sort((a, b) => b.count - a.count);

    // A merchant becomes a template only after MIN_TEMPLATE_USES transactions;
    // expense and income each get their own top-6 so one type cannot crowd out the other.
    const MIN_TEMPLATE_USES = 5;
    const TEMPLATES_PER_TYPE = 6;
    const frequent = sortedMerchants.filter((m) => m.count >= MIN_TEMPLATE_USES);
    const frequentTemplates = [
      ...frequent.filter((m) => m.type === "expense").slice(0, TEMPLATES_PER_TYPE),
      ...frequent.filter((m) => m.type === "income").slice(0, TEMPLATES_PER_TYPE),
    ].map((m) => ({
      merchant: m.merchant,
      type: m.type,
      category: m.category,
      walletId: m.walletId,
      walletName: walletMap.get(m.walletId)?.name ?? "Dompet",
      suggestedAmount: m.amount,
      count: m.count,
    }));

    let merchantSuggestions = sortedMerchants.map((m) => ({
      merchant: m.merchant,
      category: m.category,
      walletId: m.walletId,
      type: m.type,
      lastUsedAmount: m.amount,
    }));
    if (q) {
      merchantSuggestions = merchantSuggestions.filter((m) => m.merchant.toLowerCase().includes(q));
    }

    const routeMap = new Map<
      string,
      {
        fromWalletId: number;
        toWalletId: number;
        count: number;
      }
    >();

    for (const t of transferRows) {
      if (t.source === "system" || !t.toWalletId) continue;
      if (!walletMap.has(t.walletId) || !walletMap.has(t.toWalletId)) continue;
      const key = `${t.walletId}->${t.toWalletId}`;
      const ex = routeMap.get(key);
      if (ex) {
        ex.count += 1;
      } else {
        routeMap.set(key, {
          fromWalletId: t.walletId,
          toWalletId: t.toWalletId,
          count: 1,
        });
      }
    }

    const frequentTransferRoutes: Array<{
      fromWalletId: number;
      fromWalletName: string;
      toWalletId: number;
      toWalletName: string;
      adminFee: number;
      count: number;
    }> = [];

    for (const r of Array.from(routeMap.values()).sort((a, b) => b.count - a.count)) {
      const fromW = walletMap.get(r.fromWalletId);
      const toW = walletMap.get(r.toWalletId);
      if (fromW && toW) {
        frequentTransferRoutes.push({
          fromWalletId: r.fromWalletId,
          fromWalletName: fromW.name,
          toWalletId: r.toWalletId,
          toWalletName: toW.name,
          adminFee: 0,
          count: r.count,
        });
      }
    }

    if (frequentTransferRoutes.length < 3) {
      const spendWallets = walletRows.filter((w) => w.type !== "credit_card" && w.isActive);
      if (spendWallets.length >= 2) {
        const primary = spendWallets.find((w) => w.type === "bank") ?? spendWallets[0]!;
        const others = spendWallets.filter((w) => w.id !== primary.id);
        for (const other of others) {
          if (frequentTransferRoutes.length >= 3) break;
          const exists = frequentTransferRoutes.some(
            (r) => r.fromWalletId === primary.id && r.toWalletId === other.id,
          );
          if (!exists) {
            frequentTransferRoutes.push({
              fromWalletId: primary.id,
              fromWalletName: primary.name,
              toWalletId: other.id,
              toWalletName: other.name,
              adminFee: other.type === "ewallet" ? 1000 : 0,
              count: 0,
            });
          }
        }
      }
    }

    return c.json({
      frequentTemplates,
      merchantSuggestions,
      frequentTransferRoutes: frequentTransferRoutes.slice(0, 4),
    });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createTxSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data transaksi tidak valid." },
        400,
      );
    }

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, parsed.data.walletId))
      .limit(1);
    if (!wallet) return c.json({ error: "Dompet tidak ditemukan." }, 404);
    if (wallet.type === "credit_card" && parsed.data.type === "income") {
      return c.json({ error: "Pemasukan tidak dapat dicatat ke dompet kartu kredit." }, 400);
    }

    const allCats = await db.select().from(categories).where(eq(categories.type, parsed.data.type));
    const matchedCategory = allCats.find(
      (cat) => cat.name.trim().toLowerCase() === parsed.data.category.toLowerCase(),
    );
    if (!matchedCategory) {
      return c.json({ error: "Kategori tidak ditemukan untuk tipe transaksi ini." }, 400);
    }

    const splits = parsed.data.splits;
    if (splits && splits.length > 0) {
      const sumSplits = splits.reduce((sum, s) => sum + s.amount, 0);
      if (sumSplits !== parsed.data.amount) {
        return c.json(
          { error: "Total pecahan kategori harus sama persis dengan nominal transaksi." },
          400,
        );
      }
      for (const s of splits) {
        const found = allCats.find(
          (cat) => cat.name.trim().toLowerCase() === s.category.trim().toLowerCase(),
        );
        if (!found) {
          return c.json(
            { error: `Kategori '${s.category}' tidak ditemukan untuk tipe transaksi ini.` },
            400,
          );
        }
      }
    }

    const firstSplit = splits && splits.length > 0 ? splits[0] : undefined;
    const primaryCategory = firstSplit ? firstSplit.category : matchedCategory.name;
    const primaryCategoryId = firstSplit
      ? (allCats.find(
          (cat) => cat.name.trim().toLowerCase() === firstSplit.category.trim().toLowerCase(),
        )?.id ?? matchedCategory.id)
      : matchedCategory.id;

    const sourceRef = parsed.data.sourceRef?.trim() || null;
    const settings = await getSettings(db);
    const cutoff = wallet.cutoffDay ?? settings.cardCutoffDay;
    const ccCycleKey =
      wallet.type === "credit_card" ? ccCycleForDate(parsed.data.transactionDate, cutoff) : null;

    const insertedId = await db.transaction(async (tx) => {
      await lockLedger(tx);
      if (parsed.data.type === "expense" && wallet.type === "credit_card") {
        const limitStatus = await getCreditCardLimitStatus(tx, wallet.id);
        if (parsed.data.amount > limitStatus.availableLimit) {
          throw new ValidationError(
            `Transaksi melebihi sisa limit ${limitStatus.walletName} (Sisa limit: Rp${limitStatus.availableLimit.toLocaleString("id-ID")}, Terpakai: Rp${limitStatus.limitUsed.toLocaleString("id-ID")} dari Rp${limitStatus.creditLimit.toLocaleString("id-ID")}).`,
          );
        }
      }

      const [inserted] = await tx
        .insert(transactions)
        .values({
          type: parsed.data.type,
          merchant: parsed.data.merchant,
          amount: parsed.data.amount,
          transactionDate: parsed.data.transactionDate,
          category: primaryCategory,
          categoryId: primaryCategoryId,
          walletId: wallet.id,
          note: parsed.data.note?.trim() || null,
          ccCycleKey,
          source: parsed.data.source,
          sourceRef,
        })
        .onConflictDoNothing({ target: transactions.sourceRef })
        .returning({ id: transactions.id });

      if (!inserted) return null;

      if (splits && splits.length > 0) {
        for (const s of splits) {
          const cat = allCats.find(
            (c) => c.name.trim().toLowerCase() === s.category.trim().toLowerCase(),
          );
          await tx
            .insert(transactionSplits)
            .values({
              transactionId: inserted.id,
              category: cat?.name ?? s.category,
              categoryId: cat?.id ?? null,
              amount: s.amount,
              note: s.note?.trim() || null,
            });
        }
      }

      return inserted.id;
    });

    if (insertedId) {
      return c.json({ ok: true, id: insertedId, duplicate: false }, 201);
    }

    if (sourceRef) {
      const [existing] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.sourceRef, sourceRef))
        .limit(1);
      if (existing) {
        return c.json({ ok: true, id: existing.id, duplicate: true });
      }
    }

    return c.json({ error: "Gagal menyimpan transaksi." }, 500);
  });

  router.post("/transfer", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data transfer tidak valid." },
        400,
      );
    }

    const result = await createTransferWithOptionalFee(db, parsed.data);
    return c.json({ ok: true, ...result }, 201);
  });

  const handleUpdate = async (c: import("hono").Context) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID transaksi tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateTxSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data edit tidak valid." }, 400);
    }

    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!existing) return c.json({ error: "Transaksi tidak ditemukan." }, 404);

    if (existing.type === "transfer") {
      if (parsed.data.type !== undefined && parsed.data.type !== "transfer") {
        return c.json(
          { error: "Transaksi transfer tidak dapat diubah menjadi pemasukan atau pengeluaran." },
          400,
        );
      }

      const nextFromWalletId = parsed.data.walletId ?? existing.walletId;
      const nextToWalletId = parsed.data.toWalletId ?? existing.toWalletId;
      if (!nextToWalletId || nextFromWalletId === nextToWalletId) {
        return c.json({ error: "Dompet asal dan tujuan tidak boleh sama." }, 400);
      }
      const [fromW] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, nextFromWalletId))
        .limit(1);
      const [toW] = await db.select().from(wallets).where(eq(wallets.id, nextToWalletId)).limit(1);
      if (!fromW || !toW) return c.json({ error: "Dompet tidak ditemukan." }, 404);
      if (fromW.type === "credit_card" || toW.type === "credit_card") {
        return c.json(
          { error: "Transfer hanya berlaku antar dompet kas, bank, atau e-wallet." },
          400,
        );
      }

      const nextAmount = parsed.data.amount ?? existing.amount;
      const nextDate = parsed.data.transactionDate ?? existing.transactionDate;
      // Keep the stored label (e.g. "Setor Target: ...") unless the user typed a new one.
      const nextMerchant = parsed.data.merchant?.trim() || existing.merchant || `Transfer ke ${toW.name}`;
      const nextNote =
        parsed.data.note !== undefined ? parsed.data.note?.trim() || null : existing.note;

      await db.transaction(async (tx) => {
        await lockLedger(tx);
        const needsNewGroupId =
          !existing.transferGroupId &&
          parsed.data.adminFee !== undefined &&
          parsed.data.adminFee > 0;
        const effectiveGroupId = existing.transferGroupId ?? (needsNewGroupId ? crypto.randomUUID() : null);

        await tx
          .update(transactions)
          .set({
            merchant: nextMerchant,
            amount: nextAmount,
            transactionDate: nextDate,
            walletId: nextFromWalletId,
            toWalletId: nextToWalletId,
            transferGroupId: effectiveGroupId,
            note: nextNote,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, id));

        // A goal contribution's amount is also the goal's progress; keep them in step.
        const goalId = goalIdFromSourceRef(existing.sourceRef);
        if (goalId !== null) {
          await adjustGoalProgress(tx, goalId, nextAmount - existing.amount);
        }

        if (effectiveGroupId) {
          const [feeRow] = await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.transferGroupId, effectiveGroupId),
                eq(transactions.type, "expense"),
              ),
            )
            .limit(1);

          if (parsed.data.adminFee !== undefined) {
            if (parsed.data.adminFee === 0) {
              if (feeRow) {
                await tx.delete(transactions).where(eq(transactions.id, feeRow.id));
              }
            } else {
              if (feeRow) {
                await tx
                  .update(transactions)
                  .set({
                    amount: parsed.data.adminFee,
                    transactionDate: nextDate,
                    walletId: nextFromWalletId,
                    merchant: `Biaya admin transfer ke ${toW.name}`,
                    note: `Biaya admin untuk transfer Rp${nextAmount.toLocaleString("id-ID")}`,
                    updatedAt: new Date(),
                  })
                  .where(eq(transactions.id, feeRow.id));
              } else {
                const [feeCategory] = await tx
                  .select({ id: categories.id })
                  .from(categories)
                  .where(and(eq(categories.type, "expense"), eq(categories.name, "Biaya Bank")))
                  .limit(1);

                await tx
                  .insert(transactions)
                  .values({
                    type: "expense",
                    merchant: `Biaya admin transfer ke ${toW.name}`,
                    amount: parsed.data.adminFee,
                    transactionDate: nextDate,
                    category: "Biaya Bank",
                    categoryId: feeCategory?.id ?? null,
                    walletId: nextFromWalletId,
                    transferGroupId: effectiveGroupId,
                    note: `Biaya admin untuk transfer Rp${nextAmount.toLocaleString("id-ID")}`,
                    source: "manual",
                  });
              }
            }
          } else if (feeRow) {
            await tx
              .update(transactions)
              .set({
                transactionDate: nextDate,
                walletId: nextFromWalletId,
                merchant: `Biaya admin transfer ke ${toW.name}`,
                updatedAt: new Date(),
              })
              .where(eq(transactions.id, feeRow.id));
          }
        }

        await recordAuditLog(tx, {
          entityType: "transaction",
          entityId: id,
          action: "update",
          before: {
            type: existing.type,
            merchant: existing.merchant,
            amount: existing.amount,
            transactionDate: existing.transactionDate,
            walletId: existing.walletId,
            toWalletId: existing.toWalletId,
          },
          after: {
            type: existing.type,
            merchant: nextMerchant,
            amount: nextAmount,
            transactionDate: nextDate,
            walletId: nextFromWalletId,
            toWalletId: nextToWalletId,
          },
        });
      });

      return c.json({ ok: true });
    }

    if (existing.type !== "expense" && existing.type !== "income") {
      return c.json(
        { error: "Transaksi pelunasan atau penyesuaian tidak dapat diedit langsung." },
        400,
      );
    }

    if (parsed.data.type === "transfer") {
      return c.json(
        { error: "Transaksi pemasukan atau pengeluaran tidak dapat diubah menjadi transfer." },
        400,
      );
    }

    if (existing.isConvertedToInstallment) {
      const mutatesFinancialFacts =
        (parsed.data.amount !== undefined && parsed.data.amount !== existing.amount) ||
        (parsed.data.walletId !== undefined && parsed.data.walletId !== existing.walletId) ||
        (parsed.data.type !== undefined && parsed.data.type !== existing.type) ||
        (parsed.data.transactionDate !== undefined &&
          parsed.data.transactionDate !== existing.transactionDate);
      if (mutatesFinancialFacts) {
        return c.json(
          {
            error: "Transaksi Split Pay tidak dapat diubah nominal, tanggal, tipe, atau dompetnya.",
          },
          409,
        );
      }
    }

    const nextType =
      (parsed.data.type as "expense" | "income" | undefined) ??
      (existing.type as "expense" | "income");
    const nextCategory = parsed.data.category ?? existing.category;
    const nextWalletId = parsed.data.walletId ?? existing.walletId;
    const nextDate = parsed.data.transactionDate ?? existing.transactionDate;
    const nextAmount = parsed.data.amount ?? existing.amount;
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, nextWalletId)).limit(1);
    if (!wallet) return c.json({ error: "Dompet tidak ditemukan." }, 404);
    if (wallet.type === "credit_card" && nextType === "income") {
      return c.json({ error: "Pemasukan tidak dapat dicatat ke dompet kartu kredit." }, 400);
    }

    const allCats = await db.select().from(categories).where(eq(categories.type, nextType));

    let canonicalCategory = nextCategory;
    let nextCategoryId = existing.categoryId;
    if (parsed.data.category !== undefined || parsed.data.type !== undefined) {
      const matchedCategory = allCats.find(
        (cat) => cat.name.trim().toLowerCase() === nextCategory.trim().toLowerCase(),
      );
      if (!matchedCategory) {
        return c.json({ error: "Kategori tidak ditemukan untuk tipe transaksi ini." }, 400);
      }
      canonicalCategory = matchedCategory.name;
      nextCategoryId = matchedCategory.id;
    }

    const splits = parsed.data.splits;
    const existingSplits = await db
      .select({ id: transactionSplits.id })
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, id));
    const hasExistingSplits = existingSplits.length > 0;
    let shouldClearSplits = false;

    if (splits === undefined && hasExistingSplits) {
      if (parsed.data.amount !== undefined && parsed.data.amount !== existing.amount) {
        return c.json(
          { error: "Nominal transaksi dengan pecahan kategori hanya dapat diubah bersama daftar pecahan terbaru." },
          400,
        );
      }
      const typeChangedToIncome = nextType === "income" && existing.type !== "income";
      const categoryExplicitlyChanged =
        parsed.data.category !== undefined &&
        canonicalCategory.trim().toLowerCase() !== existing.category.trim().toLowerCase();
      if (typeChangedToIncome || categoryExplicitlyChanged) {
        shouldClearSplits = true;
      }
    }

    if (splits !== undefined && splits.length > 0) {
      const sumSplits = splits.reduce((sum, s) => sum + s.amount, 0);
      if (sumSplits !== nextAmount) {
        return c.json(
          { error: "Total pecahan kategori harus sama persis dengan nominal transaksi." },
          400,
        );
      }
      for (const s of splits) {
        const found = allCats.find(
          (cat) => cat.name.trim().toLowerCase() === s.category.trim().toLowerCase(),
        );
        if (!found) {
          return c.json(
            { error: `Kategori '${s.category}' tidak ditemukan untuk tipe transaksi ini.` },
            400,
          );
        }
      }
      const firstSplit = splits[0];
      if (firstSplit) {
        canonicalCategory = firstSplit.category;
        nextCategoryId =
          allCats.find(
            (c) => c.name.trim().toLowerCase() === firstSplit.category.trim().toLowerCase(),
          )?.id ?? null;
      }
    }

    const settings = await getSettings(db);
    const ccCycleKey =
      wallet.type === "credit_card"
        ? ccCycleForDate(nextDate, wallet.cutoffDay ?? settings.cardCutoffDay)
        : null;

    await db.transaction(async (tx) => {
      await lockLedger(tx);
      if (nextType === "expense" && wallet.type === "credit_card" && !existing.isConvertedToInstallment && ccCycleKey) {
        const limitStatus = await getCreditCardLimitStatus(tx, wallet.id);
        const oldCycle =
          existing.type === "expense" &&
          existing.walletId === wallet.id &&
          !existing.isConvertedToInstallment
            ? existing.ccCycleKey
            : null;
        const cyclesToCheck = [...new Set([oldCycle, ccCycleKey].filter((c): c is string => Boolean(c)))];
        const allCcRows = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(eq(wallets.type, "credit_card"));
        const isSingleCc = allCcRows.length <= 1;

        let deltaLimit = 0;
        for (const cKey of cyclesToCheck) {
          const isLegacy = Boolean(
            settings.legacySettledBeforeCycle && cKey <= settings.legacySettledBeforeCycle,
          );
          if (isLegacy) continue;

          const [spendRow] = await tx
            .select({ total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
            .from(transactions)
            .where(
              and(
                eq(transactions.walletId, wallet.id),
                eq(transactions.type, "expense"),
                eq(transactions.isConvertedToInstallment, false),
                eq(transactions.ccCycleKey, cKey),
              ),
            );
          const [settledRow] = await tx
            .select({ total: sql<number>`COALESCE(SUM(${settlementAllocations.allocatedAmount}), 0)` })
            .from(settlementAllocations)
            .where(
              and(
                eq(settlementAllocations.targetType, "cc_cycle"),
                eq(settlementAllocations.ccCycleKey, cKey),
                isSingleCc
                  ? or(
                      eq(settlementAllocations.ccWalletId, wallet.id),
                      isNull(settlementAllocations.ccWalletId),
                    )
                  : eq(settlementAllocations.ccWalletId, wallet.id),
              ),
            );
          const spendBefore = Number(spendRow?.total ?? 0);
          const settled = Number(settledRow?.total ?? 0);
          const unpaidBefore = Math.max(0, spendBefore - settled);
          const spendAfter =
            spendBefore -
            (cKey === oldCycle ? existing.amount : 0) +
            (cKey === ccCycleKey ? nextAmount : 0);
          const unpaidAfter = Math.max(0, spendAfter - settled);
          deltaLimit += unpaidAfter - unpaidBefore;
        }

        const nextLimitUsed = limitStatus.limitUsed + deltaLimit;
        if (deltaLimit > 0 && nextLimitUsed > limitStatus.creditLimit) {
          const effectiveAvailable = Math.max(0, limitStatus.creditLimit - (limitStatus.limitUsed - (oldCycle === ccCycleKey ? existing.amount : 0)));
          throw new ValidationError(
            `Transaksi melebihi sisa limit ${limitStatus.walletName} (Sisa limit tersedia: Rp${effectiveAvailable.toLocaleString("id-ID")}, Limit kartu: Rp${limitStatus.creditLimit.toLocaleString("id-ID")}).`,
          );
        }
      }

      await tx
        .update(transactions)
        .set({
          merchant: parsed.data.merchant ?? existing.merchant,
          amount: nextAmount,
          transactionDate: nextDate,
          walletId: nextWalletId,
          type: nextType,
          category: canonicalCategory,
          categoryId: nextCategoryId,
          note: parsed.data.note !== undefined ? parsed.data.note : existing.note,
          ccCycleKey,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, id));

      if (shouldClearSplits) {
        await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
      } else if (splits !== undefined) {
        await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
        if (splits.length > 0) {
          for (const s of splits) {
            const found = allCats.find(
              (c) => c.name.trim().toLowerCase() === s.category.trim().toLowerCase(),
            );
            await tx
              .insert(transactionSplits)
              .values({
                transactionId: id,
                category: found?.name ?? s.category,
                categoryId: found?.id ?? null,
                amount: s.amount,
                note: s.note?.trim() || null,
              });
          }
        }
      }

      await recordAuditLog(tx, {
        entityType: "transaction",
        entityId: id,
        action: "update",
        before: {
          type: existing.type,
          merchant: existing.merchant,
          amount: existing.amount,
          transactionDate: existing.transactionDate,
          category: existing.category,
          walletId: existing.walletId,
        },
        after: {
          type: nextType,
          merchant: parsed.data.merchant ?? existing.merchant,
          amount: nextAmount,
          transactionDate: nextDate,
          category: canonicalCategory,
          walletId: nextWalletId,
        },
      });
    });

    return c.json({ ok: true });
  };

  router.patch("/:id", handleUpdate);
  router.put("/:id", handleUpdate);

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID transaksi tidak valid." }, 400);

    await db.transaction(async (tx) => {
      await lockLedger(tx);
      const [existing] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))
        .limit(1);
      if (!existing) throw new NotFoundError("Transaksi tidak ditemukan.");

      if (existing.isConvertedToInstallment && existing.convertedAccountId) {
        const [linkedAccount] = await tx
          .select({ id: debtAccounts.id })
          .from(debtAccounts)
          .where(eq(debtAccounts.id, existing.convertedAccountId))
          .limit(1);
        if (linkedAccount) {
          throw new ConflictError(
            "Transaksi sudah menjadi akun cicilan Split Pay. Hapus atau tutup akun cicilannya terlebih dahulu.",
          );
        }
      }

      if (
        existing.type === "settlement" ||
        existing.type === "debt_collection" ||
        (existing.type === "income" && existing.sourceRef?.startsWith("salary-"))
      ) {
        const linkedInstallments = await tx
          .select({ accountId: installments.accountId })
          .from(installments)
          .where(eq(installments.settlementTransactionId, id));
        const affectedAccountIds = [...new Set(linkedInstallments.map((i) => i.accountId))];

        await tx
          .update(installments)
          .set({
            status: "upcoming",
            actualAmount: null,
            paidAt: null,
            settlementTransactionId: null,
          })
          .where(eq(installments.settlementTransactionId, id));

        await tx
          .delete(settlementAllocations)
          .where(eq(settlementAllocations.settlementTransactionId, id));

        await reopenDebtAccountsIfNeeded(tx, affectedAccountIds);
      }

      if (existing.type === "transfer" && existing.transferGroupId) {
        await tx
          .delete(transactions)
          .where(eq(transactions.transferGroupId, existing.transferGroupId));
      } else {
        await tx.delete(transactions).where(eq(transactions.id, id));
      }

      if (existing.sourceRef?.startsWith("recurring-")) {
        const match = /^recurring-(\d+)-(\d{4}-\d{2})$/.exec(existing.sourceRef);
        if (match) {
          const ruleId = Number(match[1]);
          const remainingRecurring = await tx
            .select({ sourceRef: transactions.sourceRef })
            .from(transactions)
            .where(like(transactions.sourceRef, `recurring-${ruleId}-%`));
          const remainingPeriods = remainingRecurring
            .map((r) => {
              const m = /^recurring-\d+-(\d{4}-\d{2})$/.exec(r.sourceRef ?? "");
              return m ? m[1]! : null;
            })
            .filter((p): p is string => Boolean(p))
            .sort();
          const nextLastPaidPeriod =
            remainingPeriods.length > 0 ? remainingPeriods[remainingPeriods.length - 1]! : null;
          await tx
            .update(recurringRules)
            .set({ lastPaidPeriod: nextLastPaidPeriod })
            .where(eq(recurringRules.id, ruleId));
        }
      }

      if (existing.sourceRef?.startsWith("goal:") && existing.type === "transfer") {
        await revertGoalContributions(tx, [existing]);
      }

      await recordAuditLog(tx, {
        entityType: "transaction",
        entityId: id,
        action: "delete",
        before: {
          type: existing.type,
          merchant: existing.merchant,
          amount: existing.amount,
          transactionDate: existing.transactionDate,
          category: existing.category,
          walletId: existing.walletId,
          transferGroupId: existing.transferGroupId,
        },
        after: null,
      });
    });

    return c.json({ ok: true });
  });

  router.post("/:id/convert-to-installment", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID transaksi tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = convertSplitPaySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data Split Pay tidak valid." },
        400,
      );
    }

    const result = await convertTransactionToInstallment(db, {
      transactionId: id,
      ...parsed.data,
    });
    return c.json({ ok: true, ...result }, 201);
  });

  return router;
}
