import { desc, eq, sql } from "drizzle-orm";
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
    const limit = Math.min(Math.max(1, Number(c.req.query("limit") || 50)), 100);
    const offset = Math.max(0, Number(c.req.query("offset") || 0));
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
      if (body?.confirmation !== "RESET_ALL_CONFIRMED" && body?.confirmation !== "RESET_CONFIRMED") {
        return c.json(
          {
            error:
              'Konfirmasi reset total tidak valid. Ketik "RESET_ALL_CONFIRMED" untuk melanjutkan.',
          },
          400,
        );
      }

      await db.transaction(async (tx) => {
        // 1. Reset appSettings (gaji, potongan, default wallet, limit kartu ke nilai awal)
        await tx
          .update(appSettings)
          .set({
            grossSalary: 0,
            netSalary: 0,
            payrollDeduction: 0,
            defaultSalaryWalletId: null,
            cardLimit: 0,
            updatedAt: new Date(),
          })
          .where(eq(appSettings.id, 1));

        // 2. Hapus alokasi pelunasan & transaksi
        await tx.delete(settlementAllocations);
        await tx.delete(transactionSplits);
        await tx.delete(transactions);

        // 3. Hapus cicilan dan akun hutang/pinjaman
        await tx.delete(installments);
        await tx.delete(debtAccounts);

        // 4. Hapus anggaran, celengan target, aset & aturan berulang
        await tx.delete(budgets);
        await tx.delete(goals);
        await tx.delete(assets);
        await tx.delete(recurringRules);

        // 5. Hapus biaya rutin dompet & seluruh dompet
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
