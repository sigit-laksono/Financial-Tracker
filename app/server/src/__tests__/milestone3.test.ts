import { describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { recurringRules, transactionSplits, transactions, wallets } from "../db/schema";
import { buildDashboardData } from "../lib/dashboardQuery";
import { setupTestContext } from "./testHelper";

describe("Milestone 3: Pencatatan Harian Cepat, Split Category, Recurring Bills & Atomic Transfer", () => {
  it("validasi dan agregasi budget untuk transaksi dengan transactionSplits", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // Set BNI balance: 2.000.000
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 2_000_000 }),
    });

    // Ensure custom split category exists before recording split transaction
    const catRes = await app.request("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kebutuhan Kucing", type: "expense", bucket: "needs" }),
    });
    expect(catRes.status).toBe(201);

    // 1. Create split transaction: Belanja Indomaret Rp150.000
    // Splits: Rp100.000 (Makanan & Belanja Dapur) + Rp50.000 (Kebutuhan Kucing)
    const txRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Indomaret",
        amount: 150_000,
        transactionDate: "2026-04-26",
        category: "Makanan & Belanja Dapur",
        walletId: bni!.id,
        splits: [
          { category: "Makanan & Belanja Dapur", amount: 100_000, note: "Beli roti & susu" },
          { category: "Kebutuhan Kucing", amount: 50_000, note: "Whiskas sachet" },
        ],
      }),
    });
    expect(txRes.status).toBe(201);
    const txBody = (await txRes.json()) as { ok: boolean; id: number };
    expect(txBody.ok).toBe(true);

    // Verify database rows: 1 in transactions, 2 in transactionSplits
    const splitsInDb = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txBody.id));
    expect(splitsInDb.length).toBe(2);
    expect(splitsInDb.find((s) => s.category === "Makanan & Belanja Dapur")?.amount).toBe(100_000);
    expect(splitsInDb.find((s) => s.category === "Kebutuhan Kucing")?.amount).toBe(50_000);

    // Set budgets: Makanan & Belanja Dapur limit 500.000, Kebutuhan Kucing limit 200.000
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Makanan & Belanja Dapur",
        period: "default",
        limitAmount: 500_000,
      }),
    });
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Kebutuhan Kucing",
        period: "default",
        limitAmount: 200_000,
      }),
    });

    // Check dashboard data
    const dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-04",
      today: "2026-04-27",
    });

    // Total expense is exactly 150.000
    expect(dash.metrics.totalExpense).toBe(150_000);
    expect(dash.metrics.totalSpendableCash).toBe(1_850_000);

    // Category breakdown reflects split amounts
    const foodCat = dash.categoryTotals.find((c) => c.category === "Makanan & Belanja Dapur");
    const catCat = dash.categoryTotals.find((c) => c.category === "Kebutuhan Kucing");
    expect(foodCat?.total).toBe(100_000);
    expect(catCat?.total).toBe(50_000);

    // Budgets reflect the split breakdown
    const foodBudget = dash.budgets.find((b) => b.category === "Makanan & Belanja Dapur");
    const catBudget = dash.budgets.find((b) => b.category === "Kebutuhan Kucing");
    expect(foodBudget?.spentAmount).toBe(100_000);
    expect(foodBudget?.remainingAmount).toBe(400_000);
    expect(catBudget?.spentAmount).toBe(50_000);
    expect(catBudget?.remainingAmount).toBe(150_000);

    // Transactions in list have splits attached
    const listRes = await app.request("/api/transactions?limit=10");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{ id: number; splits?: Array<{ amount: number }> }>;
    };
    const listedTx = listBody.items.find((t) => t.id === txBody.id);
    expect(listedTx?.splits).toBeDefined();
    expect(listedTx?.splits?.length).toBe(2);

    // Reject split with mismatch sum
    const badRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Salah Total",
        amount: 100_000,
        transactionDate: "2026-04-05",
        category: "Makanan & Belanja Dapur",
        walletId: bni!.id,
        splits: [
          { category: "Makanan & Belanja Dapur", amount: 60_000 },
          { category: "Kebutuhan Kucing", amount: 20_000 }, // sum 80.000 != 100.000
        ],
      }),
    });
    expect(badRes.status).toBe(400);
  });

  it("edit & delete atomik untuk transfer dengan adminFee (transferGroupId)", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [gopay] = await db.select().from(wallets).where(eq(wallets.key, "gopay"));
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    expect(bni).toBeDefined();
    expect(gopay).toBeDefined();
    expect(bca).toBeDefined();

    // 1. Create transfer BNI -> GoPay Rp500.000 with admin fee Rp2.500
    const trRes = await app.request("/api/transactions/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWalletId: bni!.id,
        toWalletId: gopay!.id,
        amount: 500_000,
        adminFee: 2_500,
        transactionDate: "2026-04-02",
        merchant: "Top Up GoPay",
      }),
    });
    expect(trRes.status).toBe(201);
    const trBody = (await trRes.json()) as {
      ok: boolean;
      transferId: number;
      feeTransactionId: number | null;
      transferGroupId: string;
    };
    expect(trBody.ok).toBe(true);
    expect(trBody.feeTransactionId).not.toBeNull();
    expect(trBody.transferGroupId).toBeTruthy();

    // In transactions list, transfer has linkedFeeTransaction
    const listRes1 = await app.request(`/api/transactions?walletId=${bni!.id}`);
    expect(listRes1.status).toBe(200);
    const list1 = (await listRes1.json()) as {
      items: Array<{ id: number; linkedFeeTransaction?: { id: number; amount: number } | null }>;
    };
    const transferTx = list1.items.find((i) => i.id === trBody.transferId);
    expect(transferTx?.linkedFeeTransaction).toBeDefined();
    expect(transferTx?.linkedFeeTransaction?.amount).toBe(2_500);

    // 2. Edit transfer atomik: change amount to 600.000, adminFee to 1.000, toWalletId to BCA
    const editRes = await app.request(`/api/transactions/${trBody.transferId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 600_000,
        adminFee: 1_000,
        toWalletId: bca!.id,
        transactionDate: "2026-04-03",
      }),
    });
    expect(editRes.status).toBe(200);

    // Verify both rows updated in transferGroupId
    const [updatedTransfer] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, trBody.transferId));
    expect(updatedTransfer!.amount).toBe(600_000);
    expect(updatedTransfer!.toWalletId).toBe(bca!.id);
    expect(updatedTransfer!.transactionDate).toBe("2026-04-03");

    const [updatedFee] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.transferGroupId, trBody.transferGroupId),
          eq(transactions.type, "expense"),
        ),
      );
    expect(updatedFee!.amount).toBe(1_000);
    expect(updatedFee!.transactionDate).toBe("2026-04-03");

    // 3. Atomically delete transfer: removes both rows
    const delRes = await app.request(`/api/transactions/${trBody.transferId}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    const remainingRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transferGroupId, trBody.transferGroupId));
    expect(remainingRows.length).toBe(0);
  });

  it("eksekusi POST /api/recurring/:id/pay agar idempoten dalam periode yang sama", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // 1. Create recurring rule: Internet Indihome Rp350.000 tgl 10
    const createRes = await app.request("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: "Internet Indihome",
        amount: 350_000,
        category: "Internet & Komunikasi",
        walletId: bni!.id,
        dueDay: 10,
        isActive: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      ok: boolean;
      rule: { id: number; merchant: string; dueDay: number };
    };
    const ruleId = createBody.rule.id;

    // Check dashboard projection: recurring bill appears in recurringBills and reduces safeToSpend
    const dash1 = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-04",
      today: "2026-04-01",
    });
    expect(dash1.recurringBills).toBeDefined();
    const indihomeBill = dash1.recurringBills!.find((r) => r.id === ruleId);
    expect(indihomeBill).toBeDefined();
    expect(indihomeBill!.isPaidThisCycle).toBe(false);
    expect(dash1.metrics.unpaidRecurringSum).toBe(350_000);

    // 2. Pay the recurring bill via POST /api/recurring/:id/pay
    const payRes1 = await app.request(`/api/recurring/${ruleId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: "2026-04",
        transactionDate: "2026-04-10",
      }),
    });
    expect(payRes1.status).toBe(201);
    const payBody1 = (await payRes1.json()) as {
      ok: boolean;
      alreadyPaid: boolean;
      transactionId: number;
    };
    expect(payBody1.ok).toBe(true);
    expect(payBody1.alreadyPaid).toBe(false);

    // Verify transaction created
    const [txCreated] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, payBody1.transactionId));
    expect(txCreated!.merchant).toBe("Internet Indihome");
    expect(txCreated!.amount).toBe(350_000);
    expect(txCreated!.sourceRef).toBe(`recurring-${ruleId}-2026-04`);

    // Verify rule lastPaidPeriod is updated
    const [ruleUpdated] = await db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, ruleId));
    expect(ruleUpdated!.lastPaidPeriod).toBe("2026-04");

    // 3. Idempotent check: calling pay again for same period must NOT create duplicate transaction
    const payRes2 = await app.request(`/api/recurring/${ruleId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: "2026-04",
      }),
    });
    expect(payRes2.status).toBe(200);
    const payBody2 = (await payRes2.json()) as {
      ok: boolean;
      alreadyPaid: boolean;
      transactionId: number;
    };
    expect(payBody2.alreadyPaid).toBe(true);
    expect(payBody2.transactionId).toBe(payBody1.transactionId);

    // Verify only 1 transaction exists for this rule and period
    const allMatching = await db
      .select()
      .from(transactions)
      .where(eq(transactions.sourceRef, `recurring-${ruleId}-2026-04`));
    expect(allMatching.length).toBe(1);

    // Check dashboard after pay: bill is now marked isPaidThisCycle: true
    const dash2 = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-04",
      today: "2026-04-11",
    });
    const paidIndihome = dash2.recurringBills!.find((r) => r.id === ruleId);
    expect(paidIndihome!.isPaidThisCycle).toBe(true);
    expect(dash2.metrics.unpaidRecurringSum).toBe(0);
  });

  it("menyediakan endpoint quick presets dengan rekomendasi template dan rute transfer", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // Record some repeat transactions
    for (let i = 0; i < 3; i++) {
      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Kopi Kenangan",
          amount: 25_000,
          transactionDate: "2026-04-01",
          category: "Jajan & Nongkrong",
          walletId: bni!.id,
        }),
      });
    }

    const res = await app.request("/api/transactions/quick-presets?q=kopi");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      frequentTemplates: Array<{ merchant: string; category: string }>;
      merchantSuggestions: Array<{ merchant: string; category: string }>;
      frequentTransferRoutes: Array<{ fromWalletName: string; toWalletName: string }>;
    };
    expect(data.frequentTemplates.some((t) => t.merchant === "Kopi Kenangan")).toBe(true);
    expect(data.merchantSuggestions.some((m) => m.merchant === "Kopi Kenangan")).toBe(true);
    expect(data.frequentTransferRoutes.length).toBeGreaterThan(0);
  });
});
