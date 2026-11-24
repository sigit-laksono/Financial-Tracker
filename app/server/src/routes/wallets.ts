import { and, desc, eq, or, sql } from "drizzle-orm";
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
import { computeLedgerSnapshot, reconcileWalletBalance } from "../lib/ledger";

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

    const [created] = await db
      .insert(wallets)
      .values({
        key,
        name: parsed.data.name,
        type: parsed.data.type,
        accountGroup: parsed.data.accountGroup ?? defaultGroup,
        provider: parsed.data.provider ?? defaultProvider,
        role: parsed.data.type === "credit_card" ? "credit_card" : (parsed.data.role ?? "spending"),
        openingBalance: parsed.data.openingBalance,
        creditLimit:
          parsed.data.type === "credit_card" ? (parsed.data.creditLimit ?? 20_000_000) : null,
        cutoffDay: parsed.data.type === "credit_card" ? (parsed.data.cutoffDay ?? 20) : null,
        statementDay: parsed.data.type === "credit_card" ? (parsed.data.statementDay ?? 21) : null,
        paymentDay: parsed.data.type === "credit_card" ? (parsed.data.paymentDay ?? 25) : null,
        accountNumber: parsed.data.accountNumber ?? null,
        color: parsed.data.color,
        sortOrder: existing.length + 1,
        isActive: true,
      })
      .returning();

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

    const [updated] = await db
      .update(wallets)
      .set(parsed.data)
      .where(eq(wallets.id, id))
      .returning();

    if (
      existing.type === "credit_card" &&
      (parsed.data.creditLimit !== undefined ||
        parsed.data.cutoffDay !== undefined ||
        parsed.data.statementDay !== undefined ||
        parsed.data.paymentDay !== undefined)
    ) {
      await db
        .update(appSettings)
        .set({
          cardLimit: updated!.creditLimit ?? undefined,
          cardCutoffDay: updated!.cutoffDay ?? undefined,
          statementDay: updated!.statementDay ?? undefined,
          cardPaymentDay: updated!.paymentDay ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
    }

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
        // Delete allocations for CC wallet
        await tx.delete(settlementAllocations).where(eq(settlementAllocations.ccWalletId, id));

        // Delete debts linked to this wallet
        const debts = await tx
          .select({ id: debtAccounts.id })
          .from(debtAccounts)
          .where(or(eq(debtAccounts.walletId, id), eq(debtAccounts.disburseWalletId, id)));
        for (const d of debts) {
          await tx.delete(installments).where(eq(installments.accountId, d.id));
          await tx.delete(debtAccounts).where(eq(debtAccounts.id, d.id));
        }

        // Delete transactions and their splits/allocations
        const txs = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(or(eq(transactions.walletId, id), eq(transactions.toWalletId, id)));
        for (const t of txs) {
          await tx
            .delete(settlementAllocations)
            .where(eq(settlementAllocations.settlementTransactionId, t.id));
          await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, t.id));
        }
        await tx
          .delete(transactions)
          .where(or(eq(transactions.walletId, id), eq(transactions.toWalletId, id)));
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
