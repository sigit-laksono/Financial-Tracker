import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { receiveSalaryForPeriod } from "../lib/salaryService";
import { setupTestContext } from "./testHelper";

describe("Milestone 13: Salary Service Atomic Transactions & Settlement Allocations", () => {
  it("records salary and creates settlementAllocations atomically for payroll installments", async () => {
    const { db } = await setupTestContext();

    const [spendingWallet] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(spendingWallet).toBeDefined();

    // Create a payroll debt account with installments due in 2026-10 (period 2026-10: 2026-09-25 to 2026-10-24)
    const [debtAcc] = await db
      .insert(debtAccounts)
      .values({
        key: "pinjaman-kantor",
        name: "Pinjaman Kantor",
        lender: "Kantor",
        kind: "payroll",
        direction: "payable",
        initialBalance: 3_000_000,
        paymentMethod: "Potong Gaji",
        color: "#00797a",
      })
      .returning();
    expect(debtAcc).toBeDefined();

    const [inst] = await db
      .insert(installments)
      .values({
        accountId: debtAcc!.id,
        period: "2026-10",
        dueDate: "2026-10-25",
        plannedAmount: 1_000_000,
        status: "upcoming",
      })
      .returning();
    expect(inst).toBeDefined();

    const res = await receiveSalaryForPeriod(
      db,
      {
        period: "2026-10",
        grossSalary: 10_000_000,
        walletId: spendingWallet!.id,
        transactionDate: "2026-10-25",
      },
      "2026-10-25",
    );

    expect(res.ok).toBe(true);
    expect(res.netSalary).toBe(9_000_000);
    expect(res.totalPayrollDue).toBe(1_000_000);

    // Verify installment marked paid
    const [updatedInst] = await db.select().from(installments).where(eq(installments.id, inst!.id));
    expect(updatedInst).toBeDefined();
    expect(updatedInst!.status).toBe("paid");
    expect(updatedInst!.settlementTransactionId).toBe(res.transaction.id);

    // Verify settlementAllocations created
    const allocs = await db
      .select()
      .from(settlementAllocations)
      .where(eq(settlementAllocations.settlementTransactionId, res.transaction.id));
    expect(allocs.length).toBe(1);
    expect(allocs[0]!.targetType).toBe("installment");
    expect(allocs[0]!.installmentId).toBe(inst!.id);
    expect(allocs[0]!.allocatedAmount).toBe(1_000_000);
  });

  it("rolls back the entire transaction if an error occurs during installment settlement", async () => {
    const { db } = await setupTestContext();

    const [spendingWallet] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(spendingWallet).toBeDefined();

    const [debtAcc] = await db
      .insert(debtAccounts)
      .values({
        key: "kasbon-payroll",
        name: "Kasbon Payroll",
        lender: "Kantor",
        kind: "payroll",
        direction: "payable",
        initialBalance: 2_000_000,
        paymentMethod: "Potong Gaji",
        color: "#00797a",
      })
      .returning();
    expect(debtAcc).toBeDefined();

    const [inst] = await db
      .insert(installments)
      .values({
        accountId: debtAcc!.id,
        period: "2026-11",
        dueDate: "2026-11-25",
        plannedAmount: 1_000_000,
        status: "upcoming",
      })
      .returning();
    expect(inst).toBeDefined();

    const txCountBefore = (await db.select().from(transactions)).length;

    // Simulate failure inside transaction by mocking or triggering error
    // For instance, pass an invalid or failing mock, or spy on db.transaction
    const originalTransaction = db.transaction.bind(db);
    db.transaction = (async (_cb) => {
      return await originalTransaction(async (tx) => {
        // Execute original logic up to insert, then simulate a crash/exception
        await tx
          .insert(transactions)
          .values({
            type: "income",
            merchant: "Gaji Kantor",
            amount: 9_000_000,
            transactionDate: "2026-11-25",
            category: "Gaji",
            walletId: spendingWallet!.id,
            source: "system",
            sourceRef: "salary-2026-11",
            note: "test",
          })
          .returning();

        // Simulate crash during installment processing
        throw new Error("Simulated database write error during payroll loop");
      });
    }) as typeof db.transaction;

    await expect(async () => {
      await receiveSalaryForPeriod(
        db,
        {
          period: "2026-11",
          grossSalary: 10_000_000,
          walletId: spendingWallet!.id,
          transactionDate: "2026-11-25",
        },
        "2026-11-25",
      );
    }).toThrow("Simulated database write error");

    // Restore transaction
    db.transaction = originalTransaction;

    // Verify rollback: transactions count unchanged
    const txCountAfter = (await db.select().from(transactions)).length;
    expect(txCountAfter).toBe(txCountBefore);

    // Verify installment is still upcoming, not paid
    const [instAfter] = await db.select().from(installments).where(eq(installments.id, inst!.id));
    expect(instAfter).toBeDefined();
    expect(instAfter!.status).toBe("upcoming");
    expect(instAfter!.settlementTransactionId).toBeNull();

    // Verify zero settlementAllocations
    const allocs = await db.select().from(settlementAllocations);
    expect(allocs.length).toBe(0);
  });
});
