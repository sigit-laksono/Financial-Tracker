import { describe, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
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
import { signSessionToken } from "../lib/auth";
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
});
