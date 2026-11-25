import { asc, eq, inArray, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { BackupCountsDto } from "../../../shared/src/dtos";
import { backupSnapshotV2Schema, type BackupSnapshotV2 } from "../../../shared/src/schemas";
import type { AppDb, AppTransaction } from "../db";
import {
  appSettings,
  assets,
  budgets,
  categories,
  debtAccounts,
  goals,
  installments,
  recurringRules,
  settlementAllocations,
  transactionSplits,
  transactions,
  walletRecurringFees,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "./auditService";
import { invalidateAuthCache } from "./auth";
import { ValidationError } from "./errors";
import { getSettings } from "./settingsService";

const SERIAL_TABLES = [
  "wallets",
  "categories",
  "debt_accounts",
  "installments",
  "transactions",
  "settlement_allocations",
  "budgets",
  "goals",
  "assets",
  "wallet_recurring_fees",
  "transaction_splits",
  "recurring_rules",
] as const;

async function insertInChunks<T extends Record<string, unknown>>(
  tx: AppTransaction,
  table: PgTable,
  rows: T[],
  chunkSize = 250,
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await tx.insert(table).values(rows.slice(i, i + chunkSize));
  }
}

function assertUniqueIds(items: Array<{ id: number }>, label: string): Set<number> {
  const ids = new Set<number>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new ValidationError(`ID duplikat (${item.id}) ditemukan pada data ${label}.`);
    }
    ids.add(item.id);
  }
  return ids;
}

function validateBackupReferentialIntegrity(snapshot: BackupSnapshotV2): void {
  const walletIds = assertUniqueIds(snapshot.wallets, "dompet");
  const categoryIds = assertUniqueIds(snapshot.categories, "kategori");
  const accountIds = assertUniqueIds(snapshot.accounts, "hutang/cicilan");
  const installmentIds = assertUniqueIds(snapshot.installments, "jadwal cicilan");
  const txIds = assertUniqueIds(snapshot.transactions, "transaksi");
  assertUniqueIds(snapshot.transactionSplits, "pecahan transaksi");
  assertUniqueIds(snapshot.settlementAllocations, "alokasi pelunasan");
  assertUniqueIds(snapshot.budgets, "anggaran");
  assertUniqueIds(snapshot.goals, "target tabungan");
  assertUniqueIds(snapshot.assets, "aset");
  assertUniqueIds(snapshot.walletRecurringFees, "biaya rutin dompet");
  assertUniqueIds(snapshot.recurringRules, "aturan transaksi berulang");

  const walletKeys = new Set<string>();
  for (const w of snapshot.wallets) {
    if (walletKeys.has(w.key)) {
      throw new ValidationError(`Key dompet duplikat: ${w.key}`);
    }
    walletKeys.add(w.key);
  }

  const categoryPairs = new Set<string>();
  for (const cat of snapshot.categories) {
    const pair = `${cat.type}:${cat.name}`;
    if (categoryPairs.has(pair)) {
      throw new ValidationError(`Kategori duplikat (${cat.type}): ${cat.name}`);
    }
    categoryPairs.add(pair);
  }

  const accountKeys = new Set<string>();
  for (const acc of snapshot.accounts) {
    if (accountKeys.has(acc.key)) {
      throw new ValidationError(`Key akun hutang duplikat: ${acc.key}`);
    }
    accountKeys.add(acc.key);
    if (acc.walletId != null && !walletIds.has(acc.walletId)) {
      throw new ValidationError(`Akun hutang "${acc.name}" merujuk dompet #${acc.walletId} yang tidak ada.`);
    }
    if (acc.disburseWalletId != null && !walletIds.has(acc.disburseWalletId)) {
      throw new ValidationError(
        `Akun hutang "${acc.name}" merujuk dompet pencairan #${acc.disburseWalletId} yang tidak ada.`,
      );
    }
  }

  for (const inst of snapshot.installments) {
    if (!accountIds.has(inst.accountId)) {
      throw new ValidationError(`Cicilan #${inst.id} merujuk akun hutang #${inst.accountId} yang tidak ada.`);
    }
  }

  const sourceRefs = new Set<string>();
  for (const t of snapshot.transactions) {
    if (!walletIds.has(t.walletId)) {
      throw new ValidationError(`Transaksi #${t.id} merujuk dompet #${t.walletId} yang tidak ada.`);
    }
    if (t.toWalletId != null && !walletIds.has(t.toWalletId)) {
      throw new ValidationError(`Transaksi #${t.id} merujuk dompet tujuan #${t.toWalletId} yang tidak ada.`);
    }
    if (t.categoryId != null && !categoryIds.has(t.categoryId)) {
      throw new ValidationError(`Transaksi #${t.id} merujuk kategori #${t.categoryId} yang tidak ada.`);
    }
    if (t.debtAccountId != null && !accountIds.has(t.debtAccountId)) {
      throw new ValidationError(`Transaksi #${t.id} merujuk akun hutang #${t.debtAccountId} yang tidak ada.`);
    }
    if (t.sourceRef != null) {
      if (sourceRefs.has(t.sourceRef)) {
        throw new ValidationError(`sourceRef transaksi duplikat: ${t.sourceRef}`);
      }
      sourceRefs.add(t.sourceRef);
    }
  }

  for (const sp of snapshot.transactionSplits) {
    if (!txIds.has(sp.transactionId)) {
      throw new ValidationError(`Split transaksi #${sp.id} merujuk transaksi #${sp.transactionId} yang tidak ada.`);
    }
    if (sp.categoryId != null && !categoryIds.has(sp.categoryId)) {
      throw new ValidationError(`Split transaksi #${sp.id} merujuk kategori #${sp.categoryId} yang tidak ada.`);
    }
  }

  for (const sa of snapshot.settlementAllocations) {
    if (!txIds.has(sa.settlementTransactionId)) {
      throw new ValidationError(
        `Alokasi pelunasan #${sa.id} merujuk transaksi #${sa.settlementTransactionId} yang tidak ada.`,
      );
    }
    if (sa.installmentId != null && !installmentIds.has(sa.installmentId)) {
      throw new ValidationError(
        `Alokasi pelunasan #${sa.id} merujuk cicilan #${sa.installmentId} yang tidak ada.`,
      );
    }
    if (sa.ccWalletId != null && !walletIds.has(sa.ccWalletId)) {
      throw new ValidationError(
        `Alokasi pelunasan #${sa.id} merujuk dompet CC #${sa.ccWalletId} yang tidak ada.`,
      );
    }
  }

  const budgetKeys = new Set<string>();
  for (const b of snapshot.budgets) {
    const pair = `${b.period}:${b.category}`;
    if (budgetKeys.has(pair)) {
      throw new ValidationError(`Anggaran duplikat untuk ${b.category} (${b.period}).`);
    }
    budgetKeys.add(pair);
    if (b.categoryId != null && !categoryIds.has(b.categoryId)) {
      throw new ValidationError(`Anggaran #${b.id} merujuk kategori #${b.categoryId} yang tidak ada.`);
    }
  }

  for (const g of snapshot.goals) {
    if (g.walletId != null && !walletIds.has(g.walletId)) {
      throw new ValidationError(`Target "${g.name}" merujuk dompet #${g.walletId} yang tidak ada.`);
    }
  }

  for (const fee of snapshot.walletRecurringFees) {
    if (!walletIds.has(fee.walletId)) {
      throw new ValidationError(`Biaya rutin "${fee.name}" merujuk dompet #${fee.walletId} yang tidak ada.`);
    }
  }

  for (const rule of snapshot.recurringRules) {
    if (!walletIds.has(rule.walletId)) {
      throw new ValidationError(`Aturan berulang "${rule.merchant}" merujuk dompet #${rule.walletId} yang tidak ada.`);
    }
    if (rule.categoryId != null && !categoryIds.has(rule.categoryId)) {
      throw new ValidationError(
        `Aturan berulang "${rule.merchant}" merujuk kategori #${rule.categoryId} yang tidak ada.`,
      );
    }
  }

  if (
    snapshot.settings.defaultSalaryWalletId != null &&
    !walletIds.has(snapshot.settings.defaultSalaryWalletId)
  ) {
    throw new ValidationError(
      `Pengaturan gaji merujuk dompet default #${snapshot.settings.defaultSalaryWalletId} yang tidak ada.`,
    );
  }
}

export async function buildFullJsonBackupData(db: AppDb, txIdsFilter?: number[]) {
  const [
    settings,
    categoryRows,
    feeRows,
    installmentRows,
    splitRows,
    allocationRows,
    goalRows,
    assetRows,
    recurringRows,
  ] = await Promise.all([
    getSettings(db),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)),
    db.select().from(walletRecurringFees).orderBy(asc(walletRecurringFees.id)),
    db.select().from(installments).orderBy(asc(installments.dueDate), asc(installments.id)),
    txIdsFilter === undefined
      ? db.select().from(transactionSplits).orderBy(asc(transactionSplits.id))
      : txIdsFilter.length > 0
        ? db
            .select()
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, txIdsFilter))
            .orderBy(asc(transactionSplits.id))
        : Promise.resolve([]),
    txIdsFilter === undefined
      ? db.select().from(settlementAllocations).orderBy(asc(settlementAllocations.id))
      : txIdsFilter.length > 0
        ? db
            .select()
            .from(settlementAllocations)
            .where(inArray(settlementAllocations.settlementTransactionId, txIdsFilter))
            .orderBy(asc(settlementAllocations.id))
        : Promise.resolve([]),
    db.select().from(goals).orderBy(asc(goals.id)),
    db.select().from(assets).orderBy(asc(assets.id)),
    db.select().from(recurringRules).orderBy(asc(recurringRules.id)),
  ]);

  return {
    settings: {
      grossSalary: settings.grossSalary,
      netSalary: settings.netSalary,
      payrollDeduction: settings.payrollDeduction,
      defaultSalaryWalletId: settings.defaultSalaryWalletId,
      gajianStartDay: settings.gajianStartDay,
      cardCutoffDay: settings.cardCutoffDay,
      statementDay: settings.statementDay,
      cardPaymentDay: settings.cardPaymentDay,
      cardLimit: settings.cardLimit,
      legacySettledBeforeCycle: settings.legacySettledBeforeCycle,
      lastAutoSyncDate: settings.lastAutoSyncDate,
    },
    categories: categoryRows,
    walletRecurringFees: feeRows,
    installments: installmentRows,
    transactionSplits: splitRows,
    settlementAllocations: allocationRows,
    goals: goalRows,
    assets: assetRows,
    recurringRules: recurringRows,
  };
}

export async function importBackupSnapshot(
  db: AppDb,
  rawSnapshot: unknown,
): Promise<{ exportedAt: string; counts: BackupCountsDto }> {
  if (rawSnapshot && typeof rawSnapshot === "object") {
    const candidate = rawSnapshot as Record<string, unknown>;
    if (candidate.version !== 2) {
      throw new ValidationError(
        "Format file cadangan tidak didukung atau versi lama (v1). Silakan ekspor ulang file JSON terbaru (Semua Periode) terlebih dahulu.",
      );
    }
    if (candidate.period !== "all") {
      throw new ValidationError(
        'Hanya file cadangan penuh ("Semua Periode / Pencadangan Total") yang dapat diimpor untuk memulihkan database.',
      );
    }
  }

  const parsed = backupSnapshotV2Schema.safeParse(rawSnapshot);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const pathLabel = first?.path?.length ? ` (${first.path.join(".")})` : "";
    throw new ValidationError(`Struktur file cadangan tidak valid${pathLabel}: ${first?.message ?? "format salah"}`);
  }

  const snapshot = parsed.data;
  validateBackupReferentialIntegrity(snapshot);

  const now = new Date();

  await db.transaction(async (tx) => {
    // Release FK from app_settings.default_salary_wallet_id before clearing wallets.
    await tx.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    await tx
      .update(appSettings)
      .set({ defaultSalaryWalletId: null, updatedAt: now })
      .where(eq(appSettings.id, 1));

    // Delete from child tables to parent tables in FK-safe order.
    await tx.delete(settlementAllocations);
    await tx.delete(transactionSplits);
    await tx.delete(transactions);
    await tx.delete(installments);
    await tx.delete(debtAccounts);
    await tx.delete(budgets);
    await tx.delete(goals);
    await tx.delete(assets);
    await tx.delete(recurringRules);
    await tx.delete(walletRecurringFees);
    await tx.delete(wallets);
    await tx.delete(categories);

    // Insert from parent tables to child tables preserving original IDs.
    await insertInChunks(
      tx,
      categories,
      snapshot.categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        bucket: c.bucket,
        isMandatory: c.isMandatory,
        color: c.color,
        sortOrder: c.sortOrder,
        isArchived: c.isArchived,
      })),
    );

    await insertInChunks(
      tx,
      wallets,
      snapshot.wallets.map((w) => ({
        id: w.id,
        key: w.key,
        name: w.name,
        type: w.type,
        accountGroup: w.accountGroup,
        provider: w.provider,
        role: w.role,
        openingBalance: w.openingBalance,
        creditLimit: w.creditLimit ?? null,
        cutoffDay: w.cutoffDay ?? null,
        statementDay: w.statementDay ?? null,
        paymentDay: w.paymentDay ?? null,
        color: w.color,
        accountNumber: w.accountNumber ?? null,
        sortOrder: w.sortOrder,
        isActive: w.isActive,
        createdAt: w.createdAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      walletRecurringFees,
      snapshot.walletRecurringFees.map((f) => ({
        id: f.id,
        walletId: f.walletId,
        name: f.name,
        amount: f.amount,
        isActive: f.isActive,
        createdAt: f.createdAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      debtAccounts,
      snapshot.accounts.map((a) => ({
        id: a.id,
        key: a.key,
        name: a.name,
        lender: a.lender,
        kind: a.kind,
        direction: a.direction,
        walletId: a.walletId ?? null,
        initialBalance: a.initialBalance,
        paymentDay: a.paymentDay ?? null,
        paymentMethod: a.paymentMethod,
        color: a.color,
        disburseWalletId: a.disburseWalletId ?? null,
        disbursedAt: a.disbursedAt ?? null,
        interestRateBps: a.interestRateBps ?? null,
        sourceTransactionId: a.sourceTransactionId ?? null,
        closedAt: a.closedAt ?? null,
        createdAt: a.createdAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      installments,
      snapshot.installments.map((inst) => ({
        id: inst.id,
        accountId: inst.accountId,
        period: inst.period,
        dueDate: inst.dueDate,
        plannedAmount: inst.plannedAmount,
        principalAmount: inst.principalAmount ?? null,
        interestAmount: inst.interestAmount ?? 0,
        actualAmount: inst.actualAmount ?? null,
        status: inst.status,
        paidAt: inst.paidAt ?? null,
        settlementTransactionId: inst.settlementTransactionId ?? null,
      })),
    );

    await insertInChunks(
      tx,
      transactions,
      snapshot.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        merchant: t.merchant,
        amount: t.amount,
        transactionDate: t.transactionDate,
        category: t.category,
        categoryId: t.categoryId ?? null,
        walletId: t.walletId,
        toWalletId: t.toWalletId ?? null,
        transferGroupId: t.transferGroupId ?? null,
        note: t.note ?? null,
        ccCycleKey: t.ccCycleKey ?? null,
        isConvertedToInstallment: t.isConvertedToInstallment,
        convertedAccountId: t.convertedAccountId ?? null,
        installmentId: t.installmentId ?? null,
        debtAccountId: t.debtAccountId ?? null,
        source: t.source,
        sourceRef: t.sourceRef ?? null,
        createdAt: t.createdAt ?? now,
        updatedAt: t.updatedAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      transactionSplits,
      snapshot.transactionSplits.map((sp) => ({
        id: sp.id,
        transactionId: sp.transactionId,
        category: sp.category,
        categoryId: sp.categoryId ?? null,
        amount: sp.amount,
        note: sp.note ?? null,
        createdAt: sp.createdAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      settlementAllocations,
      snapshot.settlementAllocations.map((sa) => ({
        id: sa.id,
        settlementTransactionId: sa.settlementTransactionId,
        targetType: sa.targetType,
        installmentId: sa.installmentId ?? null,
        ccWalletId: sa.ccWalletId ?? null,
        ccCycleKey: sa.ccCycleKey ?? null,
        allocatedAmount: sa.allocatedAmount,
        createdAt: sa.createdAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      budgets,
      snapshot.budgets.map((b) => ({
        id: b.id,
        category: b.category,
        categoryId: b.categoryId ?? null,
        period: b.period,
        limitAmount: b.limitAmount,
        createdAt: b.createdAt ?? now,
        updatedAt: b.updatedAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      goals,
      snapshot.goals.map((g) => ({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        targetDate: g.targetDate ?? null,
        isEmergencyFund: g.isEmergencyFund,
        walletId: g.walletId ?? null,
        notes: g.notes ?? null,
        createdAt: g.createdAt ?? now,
        updatedAt: g.updatedAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      assets,
      snapshot.assets.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        type: a.type,
        valuationAmount: a.valuationAmount,
        acquisitionCost: a.acquisitionCost ?? null,
        notes: a.notes ?? null,
        createdAt: a.createdAt ?? now,
        updatedAt: a.updatedAt ?? now,
      })),
    );

    await insertInChunks(
      tx,
      recurringRules,
      snapshot.recurringRules.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        amount: r.amount,
        category: r.category,
        categoryId: r.categoryId ?? null,
        walletId: r.walletId,
        dueDay: r.dueDay,
        isActive: r.isActive,
        lastPaidPeriod: r.lastPaidPeriod ?? null,
        createdAt: r.createdAt ?? now,
      })),
    );

    // Restore financial settings while preserving local PIN & sessionVersion.
    await tx
      .update(appSettings)
      .set({
        grossSalary: snapshot.settings.grossSalary,
        netSalary: snapshot.settings.netSalary,
        payrollDeduction: snapshot.settings.payrollDeduction,
        defaultSalaryWalletId: snapshot.settings.defaultSalaryWalletId ?? null,
        gajianStartDay: snapshot.settings.gajianStartDay,
        cardCutoffDay: snapshot.settings.cardCutoffDay,
        statementDay: snapshot.settings.statementDay,
        cardPaymentDay: snapshot.settings.cardPaymentDay,
        cardLimit: snapshot.settings.cardLimit,
        legacySettledBeforeCycle: snapshot.settings.legacySettledBeforeCycle ?? null,
        lastAutoSyncDate: snapshot.settings.lastAutoSyncDate ?? null,
        updatedAt: now,
      })
      .where(eq(appSettings.id, 1));

    // Synchronize PostgreSQL serial sequences so subsequent inserts get MAX(id) + 1.
    for (const tableName of SERIAL_TABLES) {
      await tx.execute(
        sql.raw(
          `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1), (SELECT COUNT(*) > 0 FROM "${tableName}"))`,
        ),
      );
    }
  });

  invalidateAuthCache(db);

  const counts: BackupCountsDto = {
    wallets: snapshot.wallets.length,
    categories: snapshot.categories.length,
    accounts: snapshot.accounts.length,
    installments: snapshot.installments.length,
    transactions: snapshot.transactions.length,
    transactionSplits: snapshot.transactionSplits.length,
    settlementAllocations: snapshot.settlementAllocations.length,
    budgets: snapshot.budgets.length,
    goals: snapshot.goals.length,
    assets: snapshot.assets.length,
    walletRecurringFees: snapshot.walletRecurringFees.length,
    recurringRules: snapshot.recurringRules.length,
  };

  await recordAuditLog(db, {
    entityType: "settings",
    entityId: 1,
    action: "import_backup",
    after: {
      exportedAt: snapshot.exportedAt,
      importedAt: now.toISOString(),
      counts,
    },
  });

  return { exportedAt: snapshot.exportedAt, counts };
}
