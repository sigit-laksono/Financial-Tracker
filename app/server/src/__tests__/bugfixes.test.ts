import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { debtAccounts, installments, transactions, wallets } from "../db/schema";
import { LoginRateLimiter } from "../lib/auth";
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
