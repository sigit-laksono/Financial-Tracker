import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { MAX_PG_INT } from "../../../shared/src/schemas";
import { auditLogs, budgets, goals, transactions, wallets } from "../db/schema";
import { computeWalletBalance } from "../lib/cashLedger";
import { jakartaToday } from "../lib/dates";
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

  it("calculates custom budget bucket summary and category allocations", async () => {
    const { app } = await setupTestContext();

    const res = await app.request("/api/budgets/summary");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toBeDefined();
    expect(body.needs).toBeDefined();
    expect(body.wants).toBeDefined();
    expect(body.savings).toBeDefined();
    expect(body.needs.idealPercent).toBeUndefined();
    expect(body.wants.idealPercent).toBeUndefined();
    expect(body.savings.idealPercent).toBeUndefined();
    expect(body.needs.allocationSource).toBe("none");
    expect(body.needs.categoryAllocatedTotal).toBe(0);
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

  it("supports creating, updating, and deleting custom budget categories dynamically", async () => {
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

  it("supports bottom-up category summation, clears default fallback on zeroing, and enforces manual ceiling", async () => {
    const { app } = await setupTestContext();

    const targetPeriod = "2026-11";
    const catsRes = await app.request("/api/categories");
    const { categories: catList } = (await catsRes.json()) as {
      categories: Array<{ id: number; name: string; type: string; bucket: string }>;
    };
    const needsCats = catList.filter((c) => c.type === "expense" && c.bucket === "needs");
    expect(needsCats.length).toBeGreaterThanOrEqual(2);

    // 1. Set one category in "default" and another in targetPeriod -> both sum bottom-up
    const catA = needsCats[0]!;
    const catB = needsCats[1]!;

    await app.request(`/api/categories/${catA.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetLimit: 1_000_000, period: "default" }),
    });
    await app.request(`/api/categories/${catB.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetLimit: 500_000, period: targetPeriod }),
    });

    const summary1 = await (
      await app.request(`/api/budgets/summary?period=${targetPeriod}`)
    ).json();
    expect(summary1.needs.categoryAllocatedTotal).toBe(1_500_000);
    expect(summary1.needs.allocated).toBe(1_500_000);
    expect(summary1.needs.allocationSource).toBe("categories");

    // 2. Clear catA budgetLimit to 0 -> must also remove "default" fallback
    await app.request(`/api/categories/${catA.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetLimit: 0, period: targetPeriod }),
    });

    const summary2 = await (
      await app.request(`/api/budgets/summary?period=${targetPeriod}`)
    ).json();
    expect(summary2.needs.categoryAllocatedTotal).toBe(500_000);
    expect(summary2.needs.allocated).toBe(500_000);
    expect(summary2.needs.allocationSource).toBe("categories");

    // 3. Set manual bucket:needs above subAllocated -> uses manual limit
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "bucket:needs", period: targetPeriod, limitAmount: 2_000_000 }),
    });
    const summary3 = await (
      await app.request(`/api/budgets/summary?period=${targetPeriod}`)
    ).json();
    expect(summary3.needs.allocated).toBe(2_000_000);
    expect(summary3.needs.categoryAllocatedTotal).toBe(500_000);
    expect(summary3.needs.allocationSource).toBe("manual");

    // 4. Set manual bucket:needs below subAllocated -> Math.max keeps subAllocated
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "bucket:needs", period: targetPeriod, limitAmount: 300_000 }),
    });
    const summary4 = await (
      await app.request(`/api/budgets/summary?period=${targetPeriod}`)
    ).json();
    expect(summary4.needs.allocated).toBe(500_000);
    expect(summary4.needs.allocationSource).toBe("manual");
  });

  it("prioritizes selectedPeriod over default and includes subAllocated in dashboard budgetBuckets", async () => {
    const { db, app } = await setupTestContext();
    const targetPeriod = "2026-11";

    // Insert "default" first so a naive .find() would pick it over targetPeriod
    await db.insert(budgets).values([
      { category: "bucket:needs", period: "default", limitAmount: 1_000_000 },
      { category: "bucket:needs", period: targetPeriod, limitAmount: 2_500_000 },
    ]);

    // Set a "wants" category budget without setting bucket:wants
    const catsRes = await app.request("/api/categories");
    const { categories: catList } = (await catsRes.json()) as {
      categories: Array<{ id: number; name: string; type: string; bucket: string }>;
    };
    const wantsCat = catList.find((c) => c.type === "expense" && c.bucket === "wants");
    expect(wantsCat).toBeDefined();
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: wantsCat!.name, period: targetPeriod, limitAmount: 750_000 }),
    });

    const dashRes = await app.request(`/api/dashboard?cycle=gajian&period=${targetPeriod}`);
    expect(dashRes.status).toBe(200);
    const dash = await dashRes.json();

    expect(dash.budget503020).toBeUndefined();
    expect(dash.budgetBuckets.needs.limit).toBe(2_500_000);
    expect(dash.budgetBuckets.needs.isConfigured).toBe(true);
    expect(dash.budgetBuckets.wants.limit).toBe(750_000);
    expect(dash.budgetBuckets.wants.isConfigured).toBe(true);
  });

  it("copies previous cycle category budgets without overwriting existing targets or copying bucket rows", async () => {
    const { app } = await setupTestContext();

    // Seed 2026-10 with two category budgets and a bucket:needs row
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Makanan & Belanja Dapur",
        period: "2026-10",
        limitAmount: 1_200_000,
      }),
    });
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Transportasi & Bensin",
        period: "2026-10",
        limitAmount: 600_000,
      }),
    });
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "bucket:needs",
        period: "2026-10",
        limitAmount: 3_000_000,
      }),
    });

    // Pre-existing budget in 2026-11 for Makanan & Belanja Dapur must not be overwritten
    await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Makanan & Belanja Dapur",
        period: "2026-11",
        limitAmount: 1_800_000,
      }),
    });

    const copyRes = await app.request("/api/budgets/copy-previous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPeriod: "2026-11" }),
    });
    expect(copyRes.status).toBe(200);
    const copyBody = (await copyRes.json()) as { ok: boolean; copiedCount: number };
    expect(copyBody.ok).toBe(true);
    expect(copyBody.copiedCount).toBe(1);

    const summary = await (await app.request("/api/budgets/summary?period=2026-11")).json();
    const makanan = summary.needs.categories.find(
      (c: { categoryName: string }) => c.categoryName === "Makanan & Belanja Dapur",
    );
    const transport = summary.needs.categories.find(
      (c: { categoryName: string }) => c.categoryName === "Transportasi & Bensin",
    );
    expect(makanan.budgetLimit).toBe(1_800_000);
    expect(transport.budgetLimit).toBe(600_000);
    expect(summary.needs.allocationSource).toBe("categories");
  });

  it("earmarks same-wallet/unlinked goal contributions without expense outflow and validates target wallets/dates", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const walletRows = await db.select().from(wallets);
      const bca = walletRows.find((w) => w.key === "bca")!;
      const cc = walletRows.find((w) => w.key === "cc-jenius")!;

      await db.update(wallets).set({ openingBalance: 3_000_000 }).where(eq(wallets.id, bca.id));

      // Reject invalid targetDate, credit_card walletId, and > MAX_PG_INT amount
      expect(
        (
          await app.request("/api/goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Bad Date",
              targetAmount: 1_000_000,
              targetDate: "2026-02-30",
            }),
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await app.request("/api/goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "CC Goal",
              targetAmount: 1_000_000,
              walletId: cc.id,
            }),
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await app.request("/api/goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Overflow Goal",
              targetAmount: MAX_PG_INT + 1,
            }),
          })
        ).status,
      ).toBe(400);

      // Unlinked goal contribution earmarks without inserting an expense transaction
      const createRes = await app.request("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Dana Liburan",
          targetAmount: 10_000_000,
          targetDate: "2027-06-01",
        }),
      });
      expect(createRes.status).toBe(201);
      const { goal } = (await createRes.json()) as { goal: { id: number } };

      const overdraftRes = await app.request(`/api/goals/${goal.id}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 4_000_000,
          walletId: bca.id,
          preventOverdraft: true,
        }),
      });
      expect(overdraftRes.status).toBe(400);

      const earmarkRes = await app.request(`/api/goals/${goal.id}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 1_500_000,
          walletId: bca.id,
          preventOverdraft: true,
          note: "Sisihkan di BCA",
        }),
      });
      expect(earmarkRes.status).toBe(200);
      const earmarkBody = (await earmarkRes.json()) as {
        ok: boolean;
        transactionId: number | null;
        goal: { currentAmount: number };
      };
      expect(earmarkBody.transactionId).toBeNull();
      expect(earmarkBody.goal.currentAmount).toBe(1_500_000);

      // Cash balance in BCA remains 3.000.000 (no phantom expense outflow)
      expect(await computeWalletBalance(db, bca.id, 3_000_000)).toBe(3_000_000);
      expect(await db.select().from(transactions)).toHaveLength(0);

      const earmarkLogs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "goal_contribute_earmark"));
      expect(earmarkLogs).toHaveLength(1);

      // Legacy goal with credit_card walletId is rejected on contribute
      const [legacyCcGoal] = await db
        .insert(goals)
        .values({ name: "Legacy CC", targetAmount: 1_000_000, walletId: cc.id })
        .returning();
      const ccTargetRes = await app.request(`/api/goals/${legacyCcGoal!.id}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100_000, walletId: bca.id }),
      });
      expect(ccTargetRes.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it("uses live savings wallet cash for emergency fund fallback and aggregates split needs expenses", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const today = jakartaToday();
      const walletRows = await db.select().from(wallets);
      const bca = walletRows.find((w) => w.key === "bca")!;
      const bni = walletRows.find((w) => w.key === "bni")!;

      await db.update(wallets).set({ openingBalance: 10_000_000 }).where(eq(wallets.id, bca.id));
      await db
        .update(wallets)
        .set({ role: "savings", openingBalance: 0 })
        .where(eq(wallets.id, bni.id));

      // Transfer 6jt from BCA to savings wallet BNI (openingBalance is still 0, live cash is 6jt)
      const transferRes = await app.request("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWalletId: bca.id,
          toWalletId: bni.id,
          amount: 6_000_000,
          transactionDate: today,
        }),
      });
      expect(transferRes.status).toBe(201);

      // Record split expense: 2.100.000 needs + 900.000 wants (burn rate = 2.100.000 / 3 = 700.000)
      const splitRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Supermarket",
          amount: 3_000_000,
          transactionDate: today,
          category: "Jajan & Nongkrong",
          walletId: bca.id,
          splits: [
            { category: "Makanan & Belanja Dapur", amount: 2_100_000 },
            { category: "Jajan & Nongkrong", amount: 900_000 },
          ],
        }),
      });
      expect(splitRes.status).toBe(201);

      const goalsRes = await app.request("/api/goals");
      expect(goalsRes.status).toBe(200);
      const body = (await goalsRes.json()) as {
        emergencyFund: { totalEmergencyFunds: number; monthlyNeedsBurnRate: number };
      };
      expect(body.emergencyFund.totalEmergencyFunds).toBe(6_000_000);
      expect(body.emergencyFund.monthlyNeedsBurnRate).toBe(700_000);
    } finally {
      await cleanup();
    }
  });
});
