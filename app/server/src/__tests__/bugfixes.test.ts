import { describe, expect, it } from "bun:test";
import { eq, like } from "drizzle-orm";
import {
  debtAccounts,
  goals,
  installments,
  transactions,
  transactionSplits,
  wallets,
} from "../db/schema";
import { LoginRateLimiter } from "../lib/auth";
import { resolveBudgetsForPeriod } from "../lib/budgetService";
import { buildDebtsData } from "../lib/dashboardQuery";
import { computeLedgerSnapshot } from "../lib/ledger";
import { receiveSalaryForPeriod } from "../lib/salaryService";
import { setupTestContext } from "./testHelper";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("Regression: unsettling a payroll installment keeps the salary income intact", () => {
  it("only unlinks the installment; the net salary transaction amount is unchanged", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const [acc] = await db
        .insert(debtAccounts)
        .values({
          key: "kasbon-kantor",
          name: "Kasbon Kantor",
          lender: "Kantor",
          kind: "payroll",
          direction: "payable",
          initialBalance: 2_000_000,
          paymentMethod: "Potong Gaji",
          color: "#00797a",
        })
        .returning();
      const insertedInsts = await db
        .insert(installments)
        .values([
          { accountId: acc!.id, period: "2026-10", dueDate: "2026-10-25", plannedAmount: 1_000_000, status: "upcoming" },
          { accountId: acc!.id, period: "2026-10", dueDate: "2026-10-26", plannedAmount: 1_000_000, status: "upcoming" },
        ])
        .returning();

      const salary = await receiveSalaryForPeriod(
        db,
        { period: "2026-10", grossSalary: 10_000_000, walletId: bni!.id, transactionDate: "2026-10-25" },
        "2026-10-25",
      );
      expect(salary.netSalary).toBe(8_000_000);

      const res = await app.request(`/api/installments/${insertedInsts[0]!.id}/unsettle`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ removeSettlementTx: true }),
      });
      expect(res.status).toBe(200);

      const [salaryTx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, salary.transaction.id));
      expect(salaryTx).toBeDefined();
      expect(salaryTx!.type).toBe("income");
      expect(salaryTx!.amount).toBe(8_000_000);

      const [reverted] = await db
        .select()
        .from(installments)
        .where(eq(installments.id, insertedInsts[0]!.id));
      expect(reverted!.status).toBe("upcoming");
      expect(reverted!.settlementTransactionId).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: editing a Split Pay account keeps installments in their card cycle", () => {
  it("renaming does not move unpaid installments to the due-date month", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));
      const txRes = await app.request("/api/transactions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: "expense",
          merchant: "Laptop",
          amount: 600_000,
          transactionDate: "2026-10-12",
          category: "Belanja Pribadi & Hobi",
          walletId: cc!.id,
        }),
      });
      expect(txRes.status).toBe(201);
      const { id: txId } = (await txRes.json()) as { id: number };

      const splitRes = await app.request(`/api/transactions/${txId}/convert-to-installment`, {
        method: "POST",
        headers: JSON_HEADERS,
        // Payment day 10 is before the cutoff (20), so each cycle is due the following month.
        body: JSON.stringify({
          installmentCount: 3,
          installmentAmount: 200_000,
          firstPeriod: "2026-11",
          paymentDay: 10,
        }),
      });
      expect(splitRes.status).toBeLessThan(300);
      const { accountId } = (await splitRes.json()) as { accountId: number };

      const before = await db
        .select()
        .from(installments)
        .where(eq(installments.accountId, accountId));
      const periodsBefore = before.map((r) => [r.id, r.period]).sort();
      expect(before.map((r) => r.period).sort()).toEqual(["2026-11", "2026-12", "2027-01"]);
      expect(before.find((r) => r.period === "2026-11")!.dueDate).toBe("2026-12-10");

      const renameRes = await app.request(`/api/debts/${accountId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Cicilan Laptop" }),
      });
      expect(renameRes.status).toBe(200);

      const after = await db.select().from(installments).where(eq(installments.accountId, accountId));
      expect(after.map((r) => [r.id, r.period]).sort()).toEqual(periodsBefore);

      // Moving a due date by one month shifts the cycle by one month as well.
      const first = before.find((r) => r.period === "2026-11")!;
      const [y, m, d] = first.dueDate.split("-").map(Number) as [number, number, number];
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      const movedDue = `${nextMonth}-${String(d).padStart(2, "0")}`;
      const moveRes = await app.request(`/api/debts/${accountId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          installments: before.map((r) => ({
            id: r.id,
            dueDate: r.id === first.id ? movedDue : r.dueDate,
            plannedAmount: r.plannedAmount,
          })),
        }),
      });
      expect(moveRes.status).toBe(200);
      const [moved] = await db.select().from(installments).where(eq(installments.id, first.id));
      expect(moved!.period).toBe("2026-12");
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: CSRF guard and mandatory PIN in production", () => {
  it("rejects form-type and cross-site mutating requests", async () => {
    const { app, cleanup } = await setupTestContext();
    try {
      const formRes = await app.request("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ mode: "all", confirmation: "RESET_ALL_CONFIRMED" }),
      });
      expect(formRes.status).toBe(415);

      const crossSiteRes = await app.request("/api/settings/reset", {
        method: "POST",
        headers: { ...JSON_HEADERS, "Sec-Fetch-Site": "cross-site" },
        body: JSON.stringify({ mode: "all", confirmation: "RESET_ALL_CONFIRMED" }),
      });
      expect(crossSiteRes.status).toBe(403);

      const sameOriginRead = await app.request("/api/dashboard", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      });
      expect(sameOriginRead.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("locks the data API until a PIN exists and refuses to remove the PIN", async () => {
    const { app, cleanup } = await setupTestContext();
    try {
      await withEnv({ NODE_ENV: "production", ALLOW_NO_PIN: undefined }, async () => {
        const status = await (await app.request("/api/auth/status")).json();
        expect(status).toEqual({ pinConfigured: false, authenticated: false, pinRequired: true });

        expect((await app.request("/api/dashboard")).status).toBe(401);
        expect((await app.request("/api/export")).status).toBe(401);

        const loginRes = await app.request("/api/auth/login", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ pin: "123456" }),
        });
        expect(loginRes.status).toBe(409);

        const setupRes = await app.request("/api/auth/setup", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ pin: "123456" }),
        });
        expect(setupRes.status).toBe(200);
        const cookie = setupRes.headers.get("set-cookie")!.split(";")[0]!;

        expect((await app.request("/api/dashboard", { headers: { Cookie: cookie } })).status).toBe(200);

        const removeRes = await app.request("/api/auth/change-pin", {
          method: "POST",
          headers: { ...JSON_HEADERS, Cookie: cookie },
          body: JSON.stringify({ currentPin: "123456", newPin: "" }),
        });
        expect(removeRes.status).toBe(400);
        expect((await app.request("/api/auth/status", { headers: { Cookie: cookie } })).status).toBe(200);
      });
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: PIN rate limiting under parallel requests", () => {
  it("lets at most 5 parallel guesses reach bcrypt", async () => {
    const { app, cleanup } = await setupTestContext();
    try {
      await app.request("/api/auth/setup", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ pin: "123456" }),
      });
      const results = await Promise.all(
        Array.from({ length: 30 }, () =>
          app.request("/api/auth/login", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ pin: "000000" }),
          }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(25);
    } finally {
      await cleanup();
    }
  });

  it("doubles the lockout after each repeated lockout", () => {
    const limiter = new LoginRateLimiter();
    const key = "login:1.2.3.4";
    let now = 1_000_000;
    const failFive = () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.tryAcquire(key, now).allowed).toBe(true);
        limiter.release(key, "failure", now);
      }
    };

    failFive();
    expect(limiter.check(key, now).retryAfterSeconds).toBe(60);
    now += 60_000;
    failFive();
    expect(limiter.check(key, now).retryAfterSeconds).toBe(120);
    now += 120_000;
    failFive();
    expect(limiter.check(key, now).retryAfterSeconds).toBe(240);

    // A correct PIN clears the key history.
    now += 240_000;
    expect(limiter.tryAcquire(key, now).allowed).toBe(true);
    limiter.release(key, "success", now);
    failFive();
    expect(limiter.check(key, now).retryAfterSeconds).toBe(60);
  });
});

describe("Regression: debt totals are summed per account and match auto-close", () => {
  async function seedLoan(
    db: Awaited<ReturnType<typeof setupTestContext>>["db"],
    opts: { key: string; initialBalance: number; count: number; amount: number; paidCount: number },
  ) {
    const [acc] = await db
      .insert(debtAccounts)
      .values({
        key: opts.key,
        name: opts.key,
        lender: "Bank",
        kind: "loan",
        direction: "payable",
        initialBalance: opts.initialBalance,
        paymentMethod: "Transfer",
        color: "#00797a",
      })
      .returning();
    await db.insert(installments).values(
      Array.from({ length: opts.count }, (_, i) => {
        const month = String((i % 12) + 1).padStart(2, "0");
        const year = 2027 + Math.floor(i / 12);
        const paid = i < opts.paidCount;
        return {
          accountId: acc!.id,
          period: `${year}-${month}`,
          dueDate: `${year}-${month}-10`,
          plannedAmount: opts.amount,
          status: paid ? ("paid" as const) : ("upcoming" as const),
          actualAmount: paid ? opts.amount : null,
          paidAt: paid ? new Date("2026-10-01T00:00:00.000Z") : null,
        };
      }),
    );
    return acc!;
  }

  it("an overpaid account does not hide another account's debt", async () => {
    const { db, cleanup } = await setupTestContext();
    try {
      // 10jt loan scheduled as 12 x 1jt (interest folded in), fully paid.
      const a = await seedLoan(db, { key: "loan-a", initialBalance: 10_000_000, count: 12, amount: 1_000_000, paidCount: 12 });
      // 5jt loan, nothing paid yet.
      await seedLoan(db, { key: "loan-b", initialBalance: 5_000_000, count: 5, amount: 1_000_000, paidCount: 0 });
      await db.update(debtAccounts).set({ closedAt: new Date("2026-10-01T00:00:00.000Z") }).where(eq(debtAccounts.id, a.id));

      const data = await buildDebtsData(db, "2026-10-15");
      expect(data.totals.remainingDebt).toBe(5_000_000);
      expect(data.totals.loanRemaining).toBe(5_000_000);
    } finally {
      await cleanup();
    }
  });

  it("an open account with payments still due never shows 0 remaining", async () => {
    const { db, cleanup } = await setupTestContext();
    try {
      const a = await seedLoan(db, { key: "loan-a", initialBalance: 10_000_000, count: 12, amount: 1_000_000, paidCount: 10 });
      const data = await buildDebtsData(db, "2026-10-15");
      const acc = data.accounts.find((x) => x.id === a.id)!;
      expect(acc.closedAt).toBeNull();
      // 10 of 12 equal payments made -> 2/12 of the 10jt principal remains.
      expect(acc.remainingBalance).toBe(1_666_667);
    } finally {
      await cleanup();
    }
  });

  it("a closed account settled at a discount counts as 0 remaining", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const a = await seedLoan(db, { key: "loan-a", initialBalance: 3_000_000, count: 3, amount: 1_000_000, paidCount: 0 });
      const payoff = await app.request(`/api/debts/${a.id}/payoff`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ fromWalletId: bni!.id, paymentDate: "2026-10-15", customAmount: 2_500_000 }),
      });
      expect(payoff.status).toBe(200);
      const data = await buildDebtsData(db, "2026-10-15");
      expect(data.totals.remainingDebt).toBe(0);
      expect(data.accounts.find((x) => x.id === a.id)!.remainingBalance).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: installments cannot be marked paid in a way that breaks the account", () => {
  it("rejects a custom amount below the installment total", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const createRes = await app.request("/api/debts", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: "Pinjaman",
          lender: "Teman",
          kind: "loan",
          initialBalance: 2_000_000,
          installmentCount: 2,
          installmentAmount: 1_000_000,
          firstDueDate: "2026-10-15",
          paymentMethod: "Transfer",
        }),
      });
      const { accountId } = (await createRes.json()) as { accountId: number };
      const [inst] = await db.select().from(installments).where(eq(installments.accountId, accountId));

      const res = await app.request("/api/installments/settle", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          installmentIds: [inst!.id],
          fromWalletId: bni!.id,
          paymentDate: "2026-10-15",
          customAmount: 500_000,
        }),
      });
      expect(res.status).toBe(400);
      const [after] = await db.select().from(installments).where(eq(installments.id, inst!.id));
      expect(after!.status).toBe("upcoming");
    } finally {
      await cleanup();
    }
  });

  it("rejects marking a payroll installment paid without a transaction", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const [acc] = await db
        .insert(debtAccounts)
        .values({
          key: "kasbon",
          name: "Kasbon",
          lender: "Kantor",
          kind: "payroll",
          direction: "payable",
          initialBalance: 1_000_000,
          paymentMethod: "Potong Gaji",
          color: "#00797a",
        })
        .returning();
      const [inst] = await db
        .insert(installments)
        .values({ accountId: acc!.id, period: "2026-11", dueDate: "2026-11-25", plannedAmount: 1_000_000, status: "upcoming" })
        .returning();

      const res = await app.request("/api/installments/settle", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          installmentIds: [inst!.id],
          fromWalletId: bni!.id,
          paymentDate: "2026-11-01",
          recordSettlementTx: false,
        }),
      });
      expect(res.status).toBe(400);
      const [after] = await db.select().from(installments).where(eq(installments.id, inst!.id));
      expect(after!.status).toBe("upcoming");
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: unticking Pecah Kategori removes the splits", () => {
  it("an update with splits: [] clears existing splits", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const createRes = await app.request("/api/transactions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: "expense",
          merchant: "Supermarket",
          amount: 100_000,
          transactionDate: "2026-11-20",
          category: "Makanan & Belanja Dapur",
          walletId: bni!.id,
          splits: [
            { category: "Makanan & Belanja Dapur", amount: 60_000 },
            { category: "Belanja Pribadi & Hobi", amount: 40_000 },
          ],
        }),
      });
      expect(createRes.status).toBe(201);
      const { id } = (await createRes.json()) as { id: number };
      expect(await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, id))).toHaveLength(2);

      const updateRes = await app.request(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: "expense",
          merchant: "Supermarket",
          amount: 100_000,
          transactionDate: "2026-11-20",
          category: "Makanan & Belanja Dapur",
          walletId: bni!.id,
          splits: [],
        }),
      });
      expect(updateRes.status).toBe(200);
      expect(await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, id))).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: goal progress stays in step with its transfers", () => {
  async function setupGoal(ctx: Awaited<ReturnType<typeof setupTestContext>>) {
    const { db, app } = ctx;
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    const goalRes = await app.request("/api/goals", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Liburan", targetAmount: 10_000_000, walletId: bca!.id }),
    });
    expect(goalRes.status).toBeLessThan(300);
    const goalJson = (await goalRes.json()) as { id?: number; goal?: { id: number } };
    const goalId = goalJson.goal?.id ?? goalJson.id!;

    const contribute = await app.request(`/api/goals/${goalId}/contribute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ amount: 1_000_000, walletId: bni!.id }),
    });
    expect(contribute.status).toBeLessThan(300);
    const [transfer] = await db.select().from(transactions).where(like(transactions.sourceRef, `goal:${goalId}:%`));
    expect(transfer).toBeDefined();
    return { goalId, transfer: transfer!, bni: bni!, bca: bca! };
  }

  const goalAmount = async (db: Awaited<ReturnType<typeof setupTestContext>>["db"], id: number) =>
    (await db.select().from(goals).where(eq(goals.id, id)))[0]!.currentAmount;

  it("editing the transfer amount updates progress, and deleting it removes exactly that amount", async () => {
    const ctx = await setupTestContext();
    try {
      const { goalId, transfer } = await setupGoal(ctx);
      expect(await goalAmount(ctx.db, goalId)).toBe(1_000_000);

      const edit = await ctx.app.request(`/api/transactions/${transfer.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ amount: 100_000 }),
      });
      expect(edit.status).toBe(200);
      expect(await goalAmount(ctx.db, goalId)).toBe(100_000);
      const [edited] = await ctx.db.select().from(transactions).where(eq(transactions.id, transfer.id));
      expect(edited!.merchant).toBe(transfer.merchant);

      const del = await ctx.app.request(`/api/transactions/${transfer.id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(await goalAmount(ctx.db, goalId)).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it("cascade-deleting the source wallet removes the progress it funded", async () => {
    const ctx = await setupTestContext();
    try {
      const { goalId, bni } = await setupGoal(ctx);
      const del = await ctx.app.request(`/api/wallets/${bni.id}?cascade=true`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(await goalAmount(ctx.db, goalId)).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it("a transactions-only reset removes transfer-funded progress", async () => {
    const ctx = await setupTestContext();
    try {
      const { goalId } = await setupGoal(ctx);
      const reset = await ctx.app.request("/api/settings/reset", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ confirmation: "RESET_CONFIRMED" }),
      });
      expect(reset.status).toBe(200);
      expect(await goalAmount(ctx.db, goalId)).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("Regression: low-priority server fixes", () => {
  it("budget at 99.5% is a warning, not over", () => {
    const row = {
      id: 1,
      category: "Makan",
      categoryId: null,
      period: "2026-11",
      limitAmount: 1_000_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const statusFor = (spent: number) =>
      resolveBudgetsForPeriod([row], "2026-11", new Map([["Makan", spent]]), "2026-12-24", "2026-11-30")[0]!
        .status;
    expect(statusFor(995_000)).toBe("warning");
    expect(statusFor(1_000_000)).toBe("warning");
    expect(statusFor(1_000_001)).toBe("over");
    expect(statusFor(799_999)).toBe("ok");
  });

  it("parallel budget saves for the same category and period do not 500", async () => {
    const { app, cleanup } = await setupTestContext();
    try {
      const save = (limitAmount: number) =>
        app.request("/api/budgets", {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ category: "Makanan & Belanja Dapur", period: "2026-11", limitAmount }),
        });
      const results = await Promise.all([save(500_000), save(600_000), save(700_000)]);
      for (const r of results) expect(r.status).toBeLessThan(300);
    } finally {
      await cleanup();
    }
  });

  it("an id above the Postgres int range is a 400, not a 500", async () => {
    const { app, cleanup } = await setupTestContext();
    try {
      expect((await app.request("/api/goals/99999999999", { method: "DELETE" })).status).toBe(400);
      const res = await app.request("/api/transactions?walletId=99999999999");
      expect(res.status).toBe(400);
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: double-submit does not move money twice", () => {
  it("settling the same installment twice in parallel pays it once", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const createRes = await app.request("/api/debts", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: "Pinjaman Teman",
          lender: "Teman",
          kind: "loan",
          initialBalance: 1_000_000,
          installmentCount: 1,
          installmentAmount: 1_000_000,
          firstDueDate: "2026-10-15",
          paymentMethod: "Transfer",
        }),
      });
      expect(createRes.status).toBeLessThan(300);
      const { accountId } = (await createRes.json()) as { accountId: number };
      const [inst] = await db.select().from(installments).where(eq(installments.accountId, accountId));

      const balanceBefore = (await computeLedgerSnapshot(db, "2026-10-20")).wallets.find(
        (w) => w.id === bni!.id,
      )!.balance;

      const settle = () =>
        app.request("/api/installments/settle", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            installmentIds: [inst!.id],
            fromWalletId: bni!.id,
            paymentDate: "2026-10-15",
            customAmount: 1_000_000,
          }),
        });
      const [a, b] = await Promise.all([settle(), settle()]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const balanceAfter = (await computeLedgerSnapshot(db, "2026-10-20")).wallets.find(
        (w) => w.id === bni!.id,
      )!.balance;
      expect(balanceBefore - balanceAfter).toBe(1_000_000);
    } finally {
      await cleanup();
    }
  });

  it("reconciling twice in parallel creates a single adjustment", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      const current = (await computeLedgerSnapshot(db)).wallets.find((w) => w.id === bni!.id)!.balance;
      const target = current + 500_000;

      const reconcile = () =>
        app.request(`/api/wallets/${bni!.id}/reconcile`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ actualBalance: target }),
        });
      const results = await Promise.all([reconcile(), reconcile()]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);

      const after = (await computeLedgerSnapshot(db)).wallets.find((w) => w.id === bni!.id)!.balance;
      expect(after).toBe(target);
      const adjustments = await db
        .select()
        .from(transactions)
        .where(eq(transactions.type, "adjustment"));
      expect(adjustments.filter((t) => t.walletId === bni!.id)).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
});

describe("Regression: CC bill shows what is still owed", () => {
  it("drops an installment paid on its own from the cycle's remaining bill", async () => {
    const { db, app, cleanup } = await setupTestContext();
    try {
      const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
      await app.request("/api/transactions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: "income",
          merchant: "Gaji",
          amount: 5_000_000,
          transactionDate: "2026-11-25",
          category: "Gaji",
          walletId: bni!.id,
        }),
      });

      const cardRes = await app.request("/api/wallets", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: "Jenius Cut21",
          type: "credit_card",
          creditLimit: 15_000_000,
          cutoffDay: 21,
          statementDay: 21,
          paymentDay: 7,
        }),
      });
      expect(cardRes.status).toBe(201);
      const { wallet: card } = (await cardRes.json()) as { wallet: { id: number } };

      // Both land in the 2026-12 cycle (after the 21 Nov cut-off).
      const debtRes = await app.request("/api/debts", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: "CC Nov",
          lender: "Jenius",
          kind: "card_installment",
          direction: "payable",
          walletId: card.id,
          initialBalance: 1_000_000,
          installmentCount: 1,
          installmentAmount: 1_000_000,
          firstDueDate: "2026-11-26",
          paymentMethod: "Tagihan kartu",
        }),
      });
      expect(debtRes.status).toBe(201);
      const spendRes = await app.request("/api/transactions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: "expense",
          merchant: "Warung",
          amount: 50_000,
          transactionDate: "2026-11-22",
          category: "Makanan & Belanja Dapur",
          walletId: card.id,
        }),
      });
      expect(spendRes.status).toBe(201);

      const before = await buildDebtsData(db, "2026-11-26");
      const inst = before.installments.find((i) => i.accountName === "CC Nov")!;
      const settleRes = await app.request("/api/installments/settle", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          installmentIds: [inst.id],
          fromWalletId: bni!.id,
          paymentDate: "2026-11-26",
        }),
      });
      expect(settleRes.status).toBe(200);

      // Paying the only installment auto-closes the account. Older data can hold a paid-off
      // account that is still open, which keeps its paid installment in the cycle totals.
      const reopenRes = await app.request(`/api/debts/${inst.accountId}/close`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ closed: false }),
      });
      expect(reopenRes.status).toBe(200);

      const after = await buildDebtsData(db, "2026-11-26");
      const cycle = after.cards
        .find((c) => c.walletId === card.id)!
        .cycleSummaries.find((s) => s.cycleKey === "2026-12")!;
      // The gross bill still lists the installment, but only the daily spend is still owed.
      expect(cycle.totalBill).toBe(1_050_000);
      expect(cycle.remainingBill).toBe(50_000);
      expect(cycle.unpaidInstallmentIds).toEqual([]);
      expect(cycle.settled).toBe(false);
    } finally {
      await cleanup();
    }
  });
});