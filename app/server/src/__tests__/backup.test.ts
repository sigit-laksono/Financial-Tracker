import { describe, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { periodBounds } from "../../../shared/src/dates";
import { MAX_PG_INT } from "../../../shared/src/schemas";
import {
  appSettings,
  assets,
  auditLogs,
  budgets,
  categories,
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
import { clientRateKey, LoginRateLimiter, signSessionToken } from "../lib/auth";
import { createDebtAccountWithSchedule } from "../lib/ledger";
import { setupTestContext } from "./testHelper";

describe("Export & Import Full Snapshot (v2)", () => {
  it("exports full snapshot from prod DB and restores identically into dev DB while preserving local PIN & resetting sequences", async () => {
    const prod = await setupTestContext();
    const dev = await setupTestContext();

    try {
      // Configure distinct local PIN on dev DB to verify it is preserved on import
      await dev.db
        .update(appSettings)
        .set({ pinHash: "local-dev-pin-hash", sessionVersion: 7 })
        .where(eq(appSettings.id, 1));
      const devCookie = `ft_session=${signSessionToken("test-secret-key-32-chars-long!!", 7)}`;

      // Seed rich data in prod DB
      await prod.app.request("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grossSalary: 12_000_000,
          netSalary: 11_500_000,
          gajianStartDay: 25,
          cardCutoffDay: 20,
        }),
      });

      const walletsRes = await prod.app.request("/api/wallets");
      const { wallets: prodWallets } = (await walletsRes.json()) as {
        wallets: Array<{ id: number; key: string }>;
      };
      const bni = prodWallets.find((w) => w.key === "bni")!;
      const cc = prodWallets.find((w) => w.key === "cc-jenius")!;

      // Custom category + budget
      const catRes = await prod.app.request("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Langganan Cloud VPS",
          type: "expense",
          bucket: "needs",
          isMandatory: true,
          color: "#00797a",
          budgetLimit: 350_000,
        }),
      });
      expect(catRes.status).toBe(201);

      // Income + split expense + CC expense + settlement
      const incRes = await prod.app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "income",
          merchant: "Gaji Prod",
          amount: 10_000_000,
          transactionDate: "2026-11-01",
          category: "Gaji",
          walletId: bni.id,
        }),
      });
      expect(incRes.status).toBe(201);

      const splitTxRes = await prod.app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Belanja Bulanan",
          amount: 500_000,
          transactionDate: "2026-11-02",
          category: "Makanan & Belanja Dapur",
          walletId: bni.id,
          splits: [
            { category: "Makanan & Belanja Dapur", amount: 300_000, note: "Sembako" },
            { category: "Jajan & Nongkrong", amount: 200_000, note: "Kopi" },
          ],
        }),
      });
      expect(splitTxRes.status).toBe(201);

      const ccTxRes = await prod.app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Beli Monitor",
          amount: 1_200_000,
          transactionDate: "2026-11-05",
          category: "Belanja Pribadi & Hobi",
          walletId: cc.id,
        }),
      });
      expect(ccTxRes.status).toBe(201);

      // Settle CC cycle
      const settleRes = await prod.app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWalletId: bni.id,
          ccWalletId: cc.id,
          ccCycleKey: "2026-11",
          paymentDate: "2026-11-10",
        }),
      });
      expect(settleRes.status).toBe(200);

      // Debt account + installments
      await createDebtAccountWithSchedule(prod.db, {
        name: "Cicilan Laptop",
        lender: "Tokopedia",
        kind: "loan",
        initialBalance: 6_000_000,
        installmentCount: 3,
        installmentAmount: 2_000_000,
        firstDueDate: "2026-12-01",
        paymentMethod: "Auto Debit BNI",
        walletId: bni.id,
      });

      // Goal, Asset, Recurring rule
      await prod.app.request("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Dana Darurat",
          emoji: "🛡️",
          targetAmount: 50_000_000,
          currentAmount: 5_000_000,
          isEmergencyFund: true,
          walletId: bni.id,
        }),
      });

      await prod.app.request("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Emas Antam",
          category: "investment",
          type: "gold",
          valuationAmount: 15_000_000,
          acquisitionCost: 12_000_000,
        }),
      });

      await prod.app.request("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: "Internet Biznet",
          amount: 375_000,
          category: "Internet & Komunikasi",
          walletId: bni.id,
          dueDay: 15,
        }),
      });

      // Add extra divergent data on dev DB that should be replaced completely
      await dev.app.request("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: devCookie },
        body: JSON.stringify({
          name: "Aset Lama Dev",
          category: "fixed",
          type: "electronics",
          valuationAmount: 1_000_000,
        }),
      });

      // Export full JSON snapshot from prod
      const exportRes = await prod.app.request("/api/export?format=json&period=all");
      expect(exportRes.status).toBe(200);
      const exportedJson = (await exportRes.json()) as Record<string, unknown>;
      expect(exportedJson.version).toBe(2);
      expect(exportedJson.period).toBe("all");
      expect(exportedJson.scope).toBe("full");
      expect((exportedJson.settings as Record<string, unknown>).pinHash).toBeUndefined();

      // Import snapshot into dev DB
      const importRes = await dev.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: devCookie },
        body: JSON.stringify({
          confirmation: "IMPORT_CONFIRMED",
          snapshot: exportedJson,
        }),
      });
      expect(importRes.status).toBe(200);
      const importBody = (await importRes.json()) as {
        ok: boolean;
        counts: Record<string, number>;
      };
      expect(importBody.ok).toBe(true);
      expect(importBody.counts.goals).toBe(1);
      expect(importBody.counts.assets).toBe(1);
      expect(importBody.counts.recurringRules).toBe(1);

      // Verify dev DB tables match prod DB tables identically
      const [
        prodW,
        devW,
        prodCat,
        devCat,
        prodAcc,
        devAcc,
        prodInst,
        devInst,
        prodTx,
        devTx,
        prodSplits,
        devSplits,
        prodAlloc,
        devAlloc,
        prodBudgets,
        devBudgets,
        prodGoals,
        devGoals,
        prodAssets,
        devAssets,
        prodFees,
        devFees,
        prodRules,
        devRules,
      ] = await Promise.all([
        prod.db.select().from(wallets).orderBy(asc(wallets.id)),
        dev.db.select().from(wallets).orderBy(asc(wallets.id)),
        prod.db.select().from(categories).orderBy(asc(categories.id)),
        dev.db.select().from(categories).orderBy(asc(categories.id)),
        prod.db.select().from(debtAccounts).orderBy(asc(debtAccounts.id)),
        dev.db.select().from(debtAccounts).orderBy(asc(debtAccounts.id)),
        prod.db.select().from(installments).orderBy(asc(installments.id)),
        dev.db.select().from(installments).orderBy(asc(installments.id)),
        prod.db.select().from(transactions).orderBy(asc(transactions.id)),
        dev.db.select().from(transactions).orderBy(asc(transactions.id)),
        prod.db.select().from(transactionSplits).orderBy(asc(transactionSplits.id)),
        dev.db.select().from(transactionSplits).orderBy(asc(transactionSplits.id)),
        prod.db.select().from(settlementAllocations).orderBy(asc(settlementAllocations.id)),
        dev.db.select().from(settlementAllocations).orderBy(asc(settlementAllocations.id)),
        prod.db.select().from(budgets).orderBy(asc(budgets.id)),
        dev.db.select().from(budgets).orderBy(asc(budgets.id)),
        prod.db.select().from(goals).orderBy(asc(goals.id)),
        dev.db.select().from(goals).orderBy(asc(goals.id)),
        prod.db.select().from(assets).orderBy(asc(assets.id)),
        dev.db.select().from(assets).orderBy(asc(assets.id)),
        prod.db.select().from(walletRecurringFees).orderBy(asc(walletRecurringFees.id)),
        dev.db.select().from(walletRecurringFees).orderBy(asc(walletRecurringFees.id)),
        prod.db.select().from(recurringRules).orderBy(asc(recurringRules.id)),
        dev.db.select().from(recurringRules).orderBy(asc(recurringRules.id)),
      ]);

      expect(devW.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() }))).toEqual(
        prodW.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
      );
      expect(devCat).toEqual(prodCat);
      expect(devAcc.length).toBe(prodAcc.length);
      expect(devInst.length).toBe(prodInst.length);
      expect(devTx.length).toBe(prodTx.length);
      expect(devSplits.length).toBe(prodSplits.length);
      expect(devAlloc.length).toBe(prodAlloc.length);
      expect(devBudgets.length).toBe(prodBudgets.length);
      expect(devGoals.length).toBe(prodGoals.length);
      expect(devAssets.map((a) => a.name)).toEqual(prodAssets.map((a) => a.name));
      expect(devFees.length).toBe(prodFees.length);
      expect(devRules.length).toBe(prodRules.length);

      // Verify local PIN & sessionVersion were preserved while financial settings synced
      const [devSettings] = await dev.db.select().from(appSettings).where(eq(appSettings.id, 1));
      expect(devSettings!.pinHash).toBe("local-dev-pin-hash");
      expect(devSettings!.sessionVersion).toBe(7);
      expect(devSettings!.grossSalary).toBe(12_000_000);
      expect(devSettings!.netSalary).toBe(11_500_000);

      // Verify dashboard metrics match between prod and dev
      const [prodDashRes, devDashRes] = await Promise.all([
        prod.app.request("/api/dashboard?cycle=gajian"),
        dev.app.request("/api/dashboard?cycle=gajian", { headers: { Cookie: devCookie } }),
      ]);
      const prodDash = (await prodDashRes.json()) as { metrics: Record<string, unknown> };
      const devDash = (await devDashRes.json()) as { metrics: Record<string, unknown> };
      expect(devDash.metrics).toEqual(prodDash.metrics);

      // Verify PostgreSQL serial sequences were reset: inserting new rows in dev succeeds without ID collision
      const newTxRes = await dev.app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: devCookie },
        body: JSON.stringify({
          type: "expense",
          merchant: "Test Pasca Import",
          amount: 25_000,
          transactionDate: "2026-11-12",
          category: "Jajan & Nongkrong",
          walletId: bni.id,
        }),
      });
      expect(newTxRes.status).toBe(201);

      const newAssetRes = await dev.app.request("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: devCookie },
        body: JSON.stringify({
          name: "Saham BBCA",
          category: "investment",
          type: "stocks",
          valuationAmount: 5_000_000,
        }),
      });
      expect(newAssetRes.status).toBe(201);

      const logs = await dev.db.select().from(auditLogs);
      expect(logs.some((l) => l.action === "import_backup")).toBe(true);
    } finally {
      await prod.cleanup();
      await dev.cleanup();
    }
  });

  it("rejects invalid confirmation, v1 format, partial period, and broken references without mutating DB", async () => {
    const ctx = await setupTestContext();
    try {
      const exportRes = await ctx.app.request("/api/export?format=json&period=all");
      const validSnap = (await exportRes.json()) as Record<string, unknown>;

      // 1. Wrong confirmation
      const badConfirm = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "WRONG", snapshot: validSnap }),
      });
      expect(badConfirm.status).toBe(400);

      // 2. Legacy v1 snapshot (no version: 2)
      const { version: _v, ...v1Snap } = validSnap;
      const v1Res = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: v1Snap }),
      });
      expect(v1Res.status).toBe(400);

      // 3. Partial period snapshot
      const partialRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: "IMPORT_CONFIRMED",
          snapshot: { ...validSnap, period: "2026-11" },
        }),
      });
      expect(partialRes.status).toBe(400);

      // 4. Broken referential integrity leaves existing data untouched
      const brokenSnap = {
        ...validSnap,
        goals: [
          {
            id: 1,
            name: "Broken Goal",
            emoji: "🎯",
            targetAmount: 1_000_000,
            currentAmount: 0,
            isEmergencyFund: false,
            walletId: 999999,
          },
        ],
      };
      const brokenRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: brokenSnap }),
      });
      expect(brokenRes.status).toBe(400);

      const walletsAfterFail = await ctx.db.select().from(wallets);
      expect(walletsAfterFail.length).toBeGreaterThan(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it("preserves null creditLimit on export and validates unconstrained IDs and cycle day bounds on import", async () => {
    const ctx = await setupTestContext();
    try {
      await ctx.db
        .update(wallets)
        .set({ creditLimit: null })
        .where(eq(wallets.key, "cc-jenius"));

      await ctx.app.request("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardLimit: 15_000_000 }),
      });

      const exportRes = await ctx.app.request("/api/export?format=json&period=all");
      expect(exportRes.status).toBe(200);
      const validSnap = (await exportRes.json()) as {
        wallets: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
        installments: Array<Record<string, unknown>>;
        transactions: Array<Record<string, unknown>>;
      };

      // cc-jenius has creditLimit: null in DB; export must not overwrite it with settings.cardLimit
      const ccExport = validSnap.wallets.find((w) => w.key === "cc-jenius");
      expect(ccExport).toBeDefined();
      expect(ccExport!.creditLimit).toBeNull();
      expect(ccExport!.balance).toBeUndefined();

      // Reject invalid cycle day bounds in backupWalletRowSchema
      const badDaySnap = {
        ...validSnap,
        wallets: validSnap.wallets.map((w, idx) => (idx === 0 ? { ...w, cutoffDay: 30 } : w)),
      };
      const badDayRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: badDaySnap }),
      });
      expect(badDayRes.status).toBe(400);

      // Reject broken unconstrained ID references
      const bni = validSnap.wallets.find((w) => w.key === "bni")!;
      const brokenTxRefSnap = {
        ...validSnap,
        transactions: [
          {
            id: 100,
            type: "expense",
            merchant: "Broken Ref",
            amount: 50_000,
            transactionDate: "2026-11-10",
            category: "Makanan & Belanja Dapur",
            walletId: bni.id,
            convertedAccountId: 99999,
          },
        ],
      };
      const brokenTxRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: brokenTxRefSnap }),
      });
      expect(brokenTxRes.status).toBe(400);

      const brokenAccSourceSnap = {
        ...validSnap,
        accounts: [
          {
            id: 1,
            key: "split-1",
            name: "Split",
            lender: "CC",
            kind: "card_installment",
            direction: "payable",
            initialBalance: 100_000,
            paymentMethod: "CC",
            color: "#00797a",
            sourceTransactionId: 88888,
          },
        ],
      };
      const brokenAccRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: brokenAccSourceSnap }),
      });
      expect(brokenAccRes.status).toBe(400);

      const brokenInstSettleSnap = {
        ...validSnap,
        accounts: [
          {
            id: 1,
            key: "loan-1",
            name: "Loan",
            lender: "Bank",
            kind: "loan",
            direction: "payable",
            initialBalance: 100_000,
            paymentMethod: "BCA",
            color: "#00797a",
          },
        ],
        installments: [
          {
            id: 1,
            accountId: 1,
            period: "2026-11",
            dueDate: "2026-11-25",
            plannedAmount: 100_000,
            status: "paid",
            settlementTransactionId: 77777,
          },
        ],
      };
      const brokenInstRes = await ctx.app.request("/api/export/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "IMPORT_CONFIRMED", snapshot: brokenInstSettleSnap }),
      });
      expect(brokenInstRes.status).toBe(400);
    } finally {
      await ctx.cleanup();
    }
  });

  it("enforces strict reset confirmations, cleans dependent state on transaction reset, and guards settings/ledger inputs", async () => {
    const ctx = await setupTestContext();
    try {
      const walletRows = await ctx.db.select().from(wallets);
      const bca = walletRows.find((w) => w.key === "bca")!;
      const cc = walletRows.find((w) => w.key === "cc-jenius")!;

      // Reject credit_card or non-existent defaultSalaryWalletId
      const badSalaryWallet = await ctx.app.request("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSalaryWalletId: cc.id }),
      });
      expect(badSalaryWallet.status).toBe(400);

      const missingSalaryWallet = await ctx.app.request("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSalaryWalletId: 999999 }),
      });
      expect(missingSalaryWallet.status).toBe(404);

      // Audit logs safely handle NaN query params and clamp limit <= 200
      const auditNaN = await ctx.app.request("/api/settings/audit-logs?limit=abc&offset=xyz");
      expect(auditNaN.status).toBe(200);
      const auditBody = (await auditNaN.json()) as { limit: number; offset: number };
      expect(auditBody.limit).toBe(50);
      expect(auditBody.offset).toBe(0);

      const auditHigh = await ctx.app.request("/api/settings/audit-logs?limit=999");
      expect(auditHigh.status).toBe(200);
      expect(((await auditHigh.json()) as { limit: number }).limit).toBe(200);

      // Salary preview query validation rejects 0, NaN, invalid period, and > MAX_PG_INT
      expect((await ctx.app.request("/api/ledger/salary-preview?grossSalary=0")).status).toBe(400);
      expect((await ctx.app.request("/api/ledger/salary-preview?grossSalary=abc")).status).toBe(400);
      expect((await ctx.app.request("/api/ledger/salary-preview?period=2026-99")).status).toBe(400);
      expect(
        (await ctx.app.request(`/api/ledger/salary-preview?grossSalary=${MAX_PG_INT + 1}`)).status,
      ).toBe(400);

      // periodBounds clamps out-of-range days in Feb
      expect(periodBounds("2026-02", "gajian", 30, 20)).toEqual({
        start: "2026-02-28",
        end: "2026-03-29",
      });
      expect(periodBounds("2026-03", "cc", 25, 30)).toEqual({
        start: "2026-02-28",
        end: "2026-03-29",
      });
      expect(periodBounds("2026-02", "gajian", 0, 0)).toEqual({
        start: "2026-02-01",
        end: "2026-02-28",
      });

      // mode === "all" rejects RESET_CONFIRMED
      const badAllReset = await ctx.app.request("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all", confirmation: "RESET_CONFIRMED" }),
      });
      expect(badAllReset.status).toBe(400);

      // Seed debt, paid installment, split pay account, recurring rule, and sync date
      const { accountId } = await createDebtAccountWithSchedule(ctx.db, {
        name: "Cicilan Uji",
        lender: "Bank",
        kind: "loan",
        initialBalance: 1_000_000,
        installmentCount: 1,
        installmentAmount: 1_000_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "BCA",
        walletId: bca.id,
        disburseWalletId: bca.id,
        recordDisbursement: true,
      });

      const [instRow] = await ctx.db
        .select()
        .from(installments)
        .where(eq(installments.accountId, accountId));
      await ctx.app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentIds: [instRow!.id],
          fromWalletId: bca.id,
          paymentDate: "2026-11-12",
        }),
      });

      const ccTxRes = await ctx.app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Split Pay Uji",
          amount: 1_200_000,
          transactionDate: "2026-11-05",
          category: "Belanja Pribadi & Hobi",
          walletId: cc.id,
        }),
      });
      const { id: ccTxId } = (await ccTxRes.json()) as { id: number };
      await ctx.app.request(`/api/transactions/${ccTxId}/convert-to-installment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentCount: 2,
          installmentAmount: 600_000,
          firstPeriod: "2026-12",
        }),
      });

      const recRes = await ctx.app.request("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: "Listrik",
          amount: 200_000,
          category: "Tagihan & Utilitas",
          walletId: bca.id,
          dueDay: 10,
        }),
      });
      const { rule } = (await recRes.json()) as { rule: { id: number } };
      await ctx.app.request(`/api/recurring/${rule.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: "2026-11", transactionDate: "2026-11-10" }),
      });

      await ctx.db
        .update(appSettings)
        .set({ lastAutoSyncDate: "2026-11-25", legacySettledBeforeCycle: "2026-10" })
        .where(eq(appSettings.id, 1));

      // Transactions-only reset clears split-pay accounts, reverts installments, clears closedAt/disbursedAt/lastPaidPeriod/lastAutoSyncDate
      const txResetRes = await ctx.app.request("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "transactions", confirmation: "RESET_CONFIRMED" }),
      });
      expect(txResetRes.status).toBe(200);

      const remainingAccounts = await ctx.db.select().from(debtAccounts);
      expect(remainingAccounts).toHaveLength(1);
      expect(remainingAccounts[0]!.closedAt).toBeNull();
      expect(remainingAccounts[0]!.disbursedAt).toBeNull();

      const remainingInsts = await ctx.db.select().from(installments);
      expect(remainingInsts).toHaveLength(1);
      expect(remainingInsts[0]!.status).toBe("upcoming");
      expect(remainingInsts[0]!.actualAmount).toBeNull();
      expect(remainingInsts[0]!.paidAt).toBeNull();
      expect(remainingInsts[0]!.settlementTransactionId).toBeNull();

      const [ruleAfter] = await ctx.db.select().from(recurringRules);
      expect(ruleAfter!.lastPaidPeriod).toBeNull();

      const [settingsAfterTxReset] = await ctx.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, 1));
      expect(settingsAfterTxReset!.lastAutoSyncDate).toBeNull();

      // Full reset clears legacySettledBeforeCycle and lastAutoSyncDate as well
      const allResetRes = await ctx.app.request("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all", confirmation: "RESET_ALL_CONFIRMED" }),
      });
      expect(allResetRes.status).toBe(200);
      const [settingsAfterAllReset] = await ctx.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, 1));
      expect(settingsAfterAllReset!.lastAutoSyncDate).toBeNull();
      expect(settingsAfterAllReset!.legacySettledBeforeCycle).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  it("hardens LoginRateLimiter map cap, global PIN lockout, and proxy IP extraction", async () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 1200; i += 1) {
      limiter.recordFailure(`login:10.0.${Math.floor(i / 255)}.${i % 255}`, 1_000_000);
    }
    expect(limiter.checkGlobal(1_000_000).allowed).toBe(false);
    // Internal map size must never exceed MAX_ENTRIES (1000)
    expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBeLessThanOrEqual(
      LoginRateLimiter.MAX_ENTRIES,
    );

    const prevTrustProxy = process.env.TRUST_PROXY;
    try {
      process.env.TRUST_PROXY = "true";
      const makeCtx = (headers: Record<string, string>) =>
        ({
          req: { header: (name: string) => headers[name.toLowerCase()] },
        }) as Parameters<typeof clientRateKey>[0];

      expect(
        clientRateKey(
          makeCtx({
            "x-forwarded-for": "1.2.3.4, 5.6.7.8",
            "x-real-ip": "9.9.9.9",
          }),
        ),
      ).toBe("9.9.9.9");
      expect(
        clientRateKey(
          makeCtx({
            "x-forwarded-for": "spoofed.1, 10.20.30.40",
          }),
        ),
      ).toBe("10.20.30.40");

      process.env.TRUST_PROXY = "false";
      expect(clientRateKey(makeCtx({ "x-real-ip": "9.9.9.9" }))).toBe("local");
    } finally {
      if (prevTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = prevTrustProxy;
      }
    }

    // Integration test: global lockout across rotating XFF IPs on /login and /change-pin
    const ctx = await setupTestContext();
    const savedTrustProxy = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      const setupRes = await ctx.app.request("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });
      expect(setupRes.status).toBe(200);
      const cookie = setupRes.headers.get("set-cookie") ?? "";

      for (let i = 0; i < 20; i += 1) {
        const failRes = await ctx.app.request("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": `203.0.113.${i + 1}`,
          },
          body: JSON.stringify({ pin: "9999" }),
        });
        expect(failRes.status).toBe(401);
      }

      const blockedLogin = await ctx.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "198.51.100.50",
        },
        body: JSON.stringify({ pin: "1234" }),
      });
      expect(blockedLogin.status).toBe(429);

      const blockedChangePin = await ctx.app.request("/api/auth/change-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "x-forwarded-for": "198.51.100.51",
        },
        body: JSON.stringify({ currentPin: "1234", newPin: "5678" }),
      });
      expect(blockedChangePin.status).toBe(429);
    } finally {
      if (savedTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = savedTrustProxy;
      }
      await ctx.cleanup();
    }
  });
});
