import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  closeDebtSchema,
  createDebtSchema,
  earlyPayoffSchema,
  settleSchema,
  unsettleSchema,
  updateDebtSchema,
  updateInstallmentSchema,
} from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import {
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import { getCreditCardLimitStatus } from "../lib/ccLimit";
import { ccCycleForDate } from "../lib/dates";
import { NotFoundError, ValidationError } from "../lib/errors";
import { lockLedger } from "../lib/ledgerLock";
import {
  buildDebtsData,
  createDebtAccountWithSchedule,
  earlyPayoffDebtAccount,
  getSettings,
  settleObligations,
  unsettleInstallment,
  updateDebtAccountWithSchedule,
} from "../lib/ledger";

export function createDebtRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const data = await buildDebtsData(db);
    return c.json(data);
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createDebtSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data utang tidak valid." }, 400);
    }

    const result = await createDebtAccountWithSchedule(db, parsed.data);
    return c.json({ ok: true, ...result }, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "ID akun utang tidak valid." }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateDebtSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data edit utang tidak valid." }, 400);
    }

    const result = await updateDebtAccountWithSchedule(db, id, parsed.data);
    return c.json(result);
  });

  router.post("/:id/payoff", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID akun utang tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = earlyPayoffSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data pelunasan dipercepat tidak valid." },
        400,
      );
    }

    const result = await earlyPayoffDebtAccount(db, id, parsed.data);
    return c.json(result);
  });

  router.patch("/:id/close", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID akun utang tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = closeDebtSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Status tutup akun tidak valid." }, 400);
    }

    await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(debtAccounts)
        .where(eq(debtAccounts.id, id))
        .limit(1);
      if (!account) throw new NotFoundError("Akun utang tidak ditemukan.");

      if (parsed.data.closed) {
        const accountInstallments = await tx
          .select()
          .from(installments)
          .where(eq(installments.accountId, account.id));
        const paidAmount = accountInstallments
          .filter((item) => item.status === "paid")
          .reduce((sum, item) => sum + (item.actualAmount ?? item.plannedAmount), 0);
        const totalPlanned = accountInstallments.reduce((sum, item) => sum + item.plannedAmount, 0);
        const targetObligation = Math.max(account.initialBalance, totalPlanned);
        if (targetObligation - paidAmount > 0) {
          throw new ValidationError("Akun hanya bisa ditutup setelah lunas (sisa Rp0).");
        }
        if (!account.closedAt) {
          await tx
            .update(debtAccounts)
            .set({ closedAt: new Date() })
            .where(eq(debtAccounts.id, account.id));
        }
      } else if (account.closedAt) {
        await tx
          .update(debtAccounts)
          .set({ closedAt: null })
          .where(eq(debtAccounts.id, account.id));
      }
    });

    return c.json({ ok: true, closed: parsed.data.closed });
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "ID akun utang tidak valid." }, 400);

    const [existing] = await db.select().from(debtAccounts).where(eq(debtAccounts.id, id)).limit(1);
    if (!existing) return c.json({ error: "Akun utang tidak ditemukan." }, 404);

    await db.transaction(async (tx) => {
      const accInstallments = await tx
        .select()
        .from(installments)
        .where(eq(installments.accountId, id));
      const installmentIds = accInstallments.map((i) => i.id);
      const paidAmount = accInstallments
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + (i.actualAmount ?? i.plannedAmount), 0);

      // Keep ledger transactions and wallet balances intact; unlink deleted debt references only.
      await tx
        .update(transactions)
        .set({ debtAccountId: null })
        .where(eq(transactions.debtAccountId, id));

      if (installmentIds.length > 0) {
        await tx
          .update(transactions)
          .set({ installmentId: null })
          .where(inArray(transactions.installmentId, installmentIds));

        await tx
          .update(settlementAllocations)
          .set({ installmentId: null })
          .where(inArray(settlementAllocations.installmentId, installmentIds));
      }

      if (paidAmount === 0) {
        await tx
          .update(transactions)
          .set({
            isConvertedToInstallment: false,
            convertedAccountId: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.convertedAccountId, id));
      } else {
        // Keep conversion flag when installments were paid so CC bills are not double-billed.
        await tx
          .update(transactions)
          .set({
            isConvertedToInstallment: true,
            convertedAccountId: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.convertedAccountId, id));
      }

      await tx.delete(installments).where(eq(installments.accountId, id));
      await tx.delete(debtAccounts).where(eq(debtAccounts.id, id));

      await recordAuditLog(tx, {
        entityType: "debt_account",
        entityId: id,
        action: "delete_debt_account",
        before: existing,
      });
    });

    return c.json({ ok: true });
  });

  return router;
}

export function createInstallmentRoutes(db: AppDb) {
  const router = new Hono();

  router.post("/settle", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = settleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data pelunasan tidak valid." },
        400,
      );
    }

    const result = await settleObligations(db, parsed.data);
    return c.json({ ok: true, ...result });
  });

  router.post("/:id/unsettle", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID cicilan tidak valid." }, 400);

    const body = await c.req.json().catch(() => ({}));
    const parsed = unsettleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Payload batal lunas tidak valid." }, 400);
    }

    await unsettleInstallment(db, {
      installmentId: id,
      removeSettlementTx: parsed.data.removeSettlementTx,
    });
    return c.json({ ok: true });
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID cicilan tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateInstallmentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data update tidak valid." }, 400);
    }

    const updated = await db.transaction(async (tx) => {
      await lockLedger(tx);
      const [existing] = await tx.select().from(installments).where(eq(installments.id, id)).limit(1);
      if (!existing) throw new NotFoundError("Cicilan tidak ditemukan.");
      if (existing.status === "paid") {
        throw new ValidationError("Cicilan yang sudah lunas tidak dapat diubah nominalnya.");
      }

      const [acc] = existing.accountId
        ? await tx
            .select({
              kind: debtAccounts.kind,
              walletId: debtAccounts.walletId,
              sourceTransactionId: debtAccounts.sourceTransactionId,
              closedAt: debtAccounts.closedAt,
            })
            .from(debtAccounts)
            .where(eq(debtAccounts.id, existing.accountId))
            .limit(1)
        : [null];

      if (
        parsed.data.plannedAmount !== undefined &&
        acc &&
        acc.kind === "card_installment" &&
        !acc.closedAt
      ) {
        let targetCcWalletId = acc.walletId;
        if (!targetCcWalletId) {
          const ccRows = await tx
            .select({ id: wallets.id })
            .from(wallets)
            .where(eq(wallets.type, "credit_card"));
          if (ccRows.length === 1) {
            targetCcWalletId = ccRows[0]!.id;
          }
        }
        if (targetCcWalletId) {
          const limitStatus = await getCreditCardLimitStatus(tx, targetCcWalletId);
          const delta = parsed.data.plannedAmount - existing.plannedAmount;
          if (delta > limitStatus.availableLimit) {
            throw new ValidationError(
              `Perubahan cicilan melebihi sisa limit ${limitStatus.walletName} (Sisa limit: Rp${limitStatus.availableLimit.toLocaleString("id-ID")}).`,
            );
          }
        }
      }

      const updates: Partial<typeof installments.$inferInsert> = {};
      if (parsed.data.plannedAmount !== undefined) {
        updates.plannedAmount = parsed.data.plannedAmount;
        updates.principalAmount = parsed.data.plannedAmount;
      }
      if (parsed.data.dueDate !== undefined) {
        updates.dueDate = parsed.data.dueDate;
        let nextPeriod = parsed.data.dueDate.slice(0, 7);
        if (acc && acc.kind === "card_installment" && !acc.sourceTransactionId) {
          const settings = await getSettings(db);
          let cutoffDay = settings.cardCutoffDay;
          if (acc.walletId) {
            const [w] = await tx
              .select({ cutoffDay: wallets.cutoffDay })
              .from(wallets)
              .where(eq(wallets.id, acc.walletId))
              .limit(1);
            cutoffDay = w?.cutoffDay ?? cutoffDay;
          }
          nextPeriod = ccCycleForDate(parsed.data.dueDate, cutoffDay);
        }
        updates.period = nextPeriod;
      }

      const [saved] = await tx
        .update(installments)
        .set(updates)
        .where(eq(installments.id, id))
        .returning();

      if (parsed.data.plannedAmount !== undefined && existing.accountId) {
        const allInsts = await tx
          .select({
            status: installments.status,
            plannedAmount: installments.plannedAmount,
            actualAmount: installments.actualAmount,
          })
          .from(installments)
          .where(eq(installments.accountId, existing.accountId));
        const newInitialBalance = allInsts.reduce(
          (sum, r) => sum + (r.status === "paid" ? (r.actualAmount ?? r.plannedAmount) : r.plannedAmount),
          0,
        );
        await tx
          .update(debtAccounts)
          .set({ initialBalance: newInitialBalance })
          .where(eq(debtAccounts.id, existing.accountId));
      }

      return saved;
    });

    return c.json({ ok: true, installment: updated });
  });

  return router;
}
