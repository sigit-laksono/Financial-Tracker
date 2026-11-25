import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { appSettings, debtAccounts, installments, transactions, wallets } from "../db/schema";
import { ensureDefaultSeed } from "../db/seed";
import { computeLedgerSnapshot } from "../lib/ledgerSnapshot";
import { setupTestContext } from "./testHelper";

describe("Wallets Management & Deletion", () => {
  it("deletes a wallet with 0 transactions cleanly and respects seed idempotency", async () => {
    const { db, app } = await setupTestContext();

    // 1. Get initial wallets (should have default seeded wallets like btpn)
    const [btpn] = await db.select().from(wallets).where(eq(wallets.key, "btpn"));
    expect(btpn).toBeDefined();

    // 2. Delete BTPN (0 transactions)
    const delRes = await app.request(`/api/wallets/${btpn!.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.ok).toBe(true);

    // 3. Confirm BTPN is deleted from database
    const [checkDeleted] = await db.select().from(wallets).where(eq(wallets.key, "btpn"));
    expect(checkDeleted).toBeUndefined();

    // 4. Ensure that calling ensureDefaultSeed again does NOT revive BTPN
    await ensureDefaultSeed(db);
    const [checkStillDeleted] = await db.select().from(wallets).where(eq(wallets.key, "btpn"));
    expect(checkStillDeleted).toBeUndefined();
  });

  it("blocks deletion of a wallet with transactions unless cascade=true is specified", async () => {
    const { db, app } = await setupTestContext();

    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    expect(bca).toBeDefined();

    // Insert a transaction using BCA
    await db.insert(transactions).values({
      type: "expense",
      merchant: "Supermarket",
      amount: 150_000,
      transactionDate: "2026-11-23",
      category: "Makanan & Minuman",
      walletId: bca!.id,
    });

    // Attempt delete without cascade -> should be blocked
    const delResBlocked = await app.request(`/api/wallets/${bca!.id}`, { method: "DELETE" });
    expect(delResBlocked.status).toBe(400);
    const blockedBody = await delResBlocked.json();
    expect(blockedBody.requiresCascade).toBe(true);
    expect(blockedBody.transactionCount).toBe(1);

    // Delete with cascade=true -> should succeed
    const delResCascade = await app.request(`/api/wallets/${bca!.id}?cascade=true`, {
      method: "DELETE",
    });
    expect(delResCascade.status).toBe(200);
    const cascadeBody = await delResCascade.json();
    expect(cascadeBody.ok).toBe(true);

    // Verify wallet and its transaction are gone
    const [bcaAfter] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    expect(bcaAfter).toBeUndefined();

    const txsAfter = await db.select().from(transactions).where(eq(transactions.walletId, bca!.id));
    expect(txsAfter).toHaveLength(0);
  });

  it("creates initial CC usage atomically, preserves secondary CC appSettings, recomputes unsettled cutoff cycles, and cascades safely with debts and transfers", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [gopay] = await db.select().from(wallets).where(eq(wallets.key, "gopay"));

    // 1. Create secondary CC with initialUsage
    const createRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CC Mandiri",
        type: "credit_card",
        creditLimit: 10_000_000,
        cutoffDay: 15,
        statementDay: 16,
        paymentDay: 5,
        initialUsage: 1_500_000,
      }),
    });
    expect(createRes.status).toBe(201);
    const { wallet: ccMandiri } = (await createRes.json()) as { wallet: { id: number } };

    const snap = await computeLedgerSnapshot(db);
    const mandiriSnap = snap.wallets.find((w) => w.id === ccMandiri.id)!;
    expect(mandiriSnap.limitUsed).toBe(1_500_000);
    expect(mandiriSnap.balance).toBe(8_500_000);

    // 2. Editing secondary CC does NOT overwrite global appSettings, and cutoffDay change recomputes unsettled ccCycleKey
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Makan Tengah Bulan",
        amount: 200_000,
        transactionDate: "2026-10-12",
        category: "Makanan & Belanja Dapur",
        walletId: ccMandiri.id,
      }),
    });
    const [settingsBefore] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    const patchCcRes = await app.request(`/api/wallets/${ccMandiri.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cutoffDay: 10, creditLimit: 12_000_000 }),
    });
    expect(patchCcRes.status).toBe(200);
    const [settingsAfter] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    expect(settingsAfter!.cardCutoffDay).toBe(settingsBefore!.cardCutoffDay);
    expect(settingsAfter!.cardLimit).toBe(settingsBefore!.cardLimit);

    const [recomputedTx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.merchant, "Makan Tengah Bulan"));
    expect(recomputedTx!.ccCycleKey).toBe("2026-11");

    // 3. Cascade delete wallet with linked debt, settlement tx, and transfer + adminFee
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "income",
        merchant: "Dana Awal",
        amount: 5_000_000,
        transactionDate: "2026-10-01",
        category: "Gaji",
        walletId: bni!.id,
      }),
    });
    await app.request("/api/transactions/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWalletId: bni!.id,
        toWalletId: gopay!.id,
        amount: 400_000,
        adminFee: 2_500,
        transactionDate: "2026-10-02",
      }),
    });
    const debtRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pinjaman BNI",
        lender: "Teman",
        kind: "loan",
        direction: "payable",
        initialBalance: 1_000_000,
        installmentCount: 2,
        installmentAmount: 500_000,
        firstDueDate: "2026-10-10",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId } = (await debtRes.json()) as { accountId: number };
    const [firstInst] = await db
      .select()
      .from(installments)
      .where(eq(installments.accountId, accountId));
    await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [firstInst!.id],
        fromWalletId: gopay!.id,
        paymentDate: "2026-10-10",
      }),
    });

    // Deleting GoPay with cascade=true must revert the settlement on Pinjaman BNI and delete paired BNI transfer fee
    const delGopayRes = await app.request(`/api/wallets/${gopay!.id}?cascade=true`, {
      method: "DELETE",
    });
    expect(delGopayRes.status).toBe(200);

    const [instAfter] = await db
      .select()
      .from(installments)
      .where(eq(installments.id, firstInst!.id));
    expect(instAfter!.status).toBe("upcoming");
    expect(instAfter!.settlementTransactionId).toBeNull();

    const [debtAfter] = await db.select().from(debtAccounts).where(eq(debtAccounts.id, accountId));
    expect(debtAfter!.closedAt).toBeNull();

    const bniFeeRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.category, "Biaya Bank"));
    expect(bniFeeRows).toHaveLength(0);
  });
});
