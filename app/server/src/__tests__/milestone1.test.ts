import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { debtAccounts, installments, wallets } from "../db/schema";
import { buildDashboardData } from "../lib/dashboardQuery";
import { ensurePayrollAutoPaid } from "../lib/debtEngine";
import { setupTestContext } from "./testHelper";

describe("Milestone 1: Akurasi Cashflow & Siklus Gajian", () => {
  it("excludes savings wallet from safeToSpend and defers CC expense whose due date is in next cycle", async () => {
    const { db, app } = await setupTestContext();

    // 1. Give BNI (spending) opening balance 5.000.000, and BCA (spending) 3.000.000
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));

    expect(bni).toBeDefined();
    expect(bca).toBeDefined();
    expect(cc).toBeDefined();

    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 5_000_000 }),
    });

    await app.request(`/api/wallets/${bca!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 3_000_000 }),
    });

    let dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });

    // Both are spending: totalLiquidCash = 8.000.000, totalSpendableCash = 8.000.000, safeToSpend = 8.000.000
    expect(dash.metrics.totalLiquidCash).toBe(8_000_000);
    expect(dash.metrics.totalSpendableCash).toBe(8_000_000);
    expect(dash.metrics.totalSavingsCash).toBe(0);
    expect(dash.metrics.safeToSpend).toBe(8_000_000);

    // 2. Change BCA role to "savings"
    const patchBca = await app.request(`/api/wallets/${bca!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "savings" }),
    });
    expect(patchBca.status).toBe(200);

    dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });

    // BCA is now savings: totalLiquidCash remains 8.000.000, but totalSpendableCash is 5.000.000, totalSavingsCash = 3.000.000
    expect(dash.metrics.totalLiquidCash).toBe(8_000_000);
    expect(dash.metrics.totalSpendableCash).toBe(5_000_000);
    expect(dash.metrics.totalSavingsCash).toBe(3_000_000);
    expect(dash.metrics.safeToSpend).toBe(5_000_000);

    // 3. Record an unbilled CC expense of Rp100.000 (after cutoff, e.g. on 2026-10-22)
    const ccTxRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Kopi Kenangan CC",
        amount: 100_000,
        transactionDate: "2026-10-22",
        category: "Makanan & Minuman",
        walletId: cc!.id,
      }),
    });
    expect(ccTxRes.status).toBe(201);

    dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });

    // In cycle 2026-10 (ends 2026-11-24), CC due date is 2026-11-25 (next cycle).
    // It is tracked in upcomingCcCyclesSum (100.000) and does not deduct current cycle safeToSpend.
    expect(dash.metrics.ccReservedCash).toBe(0);
    expect(dash.metrics.upcomingCcCyclesSum).toBe(100_000);
    expect(dash.metrics.safeToSpend).toBe(5_000_000);

    // In cycle 2026-11 (starts 2026-11-25), it becomes due and deducts safeToSpend
    const dashNextCycle = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-11",
      today: "2026-11-25",
    });
    expect(dashNextCycle.metrics.ccReservedCash).toBe(100_000);
    expect(dashNextCycle.metrics.safeToSpend).toBe(5_000_000 - 100_000);
  });

  it("calculates cycle pacing, daily allowance, and previous cycle comparison correctly", async () => {
    const { db, app } = await setupTestContext();

    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // Set opening balance to 3.100.000 on BNI
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 3_100_000 }),
    });

    // 2026-10 period: 2026-10-25 to 2026-11-24 (31 days total)
    // On day 1 (2026-10-25): elapsed = 1, remaining = 31, dailyAllowance = 3.100.000 / 31 = 100.000
    let dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });

    expect(dash.metrics.daysTotal).toBe(31);
    expect(dash.metrics.daysElapsed).toBe(1);
    expect(dash.metrics.daysRemaining).toBe(31);
    expect(dash.metrics.dailyAllowance).toBe(100_000);
    expect(dash.metrics.pacingStatus).toBe("sesuai_jalur");

    // Spend 500.000 in past cycle (2026-09: 2026-09-25 to 2026-10-24) on day 1 (2026-09-25)
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Bulan Lalu",
        amount: 500_000,
        transactionDate: "2026-09-25",
        category: "Belanja",
        walletId: bni!.id,
      }),
    });

    // Now re-check 2026-10 at day 1 (2026-10-25)
    dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });

    expect(dash.metrics.previousCycleComparison.dayN).toBe(1);
    expect(dash.metrics.previousCycleComparison.currentSpentToDay).toBe(0);
    expect(dash.metrics.previousCycleComparison.prevSpentToDay).toBe(500_000);
  });

  it("handles 1-klik terima gaji atomically with payroll debt deduction and idempotency", async () => {
    const { db, app } = await setupTestContext();

    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // Create a payroll debt account with 2 monthly installments
    const [payrollAcc] = await db
      .insert(debtAccounts)
      .values({
        key: "utang-kantor-laptop",
        name: "Utang Kantor Laptop",
        lender: "Kantor",
        kind: "payroll",
        initialBalance: 3_000_000,
        paymentMethod: "Potong Gaji",
        color: "#00797a",
      })
      .returning();

    const [inst1] = await db
      .insert(installments)
      .values([
        {
          accountId: payrollAcc!.id,
          period: "2026-10",
          dueDate: "2026-10-25",
          plannedAmount: 1_500_000,
          status: "upcoming",
        },
        {
          accountId: payrollAcc!.id,
          period: "2026-11",
          dueDate: "2026-11-25",
          plannedAmount: 1_500_000,
          status: "upcoming",
        },
      ])
      .returning();

    // 1. Preview salary receipt for 2026-10
    const previewRes = await app.request(
      `/api/ledger/salary-preview?period=2026-10&grossSalary=10000000&walletId=${bni!.id}`,
    );
    expect(previewRes.status).toBe(200);
    const previewJson = (await previewRes.json()) as {
      ok: boolean;
      grossSalary: number;
      totalPayrollDue: number;
      netSalary: number;
      alreadyReceived: boolean;
      payrollInstallments: Array<{ id: number; plannedAmount: number }>;
    };

    expect(previewJson.grossSalary).toBe(10_000_000);
    expect(previewJson.totalPayrollDue).toBe(1_500_000);
    expect(previewJson.netSalary).toBe(8_500_000);
    expect(previewJson.alreadyReceived).toBe(false);
    expect(previewJson.payrollInstallments.length).toBe(1);

    // 2. Receive salary for 2026-10
    const receiveRes = await app.request("/api/ledger/receive-salary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: "2026-10",
        grossSalary: 10_000_000,
        walletId: bni!.id,
      }),
    });
    expect(receiveRes.status).toBe(201);
    const receiveJson = (await receiveRes.json()) as {
      ok: boolean;
      netSalary: number;
      totalPayrollDue: number;
      transaction: { amount: number; type: string; category: string; sourceRef: string };
    };

    expect(receiveJson.netSalary).toBe(8_500_000);
    expect(receiveJson.totalPayrollDue).toBe(1_500_000);
    expect(receiveJson.transaction.amount).toBe(8_500_000);
    expect(receiveJson.transaction.category).toBe("Gaji");
    expect(receiveJson.transaction.sourceRef).toBe("salary-2026-10");

    // Verify installment is marked paid with settlementTransactionId
    const [updatedInst1] = await db
      .select()
      .from(installments)
      .where(eq(installments.id, inst1!.id));
    expect(updatedInst1!.status).toBe("paid");
    expect(updatedInst1!.settlementTransactionId).toBeDefined();

    // 3. Fallback ensurePayrollAutoPaid must not double-settle or touch already paid installment
    const autoPaidCount = await ensurePayrollAutoPaid(db, "2026-10-25");
    expect(autoPaidCount).toBe(0);

    // 4. Idempotency test: calling receive-salary again for 2026-10 must fail with 409 Conflict
    const duplicateRes = await app.request("/api/ledger/receive-salary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: "2026-10",
        grossSalary: 10_000_000,
        walletId: bni!.id,
      }),
    });
    expect(duplicateRes.status).toBe(409);

    // 5. Verify BNI wallet balance increased by netSalary (8.500.000)
    const dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-25",
    });
    const bniWallet = dash.wallets.find((w) => w.id === bni!.id);
    expect(bniWallet!.balance).toBe(8_500_000);
    expect(dash.metrics.salaryReceivedThisCycle).toBe(true);
  });
});
