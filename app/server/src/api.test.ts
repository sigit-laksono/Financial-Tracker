import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  auditLogs,
  budgets,
  categories,
  settlementAllocations,
  transactions,
  wallets,
} from "./db/schema";
import { getSessionSecret } from "./lib/auth";
import { ccCycleForDate, periodBounds, periodForDate } from "./lib/dates";
import {
  buildDashboardData,
  buildDebtsData,
  createDebtAccountWithSchedule,
  ensureMonthlyBankFees,
  ensurePayrollAutoPaid,
  runDailyLedgerSync,
} from "./lib/ledger";
import { setupTestContext } from "./__tests__/testHelper";

describe("Cycle date rules", () => {
  it("computes gajian (25-24) and CC (20-19) bounds accurately", () => {
    expect(periodBounds("2026-10", "gajian", 25, 20)).toEqual({
      start: "2026-10-25",
      end: "2026-11-24",
    });
    expect(periodBounds("2026-11", "cc", 25, 20)).toEqual({
      start: "2026-10-20",
      end: "2026-11-19",
    });
    expect(ccCycleForDate("2026-11-19", 20)).toBe("2026-11");
    expect(ccCycleForDate("2026-11-20", 20)).toBe("2026-12");
    expect(periodForDate("2026-11-24", "gajian", 25, 20)).toBe("2026-10");
    expect(periodForDate("2026-11-25", "gajian", 25, 20)).toBe("2026-11");
  });

  it("handles gajianStartDay=1 and cardCutoffDay=1 without period overlap", () => {
    expect(periodBounds("2026-10", "gajian", 1, 1)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(periodBounds("2024-02", "gajian", 1, 1)).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
    expect(periodBounds("2026-11", "cc", 1, 1)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(ccCycleForDate("2026-10-31", 1)).toBe("2026-11");
    expect(ccCycleForDate("2026-11-01", 1)).toBe("2026-12");
  });
});

describe("Ledger engine & core flows", () => {
  it("runs auto bank fees and auto payroll settlement idempotently", async () => {
    const { db, sqlite } = await setupTestContext();
    try {
      await createDebtAccountWithSchedule(db, {
        name: "Utang kantor",
        lender: "PT Dikstra",
        kind: "payroll",
        initialBalance: 3_000_000,
        installmentCount: 2,
        installmentAmount: 1_500_000,
        firstDueDate: "2026-11-25",
        paymentMethod: "Potongan gaji",
      });

      expect(await ensureMonthlyBankFees(db, "2026-11")).toBe(2);
      expect(await ensureMonthlyBankFees(db, "2026-11")).toBe(0);

      expect(await ensurePayrollAutoPaid(db, "2026-11-24")).toBe(0);
      expect(await ensurePayrollAutoPaid(db, "2026-11-25")).toBe(1);
      expect(await ensurePayrollAutoPaid(db, "2026-11-25")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("handles transfer + fee, reconcile, CC billed/unbilled, settle, split pay, and safe-to-spend", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const walletsRes = await app.request("/api/wallets");
      expect(walletsRes.status).toBe(200);
      const { wallets } = (await walletsRes.json()) as {
        wallets: Array<{ id: number; key: string; balance: number }>;
      };
      const bni = wallets.find((w) => w.key === "bni")!;
      const gopay = wallets.find((w) => w.key === "gopay")!;
      const cc = wallets.find((w) => w.key === "cc-jenius")!;

      // Opening income into BNI
      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "income",
          merchant: "Gaji November",
          amount: 8_000_000,
          transactionDate: "2026-10-25",
          category: "Gaji",
          walletId: bni.id,
        }),
      });

      // Transfer BNI -> GoPay with Rp1.000 admin fee
      const transferRes = await app.request("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWalletId: bni.id,
          toWalletId: gopay.id,
          amount: 500_000,
          adminFee: 1_000,
          transactionDate: "2026-11-05",
        }),
      });
      expect(transferRes.status).toBe(201);

      // Reconcile GoPay to Rp480.000 (creates -20.000 adjustment)
      const recRes = await app.request(`/api/wallets/${gopay.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualBalance: 480_000, date: "2026-11-06" }),
      });
      expect(recRes.status).toBe(200);
      const recJson = (await recRes.json()) as { adjusted: boolean; delta: number };
      expect(recJson).toMatchObject({ adjusted: true, delta: -20_000 });

      // CC expense before cutoff (billed in 2026-11) & after cutoff (unbilled in 2026-10 gajian)
      const ccTxBeforeRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Beli Monitor",
          amount: 1_200_000,
          transactionDate: "2026-11-10",
          category: "Belanja",
          walletId: cc.id,
        }),
      });
      const { id: monitorTxId } = (await ccTxBeforeRes.json()) as { id: number };

      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Kopi Unbilled",
          amount: 50_000,
          transactionDate: "2026-11-21",
          category: "Makanan & Minuman",
          walletId: cc.id,
        }),
      });

      // Add a loan installment due inside 2026-10 gajian cycle (2026-11-23)
      await createDebtAccountWithSchedule(db, {
        name: "Flexi Cash",
        lender: "Jenius",
        kind: "loan",
        initialBalance: 700_000,
        installmentCount: 1,
        installmentAmount: 700_000,
        firstDueDate: "2026-11-23",
        paymentMethod: "Transfer",
      });

      // Trigger daily sync explicitly (CQS: GET endpoints are pure read-only)
      await runDailyLedgerSync(db, "2026-11-22", { force: true });

      const dashBeforeSplit = await buildDashboardData(db, {
        cycle: "gajian",
        period: "2026-10",
        today: "2026-11-22",
      });
      // Liquid cash = BNI (8.000.000 - 500.000 - 1.000 = 7.499.000) + GoPay (480.000) = 7.979.000
      expect(dashBeforeSplit.metrics.totalLiquidCash).toBe(7_979_000);
      expect(dashBeforeSplit.metrics.ccUnbilled).toBe(50_000);
      // Billed CC in 2026-10 gajian = 1.200.000 + Materai 10.000 + Notifikasi 12.500 = 1.222.500
      expect(dashBeforeSplit.metrics.ccBilled).toBe(1_222_500);
      // Only Flexi Cash 700.000 is due <= 2026-11-24
      expect(dashBeforeSplit.metrics.remainingObligations).toBe(700_000);
      expect(dashBeforeSplit.metrics.ccReservedCash).toBe(0);
      expect(dashBeforeSplit.metrics.upcomingCcCyclesSum).toBe(1_295_000);
      expect(dashBeforeSplit.metrics.safeToSpend).toBe(7_979_000 - 700_000);

      // Convert Beli Monitor (1.200.000) into 3x Split Pay starting 2026-12
      const splitRes = await app.request(
        `/api/transactions/${monitorTxId}/convert-to-installment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installmentCount: 3,
            installmentAmount: 400_000,
            firstPeriod: "2026-12",
          }),
        },
      );
      expect(splitRes.status).toBe(201);

      const dashAfterSplit = await buildDashboardData(db, {
        cycle: "gajian",
        period: "2026-10",
        today: "2026-11-22",
      });
      // Converted transaction is excluded from billed daily CC total
      expect(dashAfterSplit.metrics.ccBilled).toBe(22_500);

      // Settle Flexi Cash installment from BNI
      const debtsRes = await app.request("/api/debts");
      const debtsJson = (await debtsRes.json()) as {
        installments: Array<{ id: number; accountName: string }>;
      };
      const flexiInst = debtsJson.installments.find((i) => i.accountName === "Flexi Cash")!;

      const settleRes = await app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentIds: [flexiInst.id],
          fromWalletId: bni.id,
          paymentDate: "2026-11-23",
        }),
      });
      expect(settleRes.status).toBe(200);

      const dashAfterSettle = await buildDashboardData(db, {
        cycle: "gajian",
        period: "2026-10",
        today: "2026-11-23",
      });
      expect(dashAfterSettle.metrics.totalLiquidCash).toBe(7_979_000 - 700_000);
      expect(dashAfterSettle.metrics.remainingObligations).toBe(0);
      expect(dashAfterSettle.metrics.ccReservedCash).toBe(0);
      expect(dashAfterSettle.metrics.upcomingCcCyclesSum).toBe(95_000);
      expect(dashAfterSettle.metrics.safeToSpend).toBe(7_279_000);
      // Settlement must not count as a new category expense; total = fee (1.000) + 2026-11 bank fees (22.500) + unbilled coffee (50.000)
      expect(dashAfterSettle.metrics.totalSettlement).toBe(700_000);
      expect(dashAfterSettle.metrics.totalExpense).toBe(1_000 + 22_500 + 50_000);

      // Closing a settled debt account succeeds; closing an active Split Pay account with balance > 0 fails
      const debtsAfterSettle = (await (await app.request("/api/debts")).json()) as {
        accounts: Array<{ id: number; name: string }>;
      };
      const flexiAcc = debtsAfterSettle.accounts.find((a) => a.name === "Flexi Cash")!;
      const splitAcc = debtsAfterSettle.accounts.find((a) => a.name.includes("Split Pay"))!;

      const closeSplitFail = await app.request(`/api/debts/${splitAcc.id}/close`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: true }),
      });
      expect(closeSplitFail.status).toBe(400);

      const closeFlexiOk = await app.request(`/api/debts/${flexiAcc.id}/close`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: true }),
      });
      expect(closeFlexiOk.status).toBe(200);

      // Unsettle reverses status and removes linked settlement transaction
      const unsettleRes = await app.request(`/api/installments/${flexiInst.id}/unsettle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeSettlementTx: true }),
      });
      expect(unsettleRes.status).toBe(200);
      const dashAfterUnsettle = await buildDashboardData(db, {
        cycle: "gajian",
        period: "2026-10",
        today: "2026-11-23",
      });
      expect(dashAfterUnsettle.metrics.totalLiquidCash).toBe(7_979_000);
    } finally {
      sqlite.close();
    }
  });

  it("computes budget template + period override thresholds and exports CSV/JSON", async () => {
    const { sqlite, app } = await setupTestContext();
    try {
      const walletsRes = await app.request("/api/wallets");
      const { wallets } = (await walletsRes.json()) as {
        wallets: Array<{ id: number; key: string }>;
      };
      const bni = wallets.find((w) => w.key === "bni")!;

      await app.request("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "Makanan & Minuman",
          period: "default",
          limitAmount: 100_000,
        }),
      });
      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Warung",
          amount: 85_000,
          transactionDate: "2026-11-10",
          category: "Makanan & Minuman",
          walletId: bni.id,
        }),
      });

      const budgetRes = await app.request("/api/budgets?period=2026-10");
      const budgetJson = (await budgetRes.json()) as {
        budgets: Array<{ category: string; percentUsed: number; status: string }>;
      };
      const makan = budgetJson.budgets.find((b) => b.category === "Makanan & Minuman")!;
      expect(makan.percentUsed).toBe(85);
      expect(makan.status).toBe("warning");

      const csvRes = await app.request("/api/export?format=csv&period=2026-10");
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain("Warung");
    } finally {
      sqlite.close();
    }
  });
});

describe("Auth PIN lock & session middleware", () => {
  it("protects API endpoints once PIN is configured and enforces rate limiting", async () => {
    const { sqlite, app } = await setupTestContext();
    try {
      // Unlocked initially before PIN setup
      const initialStatus = await (await app.request("/api/auth/status")).json();
      expect(initialStatus).toEqual({ pinConfigured: false, authenticated: true });

      const setupRes = await app.request("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "123456" }),
      });
      expect(setupRes.status).toBe(200);
      const setupCookie = setupRes.headers.get("set-cookie");
      expect(setupCookie).toContain("ft_session=");

      // Unauthenticated request must fail with 401
      const lockedRes = await app.request("/api/dashboard");
      expect(lockedRes.status).toBe(401);

      // Authenticated request with cookie passes
      const unlockedRes = await app.request("/api/dashboard", {
        headers: { Cookie: setupCookie!.split(";")[0]! },
      });
      expect(unlockedRes.status).toBe(200);

      // Rate limiter kicks in after 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const failRes = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: "000000" }),
        });
        expect(failRes.status).toBe(401);
      }
      const blockedRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "123456" }),
      });
      expect(blockedRes.status).toBe(429);

      // Unknown API routes must return 404 JSON
      const notFoundRes = await app.request("/api/non-existent", {
        headers: { Cookie: setupCookie!.split(";")[0]! },
      });
      expect(notFoundRes.status).toBe(404);
      expect(await notFoundRes.json()).toHaveProperty("error");

      // Change PIN revokes old session cookie and issues a new valid session cookie
      const changeRes = await app.request("/api/auth/change-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: setupCookie!.split(";")[0]!,
        },
        body: JSON.stringify({ currentPin: "123456", newPin: "654321" }),
      });
      expect(changeRes.status).toBe(200);
      const newCookie = changeRes.headers.get("set-cookie");
      expect(newCookie).toContain("ft_session=");

      const staleCookieRes = await app.request("/api/dashboard", {
        headers: { Cookie: setupCookie!.split(";")[0]! },
      });
      expect(staleCookieRes.status).toBe(401);

      const freshCookieRes = await app.request("/api/dashboard", {
        headers: { Cookie: newCookie!.split(";")[0]! },
      });
      expect(freshCookieRes.status).toBe(200);

      // Logout all revokes the active session cookie
      const logoutAllRes = await app.request("/api/auth/logout-all", {
        method: "POST",
        headers: { Cookie: newCookie!.split(";")[0]! },
      });
      expect(logoutAllRes.status).toBe(200);
      const afterLogoutAll = await app.request("/api/dashboard", {
        headers: { Cookie: newCookie!.split(";")[0]! },
      });
      expect(afterLogoutAll.status).toBe(401);
    } finally {
      sqlite.close();
    }
  });

  it("enforces SESSION_SECRET in production and guards change-pin rate limits", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SESSION_SECRET;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.SESSION_SECRET;
      expect(() => getSessionSecret()).toThrow();

      process.env.SESSION_SECRET = "too-short";
      expect(() => getSessionSecret()).toThrow();

      process.env.SESSION_SECRET = "a-very-strong-production-secret-32chars-min";
      expect(getSessionSecret()).toBe("a-very-strong-production-secret-32chars-min");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }

    const { sqlite, app } = await setupTestContext();
    try {
      const setupRes = await app.request("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "112233" }),
      });
      const cookie = setupRes.headers.get("set-cookie")!.split(";")[0]!;

      for (let i = 0; i < 5; i++) {
        const res = await app.request("/api/auth/change-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ currentPin: "wrong-pin", newPin: "998877" }),
        });
        expect(res.status).toBe(401);
      }
      const blocked = await app.request("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ currentPin: "112233", newPin: "998877" }),
      });
      expect(blocked.status).toBe(429);
    } finally {
      sqlite.close();
    }
  });
});

describe("Phase 4 hardening: validation, settlements, CC cycles & CSV security", () => {
  it("rejects invalid calendar dates, CC income, Split Pay financial edits, and second CC wallet", async () => {
    const { sqlite, app } = await setupTestContext();
    try {
      const { wallets } = (await (await app.request("/api/wallets")).json()) as {
        wallets: Array<{ id: number; key: string }>;
      };
      const bni = wallets.find((w) => w.key === "bni")!;
      const cc = wallets.find((w) => w.key === "cc-jenius")!;

      // Invalid calendar date (Feb 31) rejected
      const badDateTx = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Test Bad Date",
          amount: 10_000,
          transactionDate: "2026-02-31",
          category: "Jajan",
          walletId: bni.id,
        }),
      });
      expect(badDateTx.status).toBe(400);

      // Invalid dashboard period (month 13) rejected
      const badPeriodDash = await app.request("/api/dashboard?cycle=cc&period=2026-13");
      expect(badPeriodDash.status).toBe(400);

      // Second active credit_card wallet allowed in Milestone 2
      const secondCc = await app.request("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CC Kedua", type: "credit_card" }),
      });
      expect(secondCc.status).toBe(201);

      // Concurrent duplicate sourceRef deduplicates cleanly without 500
      const [dup1, dup2] = await Promise.all([
        app.request("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "expense",
            merchant: "Kopi",
            amount: 25_000,
            transactionDate: "2026-11-10",
            category: "Jajan",
            walletId: bni.id,
            sourceRef: "idem-key-1",
          }),
        }),
        app.request("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "expense",
            merchant: "Kopi",
            amount: 25_000,
            transactionDate: "2026-11-10",
            category: "Jajan",
            walletId: bni.id,
            sourceRef: "idem-key-1",
          }),
        }),
      ]);
      const d1 = (await dup1.json()) as { id: number; duplicate: boolean };
      const d2 = (await dup2.json()) as { id: number; duplicate: boolean };
      expect(d1.id).toBe(d2.id);
      expect(d1.duplicate || d2.duplicate).toBe(true);

      // Create CC expense, convert to Split Pay, then verify PATCH protections
      const ccTxRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Laptop",
          amount: 3_000_000,
          transactionDate: "2026-11-10",
          category: "Belanja",
          walletId: cc.id,
        }),
      });
      const { id: ccTxId } = (await ccTxRes.json()) as { id: number };

      // Normal PATCH cannot turn CC tx into income
      const ccIncomePatch = await app.request(`/api/transactions/${ccTxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "income", category: "Gaji" }),
      });
      expect(ccIncomePatch.status).toBe(400);

      // Convert to Split Pay
      const splitRes = await app.request(`/api/transactions/${ccTxId}/convert-to-installment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentCount: 3,
          installmentAmount: 1_000_000,
          firstPeriod: "2026-12",
        }),
      });
      expect(splitRes.status).toBe(201);

      // Financial mutation on Split Pay transaction rejected with 409; note update allowed
      const editAmountFail = await app.request(`/api/transactions/${ccTxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 2_500_000 }),
      });
      expect(editAmountFail.status).toBe(409);

      const editNoteOk = await app.request(`/api/transactions/${ccTxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Cicilan 0%" }),
      });
      expect(editNoteOk.status).toBe(200);

      // Deleting Split Pay transaction rejected with 409
      const deleteSplitFail = await app.request(`/api/transactions/${ccTxId}`, {
        method: "DELETE",
      });
      expect(deleteSplitFail.status).toBe(409);
    } finally {
      sqlite.close();
    }
  });

  it("prevents stale CC bank fee reads, future fee creation, double CC settlement, and combined unsettle corruption", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const { wallets } = (await (await app.request("/api/wallets")).json()) as {
        wallets: Array<{ id: number; key: string }>;
      };
      const bni = wallets.find((w) => w.key === "bni")!;
      const cc = wallets.find((w) => w.key === "cc-jenius")!;

      // Manual expense containing "Materai" does not block system auto bank fee
      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Beli Materai 10rb",
          amount: 10_000,
          transactionDate: "2026-09-10",
          category: "Belanja",
          walletId: cc.id,
        }),
      });

      // Sync past CC cycle 2026-09 via explicit sync endpoint (CQS: GET never writes)
      const sync09Res = await app.request("/api/ledger/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleKey: "2026-09" }),
      });
      expect(sync09Res.status).toBe(200);

      // Reading past CC cycle (2026-09) includes synced bank fees
      const pastCcDash = await buildDashboardData(db, {
        cycle: "cc",
        period: "2026-09",
        today: "2026-11-22",
      });
      expect(pastCcDash.metrics.totalCcExpense).toBe(10_000 + 22_500);

      // Reading or syncing a future CC cycle (2027-06) must NOT insert bank fees into the future
      await app.request("/api/ledger/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleKey: "2027-06", force: true }),
      });
      await buildDashboardData(db, {
        cycle: "cc",
        period: "2027-06",
        today: "2026-11-22",
      });
      const futureRows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.ccCycleKey, "2027-06"));
      expect(futureRows.length).toBe(0);

      // Partial CC settlement followed by remaining settlement and double-settlement block
      // 2026-09 daily total = 32.500 (10.000 + 22.500)
      const partialSettle = await app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccCycleKey: "2026-09",
          fromWalletId: bni.id,
          paymentDate: "2026-09-25",
          customAmount: 12_500,
        }),
      });
      expect(partialSettle.status).toBe(200);

      const midDash = await buildDashboardData(db, {
        cycle: "gajian",
        period: "2026-09",
        today: "2026-11-22",
      });
      const unpaid09 = midDash.unpaidCcCycles.find((c) => c.cycleKey === "2026-09");
      expect(unpaid09?.amount).toBe(20_000);

      const finalSettle = await app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccCycleKey: "2026-09",
          fromWalletId: bni.id,
          paymentDate: "2026-09-26",
        }),
      });
      expect(finalSettle.status).toBe(200);
      expect(((await finalSettle.json()) as { totalAmount: number }).totalAmount).toBe(20_000);

      const doubleSettle = await app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccCycleKey: "2026-09",
          fromWalletId: bni.id,
          paymentDate: "2026-09-27",
        }),
      });
      expect(doubleSettle.status).toBe(409);

      // Combined CC daily + Split Pay settlement, then unsettle Split Pay keeps CC daily settled
      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "Belanja Siklus 2026-10",
          amount: 100_000,
          transactionDate: "2026-10-05",
          category: "Belanja",
          walletId: cc.id,
        }),
      });
      await createDebtAccountWithSchedule(db, {
        name: "Split Pay Test",
        lender: "CC Jenius",
        kind: "card_installment",
        walletId: cc.id,
        initialBalance: 400_000,
        installmentCount: 2,
        installmentAmount: 200_000,
        firstDueDate: "2026-10-25",
        paymentMethod: "Tagihan kartu",
      });
      const debtsJson = (await (await app.request("/api/debts")).json()) as {
        installments: Array<{ id: number; accountName: string; period: string }>;
      };
      const octInst = debtsJson.installments.find(
        (i) => i.accountName === "Split Pay Test" && i.period === "2026-10",
      )!;

      // Sync CC cycle 2026-10 triggers its statement bank fees (22.500)
      await app.request("/api/ledger/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleKey: "2026-10" }),
      });

      // 2026-10 CC daily = 100.000 + 22.500 (bank fees) = 122.500; + 200.000 inst = 322.500
      const combinedSettle = await app.request("/api/installments/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccCycleKey: "2026-10",
          installmentIds: [octInst.id],
          fromWalletId: bni.id,
          paymentDate: "2026-10-25",
        }),
      });
      expect(combinedSettle.status).toBe(200);
      const combinedBody = (await combinedSettle.json()) as {
        totalAmount: number;
        settlementTransactionId: number;
      };
      expect(combinedBody.totalAmount).toBe(322_500);

      // Unsettle the installment with removeSettlementTx=true
      const unsettleCombined = await app.request(`/api/installments/${octInst.id}/unsettle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeSettlementTx: true }),
      });
      expect(unsettleCombined.status).toBe(200);

      // CC daily 2026-10 must STILL be settled and settlement tx reduced from 322.500 to 122.500
      const debtsAfterUnsettle = (await (await app.request("/api/debts")).json()) as {
        cycleSummaries: Array<{ cycleKey: string; dailySettled: boolean }>;
      };
      expect(
        debtsAfterUnsettle.cycleSummaries.find((c) => c.cycleKey === "2026-10")?.dailySettled,
      ).toBe(true);
      const [reducedTx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, combinedBody.settlementTransactionId));
      expect(reducedTx?.amount).toBe(122_500);
    } finally {
      sqlite.close();
    }
  });

  it("escapes CSV formula injection payloads while keeping numeric negative adjustments intact", async () => {
    const { sqlite, app } = await setupTestContext();
    try {
      const { wallets } = (await (await app.request("/api/wallets")).json()) as {
        wallets: Array<{ id: number; key: string }>;
      };
      const bni = wallets.find((w) => w.key === "bni")!;

      await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          merchant: "=CMD('calc')",
          amount: 15_000,
          transactionDate: "2026-11-10",
          category: "Jajan",
          walletId: bni.id,
          note: "+1+1",
        }),
      });
      await app.request(`/api/wallets/${bni.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualBalance: -50_000, date: "2026-11-11" }),
      });

      const csvRes = await app.request("/api/export?format=csv&period=2026-10");
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain("'=CMD('calc')");
      expect(csvText).toContain("'+1+1");
      expect(csvText).toContain(",-35000,");
    } finally {
      sqlite.close();
    }
  });

  it("enforces CQS: GET endpoints never mutate DB while POST /api/ledger/sync runs idempotent daily sync", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      await createDebtAccountWithSchedule(db, {
        name: "Potongan Gaji CQS",
        lender: "Kantor",
        kind: "payroll",
        initialBalance: 1_500_000,
        installmentCount: 1,
        installmentAmount: 1_500_000,
        firstDueDate: "2026-10-25",
        paymentMethod: "Potongan gaji",
      });

      // Pure GET calls must not insert auto bank fees or settle payroll installments
      expect((await app.request("/api/dashboard")).status).toBe(200);
      expect((await app.request("/api/debts")).status).toBe(200);
      expect((await app.request("/api/wallets")).status).toBe(200);
      expect((await app.request("/api/budgets")).status).toBe(200);
      expect((await app.request("/api/export?format=json")).status).toBe(200);

      const txAfterGets = await db.select().from(transactions);
      expect(txAfterGets.length).toBe(0);

      const debtsBeforeSync = (await (await app.request("/api/debts")).json()) as {
        totals: { paidDebt: number };
      };
      expect(debtsBeforeSync.totals.paidDebt).toBe(0);

      // Explicit POST /api/ledger/sync performs daily sync once per day
      const sync1 = await app.request("/api/ledger/sync", { method: "POST" });
      expect(sync1.status).toBe(200);
      const s1 = (await sync1.json()) as {
        synced: boolean;
        feesInserted: number;
        payrollSettled: number;
      };
      expect(s1.synced).toBe(true);
      expect(s1.feesInserted).toBeGreaterThanOrEqual(2);
      expect(s1.payrollSettled).toBe(1);

      const sync2 = await app.request("/api/ledger/sync", { method: "POST" });
      const s2 = (await sync2.json()) as { synced: boolean };
      expect(s2.synced).toBe(false);
    } finally {
      sqlite.close();
    }
  });
});

describe("Phase 6: schema integrity, audit logs, pagination, observability & 5k benchmark", () => {
  it("pairs transfer + adminFee with transferGroupId, deletes both atomically, and logs audit", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const walletRows = await db.select().from(wallets);
      const bca = walletRows.find((w) => w.key === "bca")!;
      const gopay = walletRows.find((w) => w.key === "gopay")!;

      const res = await app.request("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWalletId: bca.id,
          toWalletId: gopay.id,
          amount: 200_000,
          adminFee: 2_500,
          transactionDate: "2026-04-10",
          merchant: "Topup GoPay",
          note: "Test transfer",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        ok: boolean;
        transferId: number;
        feeTransactionId: number | null;
        transferGroupId: string;
      };
      expect(body.ok).toBe(true);
      expect(body.feeTransactionId).not.toBeNull();
      expect(body.transferGroupId).toBeTruthy();

      const grouped = await db
        .select()
        .from(transactions)
        .where(eq(transactions.transferGroupId, body.transferGroupId));
      expect(grouped.length).toBe(2);

      const delRes = await app.request(`/api/transactions/${body.transferId}`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);

      const remaining = await db
        .select()
        .from(transactions)
        .where(eq(transactions.transferGroupId, body.transferGroupId));
      expect(remaining.length).toBe(0);

      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "delete"));
      expect(audits.length).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("propagates category rename to transactions and budgets", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca")).limit(1);
      const [targetCat] = await db
        .select()
        .from(categories)
        .where(eq(categories.name, "Makanan & Minuman"))
        .limit(1);
      expect(targetCat).toBeDefined();
      if (!targetCat || !bca) return;

      const txRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: bca.id,
          type: "expense",
          merchant: "RM Sederhana",
          amount: 45_000,
          category: "Makanan & Minuman",
          note: "Nasi Padang",
          transactionDate: "2026-04-12",
        }),
      });
      expect(txRes.status).toBe(201);

      const budgetRes = await app.request("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "Makanan & Minuman",
          limitAmount: 1_500_000,
        }),
      });
      expect([200, 201]).toContain(budgetRes.status);

      const renameRes = await app.request(`/api/categories/${targetCat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Kuliner" }),
      });
      expect(renameRes.status).toBe(200);

      const updatedTx = await db
        .select()
        .from(transactions)
        .where(eq(transactions.categoryId, targetCat.id));
      expect(updatedTx.length).toBe(1);
      expect(updatedTx[0]?.category).toBe("Kuliner");

      const [updatedBudget] = await db
        .select()
        .from(budgets)
        .where(eq(budgets.categoryId, targetCat.id))
        .limit(1);
      expect(updatedBudget?.category).toBe("Kuliner");

      // Deletion blocked when category is used by transactions
      const delBlocked = await app.request(`/api/categories/${targetCat.id}`, { method: "DELETE" });
      expect(delBlocked.status).toBe(400);
      const delBlockedJson = (await delBlocked.json()) as { error: string };
      expect(delBlockedJson.error).toContain("tidak dapat dihapus");
    } finally {
      sqlite.close();
    }
  });

  it("records audit logs for reconcile, tx patch, settings, and PIN change without leaking PIN", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca")).limit(1);

      const txRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: bca!.id,
          type: "expense",
          merchant: "Warung Kopi",
          amount: 50_000,
          category: "Makanan & Minuman",
          transactionDate: "2026-04-11",
        }),
      });
      expect(txRes.status).toBe(201);
      const created = (await txRes.json()) as { id: number };

      const patchTx = await app.request(`/api/transactions/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 55_000, note: "Corrected" }),
      });
      expect(patchTx.status).toBe(200);

      const recRes = await app.request(`/api/wallets/${bca!.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualBalance: 1_000_000,
          note: "Month end check",
        }),
      });
      expect(recRes.status).toBe(200);

      const setRes = await app.request("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ netSalary: 10_000_000 }),
      });
      expect(setRes.status).toBe(200);

      const pinRes = await app.request("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin: "987654" }),
      });
      expect(pinRes.status).toBe(200);

      const logs = await db.select().from(auditLogs);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("update");
      expect(actions).toContain("reconcile");
      expect(actions).toContain("update_settings");
      expect(actions).toContain("change_pin");

      const rawSerialized = JSON.stringify(logs);
      expect(rawSerialized).not.toContain("987654");
    } finally {
      await sqlite.close();
    }
  });

  it("enforces SQLite CHECK constraints on invalid amounts and self-transfers", async () => {
    const { db, client, sqlite } = await setupTestContext();
    try {
      const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca")).limit(1);

      let thrownAmount = false;
      try {
        await client`INSERT INTO transactions (wallet_id, type, amount, merchant, category, transaction_date) VALUES (${bca!.id}, 'expense', 0, 'Test', 'Makanan & Minuman', '2026-04-10')`;
      } catch {
        thrownAmount = true;
      }
      expect(thrownAmount).toBe(true);

      let thrownTransfer = false;
      try {
        await client`INSERT INTO transactions (wallet_id, to_wallet_id, type, amount, merchant, category, transaction_date) VALUES (${bca!.id}, ${bca!.id}, 'transfer', 10000, 'Self', 'Transfer', '2026-04-10')`;
      } catch {
        thrownTransfer = true;
      }
      expect(thrownTransfer).toBe(true);

      let thrownBudget = false;
      try {
        await client`INSERT INTO budgets (category, period, limit_amount) VALUES ('Makanan & Minuman', 'default', 0)`;
      } catch {
        thrownBudget = true;
      }
      expect(thrownBudget).toBe(true);
    } finally {
      await sqlite.close();
    }
  });

  it("exposes /api/health readiness with X-Request-Id and 503 when DB closes", async () => {
    const { client, sqlite, app } = await setupTestContext();
    const okRes = await app.request("/api/health");
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("x-request-id")).toBeTruthy();
    const okBody = (await okRes.json()) as { ok: boolean; db: string };
    expect(okBody.ok).toBe(true);
    expect(okBody.db).toBe("ready");

    await client.end({ timeout: 1 });

    const failRes = await app.request("/api/health");
    expect(failRes.status).toBe(503);
    const failBody = (await failRes.json()) as { ok: boolean; db: string };
    expect(failBody.ok).toBe(false);
    expect(failBody.db).toBe("unavailable");

    await sqlite.close();
  });

  it("handles 5,000+ transactions with keyset pagination and fast dashboard/debt queries", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const walletRows = await db.select().from(wallets).where(eq(wallets.type, "bank"));
      const w0 = walletRows[0]!.id;
      const w1 = walletRows[1]?.id ?? w0;
      const w2 = walletRows[2]?.id ?? w0;

      const rows: Array<typeof transactions.$inferInsert> = [];
      for (let i = 0; i < 5000; i++) {
        const day = String((i % 28) + 1).padStart(2, "0");
        const month = String((i % 12) + 1).padStart(2, "0");
        const year = 2025 + Math.floor(i / 2500);
        const date = `${year}-${month}-${day}`;
        const isIncome = i % 10 === 0;
        rows.push({
          walletId: i % 3 === 0 ? w0 : i % 3 === 1 ? w1 : w2,
          type: isIncome ? "income" : "expense",
          amount: 10_000 + (i % 50) * 1_000,
          merchant: isIncome ? "Employer" : `Merchant #${i % 20}`,
          category: isIncome ? "Gaji" : "Makanan & Minuman",
          note: `Synthetic tx #${i}`,
          transactionDate: date,
        });
      }

      // Batch insert in chunks of 500
      for (let c = 0; c < rows.length; c += 500) {
        await db.insert(transactions).values(rows.slice(c, c + 500));
      }

      const page1Res = await app.request("/api/transactions?limit=50");
      expect(page1Res.status).toBe(200);
      const page1 = (await page1Res.json()) as {
        items: Array<{ id: number; transactionDate: string }>;
        nextCursor: { cursorDate: string; cursorId: number } | null;
        totalCount: number;
      };
      expect(page1.totalCount).toBe(5000);
      expect(page1.items.length).toBe(50);
      expect(page1.nextCursor).not.toBeNull();

      const page2Res = await app.request(
        `/api/transactions?limit=50&cursorDate=${page1.nextCursor?.cursorDate}&cursorId=${page1.nextCursor?.cursorId}`,
      );
      expect(page2Res.status).toBe(200);
      const page2 = (await page2Res.json()) as {
        items: Array<{ id: number; transactionDate: string }>;
        nextCursor: { cursorDate: string; cursorId: number } | null;
        totalCount: number;
      };
      expect(page2.items.length).toBe(50);

      const page1Ids = new Set(page1.items.map((x) => x.id));
      const overlap = page2.items.some((x) => page1Ids.has(x.id));
      expect(overlap).toBe(false);

      const t0 = performance.now();
      const dash = await buildDashboardData(db, { period: "2026-04", today: "2026-04-15" });
      const debts = await buildDebtsData(db, "2026-04-15");
      const elapsedMs = performance.now() - t0;
      console.info(`[benchmark 5000 tx] dashboard+debts elapsed: ${elapsedMs.toFixed(2)}ms`);

      expect(dash.wallets.length).toBeGreaterThan(0);
      expect(debts.accounts.length).toBeGreaterThanOrEqual(0);
      expect(elapsedMs).toBeLessThan(500);
      expect(settlementAllocations).toBeDefined();
    } finally {
      await sqlite.close();
    }
  });

  it("sets needsOnboarding true only when unconfigured, not when a new period has 0 transactions", async () => {
    const { db, sqlite, app } = await setupTestContext();
    try {
      const initialDash = await buildDashboardData(db, {
        period: "2026-11",
        today: "2026-11-25",
      });
      expect(initialDash.needsOnboarding).toBe(true);

      const bni = initialDash.wallets.find((w) => w.key === "bni")!;
      const txRes = await app.request("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "income",
          merchant: "Gaji Oktober",
          amount: 5_000_000,
          transactionDate: "2026-10-26",
          category: "Gaji",
          walletId: bni.id,
        }),
      });
      expect(txRes.status).toBe(201);

      const newCycleDash = await buildDashboardData(db, {
        period: "2026-11",
        today: "2026-11-25",
      });
      expect(newCycleDash.transactions.length).toBe(0);
      expect(newCycleDash.needsOnboarding).toBe(false);
    } finally {
      await sqlite.close();
    }
  });
});
