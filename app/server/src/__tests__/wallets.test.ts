import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { transactions, wallets } from "../db/schema";
import { ensureDefaultSeed } from "../db/seed";
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
});
