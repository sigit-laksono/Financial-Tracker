import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { updateSettingsSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import {
  appSettings,
  assets,
  auditLogs,
  budgets,
  debtAccounts,
  goals,
  installments,
  recurringRules,
  settlementAllocations,
  transactionSplits,
  transactions,
  walletRecurringFees,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import { invalidateAuthCache } from "../lib/auth";
import { getSettings } from "../lib/ledger";

export function createSettingsRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const s = await getSettings(db);
    return c.json({
      settings: {
        grossSalary: s.grossSalary,
        netSalary: s.netSalary,
        payrollDeduction: s.payrollDeduction,
        defaultSalaryWalletId: s.defaultSalaryWalletId,
        gajianStartDay: s.gajianStartDay,
        cardCutoffDay: s.cardCutoffDay,
        statementDay: s.statementDay,
        cardPaymentDay: s.cardPaymentDay,
        cardLimit: s.cardLimit,
        pinConfigured: Boolean(s.pinHash),
      },
    });
  });

  router.patch("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Pengaturan tidak valid." }, 400);
    }

    if (parsed.data.defaultSalaryWalletId != null) {
      const [salaryWallet] = await db
        .select({ id: wallets.id, type: wallets.type })
        .from(wallets)
        .where(eq(wallets.id, parsed.data.defaultSalaryWalletId))
        .limit(1);
      if (!salaryWallet) {
        return c.json({ error: "Dompet gaji default tidak ditemukan." }, 404);
      }
      if (salaryWallet.type === "credit_card") {
        return c.json({ error: "Dompet gaji default tidak boleh berupa kartu kredit." }, 400);
      }
    }

    const beforeSettings = await getSettings(db);
    const [updated] = await db
      .update(appSettings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(appSettings.id, 1))
      .returning();

    invalidateAuthCache(db);

    await recordAuditLog(db, {
      entityType: "settings",
      entityId: 1,
      action: "update_settings",
      before: {
        grossSalary: beforeSettings.grossSalary,
        netSalary: beforeSettings.netSalary,
        payrollDeduction: beforeSettings.payrollDeduction,
        gajianStartDay: beforeSettings.gajianStartDay,
        cardCutoffDay: beforeSettings.cardCutoffDay,
        statementDay: beforeSettings.statementDay,
        cardPaymentDay: beforeSettings.cardPaymentDay,
        cardLimit: beforeSettings.cardLimit,
      },
      after: {
        grossSalary: updated!.grossSalary,
        netSalary: updated!.netSalary,
        payrollDeduction: updated!.payrollDeduction,
        gajianStartDay: updated!.gajianStartDay,
        cardCutoffDay: updated!.cardCutoffDay,
        statementDay: updated!.statementDay,
        cardPaymentDay: updated!.cardPaymentDay,
        cardLimit: updated!.cardLimit,
      },
    });

    return c.json({
      ok: true,
      settings: {
        grossSalary: updated!.grossSalary,
        netSalary: updated!.netSalary,
        payrollDeduction: updated!.payrollDeduction,
        defaultSalaryWalletId: updated!.defaultSalaryWalletId,
        gajianStartDay: updated!.gajianStartDay,
        cardCutoffDay: updated!.cardCutoffDay,
        statementDay: updated!.statementDay,
        cardPaymentDay: updated!.cardPaymentDay,
        cardLimit: updated!.cardLimit,
        pinConfigured: Boolean(updated!.pinHash),
      },
    });
  });

  router.get("/audit-logs", async (c) => {
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");
    const parsedLimit = limitParam && limitParam.trim() !== "" ? Number(limitParam) : Number.NaN;
    const parsedOffset = offsetParam && offsetParam.trim() !== "" ? Number(offsetParam) : Number.NaN;
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(1, Math.trunc(parsedLimit)), 200) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.trunc(parsedOffset)) : 0;
    const entityType = c.req.query("entityType")?.trim();

    let query = db.select().from(auditLogs);
    if (entityType) {
      query = query.where(eq(auditLogs.entityType, entityType)) as typeof query;
    }

    const rows = await query.orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(entityType ? eq(auditLogs.entityType, entityType) : undefined);

    return c.json({
      logs: rows,
      total: Number(totalRow?.count ?? 0),
      limit,
      offset,
    });
  });

  router.post("/reset", async (c) => {
    const body = await c.req.json().catch(() => null);
    const mode =
      body?.mode === "all" || body?.confirmation === "RESET_ALL_CONFIRMED" ? "all" : "transactions";

    if (mode === "all") {
      if (body?.confirmation !== "RESET_ALL_CONFIRMED") {
        return c.json(
          {
            error:
              'Konfirmasi reset total tidak valid. Ketik "RESET_ALL_CONFIRMED" untuk melanjutkan.',
          },
          400,
        );
      }

      await db.transaction(async (tx) => {
        await tx
          .update(appSettings)
          .set({
            grossSalary: 0,
            netSalary: 0,
            payrollDeduction: 0,
            defaultSalaryWalletId: null,
            cardLimit: 0,
            legacySettledBeforeCycle: null,
            lastAutoSyncDate: null,
            updatedAt: new Date(),
          })
          .where(eq(appSettings.id, 1));

        await tx.delete(settlementAllocations);
        await tx.delete(transactionSplits);
        await tx.delete(transactions);
        await tx.delete(installments);
        await tx.delete(debtAccounts);
        await tx.delete(budgets);
        await tx.delete(goals);
        await tx.delete(assets);
        await tx.delete(recurringRules);
        await tx.delete(walletRecurringFees);
        await tx.delete(wallets);
      });

      await recordAuditLog(db, {
        entityType: "settings",
        entityId: 1,
        action: "reset_all_database",
        after: { resetAt: new Date().toISOString() },
      });

      return c.json({
        ok: true,
        message:
          "Seluruh data dompet, kartu kredit, hutang, celengan, dan transaksi berhasil direset total.",
      });
    }

    if (body?.confirmation !== "RESET_CONFIRMED") {
      return c.json(
        { error: 'Konfirmasi reset tidak valid. Ketik "RESET_CONFIRMED" untuk melanjutkan.' },
        400,
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(settlementAllocations);
      await tx.delete(transactionSplits);
      await tx.delete(transactions);

      const splitPayAccounts = await tx
        .select({ id: debtAccounts.id })
        .from(debtAccounts)
        .where(isNotNull(debtAccounts.sourceTransactionId));
      const splitPayIds = splitPayAccounts.map((a) => a.id);
      if (splitPayIds.length > 0) {
        await tx.delete(installments).where(inArray(installments.accountId, splitPayIds));
        await tx.delete(debtAccounts).where(inArray(debtAccounts.id, splitPayIds));
      }

      await tx.update(installments).set({
        status: "upcoming",
        actualAmount: null,
        paidAt: null,
        settlementTransactionId: null,
      });

      await tx.update(debtAccounts).set({
        closedAt: null,
        disbursedAt: null,
      });

      await tx.update(recurringRules).set({ lastPaidPeriod: null });

      await tx
        .update(appSettings)
        .set({ lastAutoSyncDate: null, updatedAt: new Date() })
        .where(eq(appSettings.id, 1));
    });

    await recordAuditLog(db, {
      entityType: "settings",
      entityId: 1,
      action: "reset_database",
      after: { resetAt: new Date().toISOString() },
    });

    return c.json({ ok: true, message: "Seluruh mutasi transaksi berhasil direset." });
  });

  return router;
}
