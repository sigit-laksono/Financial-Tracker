import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  createWalletRecurringFeeSchema,
  createWalletSchema,
  reconcileSchema,
  updateWalletRecurringFeeSchema,
  updateWalletSchema,
} from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import {
  appSettings,
  auditLogs,
  categories,
  debtAccounts,
  goals,
  installments,
  recurringRules,
  settlementAllocations,
  transactions,
  transactionSplits,
  walletRecurringFees,
  wallets,
} from "../db/schema";
import { ccCycleForDate, jakartaToday } from "../lib/dates";
import { reopenDebtAccountsIfNeeded } from "../lib/debtEngine";
import { revertGoalContributions } from "../lib/goalLedger";
import { computeLedgerSnapshot, getSettings, reconcileWalletBalance } from "../lib/ledger";

function slugifyWallet(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "dompet"
  );
}

export function createWalletRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const snap = await computeLedgerSnapshot(db);
    return c.json({ wallets: snap.wallets });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createWalletSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data dompet tidak valid." }, 400);
    }

    const existing = await db.select({ key: wallets.key }).from(wallets);
    const keys = new Set(existing.map((w) => w.key));
    const baseKey = slugifyWallet(parsed.data.name);
    let key = baseKey;
    let i = 2;
    while (keys.has(key)) {
      key = `${baseKey}-${i}`;
      i += 1;
    }

    const defaultGroup =
      parsed.data.type === "credit_card"
        ? "credit"
        : parsed.data.type === "cash"
          ? "cash"
          : parsed.data.type === "ewallet"
            ? "ewallet"
            : "bank";
    const defaultProvider = parsed.data.type === "cash" ? "cash" : "other";

    const creditLimit =
      parsed.data.type === "credit_card" ? (parsed.data.creditLimit ?? 20_000_000) : null;
    const cutoffDay = parsed.data.type === "credit_card" ? (parsed.data.cutoffDay ?? 20) : null;
    const initialUsage =
      parsed.data.type === "credit_card" ? (parsed.data.initialUsage ?? 0) : 0;
    if (creditLimit !== null && initialUsage > creditLimit) {
      return c.json({ error: "Pemakaian awal tidak boleh melebihi limit kartu kredit." }, 400);
    }

    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(wallets)
        .values({
          key,
          name: parsed.data.name,
          type: parsed.data.type,
          accountGroup: parsed.data.accountGroup ?? defaultGroup,
          provider: parsed.data.provider ?? defaultProvider,
          role: parsed.data.type === "credit_card" ? "credit_card" : (parsed.data.role ?? "spending"),
          openingBalance: parsed.data.openingBalance,
          creditLimit,
          cutoffDay,
          statementDay: parsed.data.type === "credit_card" ? (parsed.data.statementDay ?? 21) : null,
          paymentDay: parsed.data.type === "credit_card" ? (parsed.data.paymentDay ?? 25) : null,
          accountNumber: parsed.data.accountNumber ?? null,
          color: parsed.data.color,
          sortOrder: existing.length + 1,
          isActive: true,
        })
        .returning();

      if (inserted && inserted.type === "credit_card" && initialUsage > 0) {
        const today = jakartaToday();
        const [lainnyaCat] = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.type, "expense"), eq(categories.name, "Lainnya")))
          .limit(1);

        await tx.insert(transactions).values({
          type: "expense",
          merchant: "Pemakaian Awal Kartu",
          amount: initialUsage,
          transactionDate: today,
          category: lainnyaCat?.name ?? "Lainnya",
          categoryId: lainnyaCat?.id ?? null,
          walletId: inserted.id,
          ccCycleKey: ccCycleForDate(today, cutoffDay ?? 20),
          source: "system",
          note: "Pemakaian awal saat pembuatan kartu kredit",
        });
      }

      return inserted;
    });

    return c.json({ wallet: created }, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID dompet tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateWalletSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data dompet tidak valid." }, 400);
    }

    const [existing] = await db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
    if (!existing) return c.json({ error: "Dompet tidak ditemukan." }, 404);

    if (parsed.data.role !== undefined) {
      if (existing.type === "credit_card" && parsed.data.role !== "credit_card") {
        return c.json({ error: "Dompet kartu kredit harus memiliki peran credit_card." }, 400);
      }
      if (existing.type !== "credit_card" && parsed.data.role === "credit_card") {
        return c.json({ error: "Peran credit_card hanya untuk dompet bertipe kartu kredit." }, 400);
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(wallets)
        .set(parsed.data)
        .where(eq(wallets.id, id))
        .returning();

      if (existing.type === "credit_card") {
        const hasCcConfigUpdate =
          parsed.data.creditLimit !== undefined ||
          parsed.data.cutoffDay !== undefined ||
          parsed.data.statementDay !== undefined ||
          parsed.data.paymentDay !== undefined;

        if (hasCcConfigUpdate) {
          const activeCcWallets = await tx
            .select({ id: wallets.id })
            .from(wallets)
            .where(and(eq(wallets.type, "credit_card"), eq(wallets.isActive, true)));
          // Only sync global fallback settings when this card is the sole active CC.
          if (activeCcWallets.length === 1 && activeCcWallets[0]?.id === id) {
            await tx
              .update(appSettings)
              .set({
                cardLimit: saved!.creditLimit ?? undefined,
                cardCutoffDay: saved!.cutoffDay ?? undefined,
                statementDay: saved!.statementDay ?? undefined,
                cardPaymentDay: saved!.paymentDay ?? undefined,
                updatedAt: new Date(),
              })
              .where(eq(appSettings.id, 1));
          }
        }

        if (parsed.data.cutoffDay !== undefined && parsed.data.cutoffDay !== existing.cutoffDay) {
          const settings = await getSettings(db);
          const nextCutoff = saved!.cutoffDay ?? settings.cardCutoffDay;
          const legacyCutoff = settings.legacySettledBeforeCycle;

          const allCcWallets = await tx
            .select({ id: wallets.id })
            .from(wallets)
            .where(eq(wallets.type, "credit_card"));
          const isSingleCc = allCcWallets.length <= 1;

          const [allocCycles, txSettleCycles, ccExpenseRows] = await Promise.all([
            tx
              .selectDistinct({ ccCycleKey: settlementAllocations.ccCycleKey })
              .from(settlementAllocations)
              .where(
                and(
                  eq(settlementAllocations.targetType, "cc_cycle"),
                  isNotNull(settlementAllocations.ccCycleKey),
                  isSingleCc
                    ? or(
                        eq(settlementAllocations.ccWalletId, id),
                        isNull(settlementAllocations.ccWalletId),
                      )
                    : eq(settlementAllocations.ccWalletId, id),
                ),
              ),
            tx
              .selectDistinct({ ccCycleKey: transactions.ccCycleKey })
              .from(transactions)
              .where(
                and(
                  eq(transactions.type, "settlement"),
                  isNotNull(transactions.ccCycleKey),
                  isSingleCc
                    ? or(eq(transactions.toWalletId, id), isNull(transactions.toWalletId))
                    : eq(transactions.toWalletId, id),
                ),
              ),
            tx
              .select({
                id: transactions.id,
                transactionDate: transactions.transactionDate,
                ccCycleKey: transactions.ccCycleKey,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.walletId, id),
                  eq(transactions.type, "expense"),
                  eq(transactions.isConvertedToInstallment, false),
                ),
              ),
          ]);

          const settledCycles = new Set<string>();
          for (const row of allocCycles) {
            if (row.ccCycleKey) settledCycles.add(row.ccCycleKey);
          }
          for (const row of txSettleCycles) {
            if (row.ccCycleKey) settledCycles.add(row.ccCycleKey);
          }

          for (const txRow of ccExpenseRows) {
            if (
              txRow.ccCycleKey &&
              (settledCycles.has(txRow.ccCycleKey) ||
                (legacyCutoff && txRow.ccCycleKey <= legacyCutoff))
            ) {
              continue;
            }
            const nextCycle = ccCycleForDate(txRow.transactionDate, nextCutoff);
            if (nextCycle !== txRow.ccCycleKey) {
              await tx
                .update(transactions)
                .set({ ccCycleKey: nextCycle, updatedAt: new Date() })
                .where(eq(transactions.id, txRow.id));
            }
          }
        }
      }

      return saved;
    });

    return c.json({ wallet: updated });
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID dompet tidak valid." }, 400);

    const [existing] = await db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
    if (!existing) return c.json({ error: "Dompet tidak ditemukan." }, 404);

    const cascade = c.req.query("cascade") === "true";

    // 1. Count related transactions
    const [txCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(or(eq(transactions.walletId, id), eq(transactions.toWalletId, id)));
    const txCount = Number(txCountRow?.count ?? 0);

    // 2. Count related debts
    const [debtCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(debtAccounts)
      .where(or(eq(debtAccounts.walletId, id), eq(debtAccounts.disburseWalletId, id)));
    const debtCount = Number(debtCountRow?.count ?? 0);

    // 3. Count CC settlement allocations
    const [allocCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(settlementAllocations)
      .where(eq(settlementAllocations.ccWalletId, id));
    const allocCount = Number(allocCountRow?.count ?? 0);

    const totalBlocking = txCount + debtCount + allocCount;

    if (totalBlocking > 0 && !cascade) {
      return c.json(
        {
          error: `Dompet "${existing.name}" memiliki ${txCount} transaksi dan ${debtCount + allocCount} kewajiban/alokasi terkait. Anda dapat mengarsipkan (nonaktifkan) dompet ini, atau konfirmasi hapus beserta riwayat transaksinya.`,
          transactionCount: txCount,
          debtCount: debtCount + allocCount,
          requiresCascade: true,
        },
        400,
      );
    }

    await db.transaction(async (tx) => {
      if (cascade) {
        // 1. Delete allocations for CC wallet
        await tx.delete(settlementAllocations).where(eq(settlementAllocations.ccWalletId, id));

        // 2. Unlink FKs before deleting debt accounts and installments
        const debts = await tx
          .select({ id: debtAccounts.id })
          .from(debtAccounts)
          .where(or(eq(debtAccounts.walletId, id), eq(debtAccounts.disburseWalletId, id)));
        const debtIds = debts.map((d) => d.id);
        if (debtIds.length > 0) {
          const accInsts = await tx
            .select({ id: installments.id })
            .from(installments)
            .where(inArray(installments.accountId, debtIds));
          const instIds = accInsts.map((i) => i.id);

          await tx
            .update(transactions)
            .set({ debtAccountId: null })
            .where(inArray(transactions.debtAccountId, debtIds));
          await tx
            .update(transactions)
            .set({ convertedAccountId: null })
            .where(inArray(transactions.convertedAccountId, debtIds));

          if (instIds.length > 0) {
            await tx
              .update(transactions)
              .set({ installmentId: null })
              .where(inArray(transactions.installmentId, instIds));
            await tx
              .update(settlementAllocations)
              .set({ installmentId: null })
              .where(inArray(settlementAllocations.installmentId, instIds));
          }

          await tx.delete(installments).where(inArray(installments.accountId, debtIds));
          await tx.delete(debtAccounts).where(inArray(debtAccounts.id, debtIds));
        }

        // 3. Revert installments linked to settlement/collection/salary txs, then delete txs & paired fees
        const txs = await tx
          .select({
            id: transactions.id,
            type: transactions.type,
            sourceRef: transactions.sourceRef,
            transferGroupId: transactions.transferGroupId,
          })
          .from(transactions)
          .where(or(eq(transactions.walletId, id), eq(transactions.toWalletId, id)));

        const settlementTxIds = txs
          .filter(
            (t) =>
              t.type === "settlement" ||
              t.type === "debt_collection" ||
              (t.type === "income" && t.sourceRef?.startsWith("salary-")),
          )
          .map((t) => t.id);

        if (settlementTxIds.length > 0) {
          const linkedInsts = await tx
            .select({ accountId: installments.accountId })
            .from(installments)
            .where(inArray(installments.settlementTransactionId, settlementTxIds));
          const affectedAccountIds = [...new Set(linkedInsts.map((i) => i.accountId))];

          await tx
            .update(installments)
            .set({
              status: "upcoming",
              actualAmount: null,
              paidAt: null,
              settlementTransactionId: null,
            })
            .where(inArray(installments.settlementTransactionId, settlementTxIds));

          await reopenDebtAccountsIfNeeded(tx, affectedAccountIds);
        }

        const transferGroupIds = [
          ...new Set(
            txs
              .filter((t) => t.type === "transfer" && Boolean(t.transferGroupId))
              .map((t) => t.transferGroupId!),
          ),
        ];

        const pairedTransferTxs =
          transferGroupIds.length > 0
            ? await tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(inArray(transactions.transferGroupId, transferGroupIds))
            : [];
        const allTxIdsToDelete = [...new Set([...txs.map((t) => t.id), ...pairedTransferTxs.map((t) => t.id)])];

        if (allTxIdsToDelete.length > 0) {
          const deletedRows = await tx
            .select({
              type: transactions.type,
              amount: transactions.amount,
              sourceRef: transactions.sourceRef,
            })
            .from(transactions)
            .where(inArray(transactions.id, allTxIdsToDelete));
          await revertGoalContributions(tx, deletedRows);

          await tx
            .delete(settlementAllocations)
            .where(inArray(settlementAllocations.settlementTransactionId, allTxIdsToDelete));
          await tx
            .delete(transactionSplits)
            .where(inArray(transactionSplits.transactionId, allTxIdsToDelete));
          await tx
            .delete(transactions)
            .where(inArray(transactions.id, allTxIdsToDelete));
        }
      }

      // Disconnect or cleanup non-blocking references
      await tx
        .update(appSettings)
        .set({ defaultSalaryWalletId: null })
        .where(eq(appSettings.defaultSalaryWalletId, id));

      await tx.update(goals).set({ walletId: null }).where(eq(goals.walletId, id));

      await tx.delete(recurringRules).where(eq(recurringRules.walletId, id));
      await tx.delete(walletRecurringFees).where(eq(walletRecurringFees.walletId, id));
      await tx
        .delete(auditLogs)
        .where(and(eq(auditLogs.entityType, "wallet"), eq(auditLogs.entityId, id)));

      // Finally delete the wallet itself
      await tx.delete(wallets).where(eq(wallets.id, id));
    });

    return c.json({ ok: true, message: `Dompet "${existing.name}" berhasil dihapus.` });
  });

  router.post("/:id/reconcile", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID dompet tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = reconcileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Input rekonsiliasi tidak valid." },
        400,
      );
    }

    const result = await reconcileWalletBalance(db, {
      walletId: id,
      actualBalance: parsed.data.actualBalance,
      date: parsed.data.date,
      note: parsed.data.note,
    });
    return c.json({ ok: true, ...result });
  });

  // Recurring fees for credit card wallets
  router.get("/:id/recurring-fees", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID dompet tidak valid." }, 400);

    const fees = await db
      .select()
      .from(walletRecurringFees)
      .where(eq(walletRecurringFees.walletId, id))
      .orderBy(desc(walletRecurringFees.id));

    return c.json({
      fees: fees.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
      })),
    });
  });

  router.post("/:id/recurring-fees", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID dompet tidak valid." }, 400);

    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
    if (!wallet) return c.json({ error: "Dompet tidak ditemukan." }, 404);
    if (wallet.type !== "credit_card") {
      return c.json({ error: "Biaya rutin hanya berlaku untuk dompet kartu kredit." }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createWalletRecurringFeeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data biaya rutin tidak valid." },
        400,
      );
    }

    const [created] = await db
      .insert(walletRecurringFees)
      .values({
        walletId: id,
        name: parsed.data.name,
        amount: parsed.data.amount,
        isActive: parsed.data.isActive,
      })
      .returning();

    return c.json(
      {
        ok: true,
        fee: {
          ...created,
          createdAt: created!.createdAt.toISOString(),
        },
      },
      201,
    );
  });

  router.patch("/:id/recurring-fees/:feeId", async (c) => {
    const id = Number(c.req.param("id"));
    const feeId = Number(c.req.param("feeId"));
    if (!Number.isInteger(id) || !Number.isInteger(feeId)) {
      return c.json({ error: "ID tidak valid." }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateWalletRecurringFeeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data biaya rutin tidak valid." },
        400,
      );
    }

    const [existing] = await db
      .select()
      .from(walletRecurringFees)
      .where(and(eq(walletRecurringFees.id, feeId), eq(walletRecurringFees.walletId, id)))
      .limit(1);
    if (!existing) return c.json({ error: "Biaya rutin tidak ditemukan." }, 404);

    const [updated] = await db
      .update(walletRecurringFees)
      .set(parsed.data)
      .where(eq(walletRecurringFees.id, feeId))
      .returning();

    return c.json({
      ok: true,
      fee: {
        ...updated,
        createdAt: updated!.createdAt.toISOString(),
      },
    });
  });

  router.delete("/:id/recurring-fees/:feeId", async (c) => {
    const id = Number(c.req.param("id"));
    const feeId = Number(c.req.param("feeId"));
    if (!Number.isInteger(id) || !Number.isInteger(feeId)) {
      return c.json({ error: "ID tidak valid." }, 400);
    }

    await db
      .delete(walletRecurringFees)
      .where(and(eq(walletRecurringFees.id, feeId), eq(walletRecurringFees.walletId, id)));

    return c.json({ ok: true });
  });

  return router;
}
