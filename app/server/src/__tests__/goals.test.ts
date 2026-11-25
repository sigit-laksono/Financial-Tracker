import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { wallets } from "../db/schema";
import { computeWalletBalance } from "../lib/cashLedger";
import { setupTestContext } from "./testHelper";

describe("Milestone 10: Goals & Emergency Fund Runway", () => {
  it("creates, retrieves, and calculates emergency fund runway accurately", async () => {
    const { db, app } = await setupTestContext();

    // 1. Initial state: 0 goals
    const resInitial = await app.request("/api/goals");
    expect(resInitial.status).toBe(200);
    const bodyInitial = await resInitial.json();
    expect(bodyInitial.goals).toHaveLength(0);
    expect(bodyInitial.emergencyFund.totalEmergencyFunds).toBe(0);
    expect(bodyInitial.emergencyFund.runwayMonths).toBe(0);

    // 2. Create emergency fund goal
    const resCreate = await app.request("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dana Darurat 6 Bulan",
        emoji: "🛡️",
        targetAmount: 30_000_000,
        currentAmount: 5_000_000,
        isEmergencyFund: true,
        notes: "Tabungan jaga-jaga",
      }),
    });
    expect(resCreate.status).toBe(201);
    const { goal: createdGoal } = await resCreate.json();
    expect(createdGoal.name).toBe("Dana Darurat 6 Bulan");
    expect(createdGoal.targetAmount).toBe(30_000_000);
    expect(createdGoal.currentAmount).toBe(5_000_000);
    expect(createdGoal.isEmergencyFund).toBe(true);

    // 3. Verify emergency fund calculations in GET /api/goals
    const resList = await app.request("/api/goals");
    expect(resList.status).toBe(200);
    const bodyList = await resList.json();
    expect(bodyList.goals).toHaveLength(1);
    expect(bodyList.emergencyFund.totalEmergencyFunds).toBe(5_000_000);
    // Runway should be greater than 0 based on monthly burn rate
    expect(bodyList.emergencyFund.runwayMonths).toBeGreaterThan(0);

    // 4. Contribute to goal from active wallet
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    expect(bca).toBeDefined();

    const resContribute = await app.request(`/api/goals/${createdGoal.id}/contribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 2_500_000,
        walletId: bca!.id,
        date: "2026-11-23",
        note: "Sisihkan bonus",
      }),
    });
    expect(resContribute.status).toBe(200);
    const contributeBody = await resContribute.json();
    expect(contributeBody.goal.currentAmount).toBe(7_500_000);

    // 5. Update goal
    const resUpdate = await app.request(`/api/goals/${createdGoal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dana Darurat Prioritas",
        targetAmount: 36_000_000,
      }),
    });
    expect(resUpdate.status).toBe(200);
    const { goal: updated } = await resUpdate.json();
    expect(updated.name).toBe("Dana Darurat Prioritas");
    expect(updated.targetAmount).toBe(36_000_000);

    // 6. Delete goal
    const resDelete = await app.request(`/api/goals/${createdGoal.id}`, {
      method: "DELETE",
    });
    expect(resDelete.status).toBe(200);

    const resAfterDelete = await app.request("/api/goals");
    const bodyAfterDelete = await resAfterDelete.json();
    expect(bodyAfterDelete.goals).toHaveLength(0);
  });

  it("calculates budget 50/30/20 summary and category allocations", async () => {
    const { app } = await setupTestContext();

    const res = await app.request("/api/budgets/summary");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toBeDefined();
    expect(body.needs).toBeDefined();
    expect(body.wants).toBeDefined();
    expect(body.savings).toBeDefined();
    expect(body.needs.idealPercent).toBe(50);
    expect(body.wants.idealPercent).toBe(30);
    expect(body.savings.idealPercent).toBe(20);
    expect(Array.isArray(body.needs.categories)).toBe(true);
    expect(Array.isArray(body.wants.categories)).toBe(true);
    expect(Array.isArray(body.savings.categories)).toBe(true);

    if (body.needs.categories.length > 0) {
      const firstCat = body.needs.categories[0];
      expect(firstCat.categoryName).toBeDefined();
      expect(firstCat.bucket).toBe("needs");
      expect(typeof firstCat.budgetLimit).toBe("number");
      expect(typeof firstCat.actualSpent).toBe("number");
    }
  });

  it("supports creating, updating, and deleting custom 50/30/20 categories dynamically", async () => {
    const { app } = await setupTestContext();

    // 1. Create a custom category in "wants"
    const resCreate = await app.request("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Hobi Kopi & Cafe",
        type: "expense",
        bucket: "wants",
        color: "#ff8a00",
        budgetLimit: 400_000,
      }),
    });
    expect(resCreate.status).toBe(201);
    const { category: created } = await resCreate.json();
    expect(created.name).toBe("Hobi Kopi & Cafe");
    expect(created.bucket).toBe("wants");

    // Verify it appears in budget summary under wants
    const resSummary = await app.request("/api/budgets/summary");
    const summaryBody = await resSummary.json();
    const coffeeCat = summaryBody.wants.categories.find(
      (c: { categoryName: string }) => c.categoryName === "Hobi Kopi & Cafe",
    );
    expect(coffeeCat).toBeDefined();
    expect(coffeeCat.budgetLimit).toBe(400_000);

    // 2. Update category to "savings" with new limit
    const resUpdate = await app.request(`/api/categories/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tabungan Khusus Hobi",
        bucket: "savings",
        budgetLimit: 500_000,
      }),
    });
    expect(resUpdate.status).toBe(200);

    const resSummary2 = await app.request("/api/budgets/summary");
    const summaryBody2 = await resSummary2.json();
    const updatedInSavings = summaryBody2.savings.categories.find(
      (c: { categoryName: string }) => c.categoryName === "Tabungan Khusus Hobi",
    );
    expect(updatedInSavings).toBeDefined();
    expect(updatedInSavings.budgetLimit).toBe(500_000);

    // 3. Delete category
    const resDelete = await app.request(`/api/categories/${created.id}`, {
      method: "DELETE",
    });
    expect(resDelete.status).toBe(200);

    const resSummary3 = await app.request("/api/budgets/summary");
    const summaryBody3 = await resSummary3.json();
    const deletedCat = summaryBody3.savings.categories.find(
      (c: { categoryName: string }) => c.categoryName === "Tabungan Khusus Hobi",
    );
    expect(deletedCat).toBeUndefined();
  });

  it("increases target savings wallet balance when contributing to a goal with a target wallet", async () => {
    const { db, app } = await setupTestContext();

    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bca).toBeDefined();
    expect(bni).toBeDefined();

    // Set initial balance on BCA (source) = 5.000.000 and BNI (target savings) = 0
    await app.request(`/api/wallets/${bca!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 5_000_000 }),
    });

    // Create a goal linked to BNI as target wallet
    const createRes = await app.request("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Beli Laptop M3",
        emoji: "💻",
        targetAmount: 20_000_000,
        currentAmount: 0,
        walletId: bni!.id,
      }),
    });
    expect(createRes.status).toBe(201);
    const { goal } = (await createRes.json()) as { goal: { id: number; currentAmount: number } };

    // Contribute 2.000.000 from BCA to this goal
    const contribRes = await app.request(`/api/goals/${goal.id}/contribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 2_000_000,
        walletId: bca!.id,
        date: "2026-11-23",
        note: "Setoran pertama laptop",
      }),
    });
    expect(contribRes.status).toBe(200);
    const contribJson = (await contribRes.json()) as {
      ok: boolean;
      goal: { currentAmount: number };
    };
    expect(contribJson.goal.currentAmount).toBe(2_000_000);

    // Verify source wallet (BCA) balance is 3.000.000
    const bcaBalance = await computeWalletBalance(db, bca!.id, 5_000_000);
    expect(bcaBalance).toBe(3_000_000);

    // Verify target wallet (BNI) balance is 2.000.000 (increased by contribution)
    const bniBalance = await computeWalletBalance(db, bni!.id, 0);
    expect(bniBalance).toBe(2_000_000);
  });

  it("uses totalLiquidCash per cycle and keeps unallocated stable during envelope spending and re-budgeting", async () => {
    const { db, app } = await setupTestContext();

    // 1. Set BCA openingBalance = 5.000.000 (totalLiquidCash = 5.000.000)
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    await db.update(wallets).set({ openingBalance: 5_000_000 }).where(eq(wallets.id, bca!.id));

    // Check active period (2026-11 based on current local date 2026-11-25)
    const initialSummaryRes = await app.request("/api/budgets/summary");
    expect(initialSummaryRes.status).toBe(200);
    const initialSummary = (await initialSummaryRes.json()) as {
      period: string;
      totalLiquidCash: number;
      unallocated: number;
      needs: { allocated: number };
    };
    const activePeriod = initialSummary.period;
    expect(initialSummary.totalLiquidCash).toBe(5_000_000);
    expect(initialSummary.unallocated).toBe(5_000_000);
    expect(initialSummary.needs.allocated).toBe(0);

    // 2. Allocate custom envelopes for activePeriod: 3jt needs, 1jt wants, 1jt savings
    for (const [category, limitAmount] of [
      ["bucket:needs", 3_000_000],
      ["bucket:wants", 1_000_000],
      ["bucket:savings", 1_000_000],
    ] as const) {
      const r = await app.request("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, period: activePeriod, limitAmount }),
      });
      expect(r.status).toBeLessThan(300);
    }

    const allocatedSummary = await (
      await app.request(`/api/budgets/summary?period=${activePeriod}`)
    ).json();
    expect(allocatedSummary.unallocated).toBe(0);
    expect(allocatedSummary.needs.remaining).toBe(3_000_000);

    // Next cycle (2026-12) must remain independent (0 allocated)
    const nextCycleSummary = await (
      await app.request("/api/budgets/summary?period=2026-12")
    ).json();
    expect(nextCycleSummary.needs.allocated).toBe(0);
    expect(nextCycleSummary.wants.allocated).toBe(0);
    expect(nextCycleSummary.savings.allocated).toBe(0);

    // 3. Spend 200.000 in needs -> liquid cash becomes 4.800.000, needs.remaining becomes 2.800.000, unallocated stays 0!
    const spendRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Sayur",
        amount: 200_000,
        transactionDate: "2026-11-25",
        category: "Makanan & Belanja Dapur",
        walletId: bca!.id,
      }),
    });
    expect(spendRes.status).toBe(201);

    const afterSpendSummary = await (
      await app.request(`/api/budgets/summary?period=${activePeriod}`)
    ).json();
    expect(afterSpendSummary.totalLiquidCash).toBe(4_800_000);
    expect(afterSpendSummary.needs.spent).toBe(200_000);
    expect(afterSpendSummary.needs.remaining).toBe(2_800_000);
    expect(afterSpendSummary.unallocated).toBe(0);

    // 4. Extra income +1.500.000 -> totalLiquidCash becomes 6.300.000, unallocated becomes 1.500.000 for re-budgeting
    const extraIncomeRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "income",
        merchant: "Bonus Freelance",
        amount: 1_500_000,
        transactionDate: "2026-11-25",
        category: "Usaha & Freelance",
        walletId: bca!.id,
      }),
    });
    expect(extraIncomeRes.status).toBe(201);

    const afterIncomeSummary = await (
      await app.request(`/api/budgets/summary?period=${activePeriod}`)
    ).json();
    expect(afterIncomeSummary.totalLiquidCash).toBe(6_300_000);
    expect(afterIncomeSummary.unallocated).toBe(1_500_000);
  });
});
