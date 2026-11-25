import { z } from "zod";
import { isValidIsoDate, isValidYearMonth } from "./dates";
import {
  ACCOUNT_GROUPS,
  ASSET_CATEGORIES,
  ASSET_TYPES,
  CATEGORY_TYPES,
  CYCLE_MODES,
  DEBT_DIRECTIONS,
  DEBT_KINDS,
  INSTALLMENT_STATUSES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  WALLET_PROVIDERS,
  WALLET_ROLES,
  WALLET_TYPES,
} from "./types";

export const MAX_PG_INT = 2_147_483_647;
const MAX_PG_INT_MSG = "Nominal maksimal Rp 2.147.483.647.";
const MIN_PG_INT_MSG = "Nominal minimal -Rp 2.147.483.647.";

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, "Tanggal tidak valid (gunakan YYYY-MM-DD yang valid).");

export const yearMonthSchema = z
  .string()
  .refine(isValidYearMonth, "Format periode harus YYYY-MM dengan bulan 01-12.");

export const pinSchema = z.object({
  pin: z.string().trim().min(4, "PIN minimal 4 karakter.").max(64),
});

export const changePinSchema = z.object({
  currentPin: z.string().optional(),
  newPin: z.string().trim().max(64).nullable(),
});

export const splitItemSchema = z.object({
  category: z.string().trim().min(1).max(60),
  amount: z.number().int().positive("Nominal pecahan harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  note: z.string().trim().max(300).nullable().optional(),
});

export const createTxSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    merchant: z.string().trim().min(1, "Nama merchant atau keterangan wajib diisi.").max(120),
    amount: z.number().int().positive("Nominal harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
    transactionDate: isoDateSchema,
    category: z.string().trim().min(1).max(60),
    walletId: z.number().int().positive().max(MAX_PG_INT),
    note: z.string().trim().max(500).optional(),
    source: z.enum(["manual", "whatsapp", "import"]).default("manual"),
    sourceRef: z.string().trim().max(200).optional(),
    splits: z.array(splitItemSchema).optional(),
  })
  .refine(
    (data) => {
      if (!data.splits || data.splits.length === 0) return true;
      const sumSplits = data.splits.reduce((sum, s) => sum + s.amount, 0);
      return sumSplits === data.amount;
    },
    {
      message: "Total pecahan kategori harus sama persis dengan nominal transaksi.",
      path: ["splits"],
    },
  );

export const updateTxSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer"]).optional(),
    merchant: z.string().trim().min(1).max(120).optional(),
    amount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
    transactionDate: isoDateSchema.optional(),
    category: z.string().trim().min(1).max(60).optional(),
    walletId: z.number().int().positive().max(MAX_PG_INT).optional(),
    toWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    adminFee: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    splits: z.array(splitItemSchema).optional(),
  })
  .refine(
    (data) => {
      if (!data.splits || data.splits.length === 0) return true;
      if (data.amount !== undefined) {
        const sumSplits = data.splits.reduce((sum, s) => sum + s.amount, 0);
        return sumSplits === data.amount;
      }
      return true;
    },
    {
      message: "Total pecahan kategori harus sama persis dengan nominal transaksi.",
      path: ["splits"],
    },
  );

export const transferSchema = z.object({
  fromWalletId: z.number().int().positive().max(MAX_PG_INT),
  toWalletId: z.number().int().positive().max(MAX_PG_INT),
  amount: z.number().int().positive("Nominal transfer harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  adminFee: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  transactionDate: isoDateSchema,
  merchant: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const convertSplitPaySchema = z.object({
  name: z.string().trim().max(120).optional(),
  installmentCount: z.number().int().min(2).max(60),
  installmentAmount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG),
  firstPeriod: yearMonthSchema,
  paymentDay: z.number().int().min(1).max(28).optional(),
});

export const customInstallmentScheduleItemSchema = z.object({
  monthIndex: z.number().int().min(1),
  period: z.string().trim().min(1).max(20),
  dueDate: isoDateSchema,
  plannedAmount: z.number().int().positive("Nominal cicilan harus lebih dari Rp 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  principalAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  interestAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
});

export const updateInstallmentSchema = z.object({
  plannedAmount: z.number().int().positive("Nominal cicilan harus lebih dari Rp 0.").max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  dueDate: isoDateSchema.optional(),
});

export const createDebtSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lender: z.string().trim().min(1).max(120),
  kind: z.enum(DEBT_KINDS),
  direction: z.enum(DEBT_DIRECTIONS).default("payable"),
  initialBalance: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG),
  installmentCount: z.number().int().min(1).max(120),
  installmentAmount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG),
  principalAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  interestAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  firstDueDate: isoDateSchema,
  paymentMethod: z.string().trim().min(1).max(60),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  disburseWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  recordDisbursement: z.boolean().default(false),
  interestRateBps: z.number().int().min(0).max(10000).optional(),
  customSchedule: z.array(customInstallmentScheduleItemSchema).optional(),
});

export const closeDebtSchema = z.object({
  closed: z.boolean(),
});

export const updateDebtInstallmentItemSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  dueDate: isoDateSchema,
  plannedAmount: z.number().int().positive("Nominal cicilan harus lebih dari Rp 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
});

export const updateDebtSchema = z.object({
  name: z.string().trim().min(1, "Nama utang/piutang wajib diisi.").max(120).optional(),
  lender: z.string().trim().min(1, "Pemberi pinjaman/peminjam wajib diisi.").max(120).optional(),
  kind: z.enum(DEBT_KINDS).optional(),
  paymentMethod: z.string().trim().min(1).max(60).optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  installments: z.array(updateDebtInstallmentItemSchema).optional(),
});

export const earlyPayoffSchema = z.object({
  fromWalletId: z.number().int().positive("Pilih dompet untuk transaksi pelunasan."),
  paymentDate: isoDateSchema,
  customAmount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const settleSchema = z.object({
  installmentIds: z.array(z.number().int().positive().max(MAX_PG_INT)).optional(),
  ccWalletId: z.number().int().positive().max(MAX_PG_INT).optional(),
  ccCycleKey: yearMonthSchema.optional(),
  fromWalletId: z.number().int().positive().max(MAX_PG_INT),
  paymentDate: isoDateSchema,
  customAmount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  recordSettlementTx: z.boolean().default(true),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const unsettleSchema = z.object({
  removeSettlementTx: z.boolean().default(false),
});

export const createWalletRecurringFeeSchema = z.object({
  name: z.string().trim().min(1, "Nama biaya wajib diisi.").max(60),
  amount: z.number().int().positive("Nominal biaya harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  isActive: z.boolean().default(true),
});

export const updateWalletRecurringFeeSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  amount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  isActive: z.boolean().optional(),
});

export const createRecurringRuleSchema = z.object({
  merchant: z.string().trim().min(1, "Nama tagihan atau merchant wajib diisi.").max(120),
  amount: z.number().int().positive("Nominal tagihan harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  category: z.string().trim().min(1).max(60),
  walletId: z.number().int().positive("Pilih dompet pembayaran."),
  dueDay: z.number().int().min(1).max(31, "Tanggal jatuh tempo harus antara 1-31."),
  isActive: z.boolean().default(true),
});

export const updateRecurringRuleSchema = z.object({
  merchant: z.string().trim().min(1).max(120).optional(),
  amount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  isActive: z.boolean().optional(),
});

export const payRecurringRuleSchema = z.object({
  period: yearMonthSchema.optional(),
  transactionDate: isoDateSchema.optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT).optional(),
  amount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  note: z.string().trim().max(300).optional(),
});

export const createWalletSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(WALLET_TYPES),
  accountGroup: z.enum(ACCOUNT_GROUPS).optional(),
  provider: z.enum(WALLET_PROVIDERS).optional(),
  role: z.enum(WALLET_ROLES).optional(),
  openingBalance: z.number().int().min(-MAX_PG_INT, MIN_PG_INT_MSG).max(MAX_PG_INT, MAX_PG_INT_MSG).default(0),
  initialUsage: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  creditLimit: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).nullable().optional(),
  cutoffDay: z.number().int().min(1).max(28).nullable().optional(),
  statementDay: z.number().int().min(1).max(28).nullable().optional(),
  paymentDay: z.number().int().min(1).max(28).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#00797a"),
  accountNumber: z.string().trim().max(40).nullable().optional(),
});

export const updateWalletSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  accountGroup: z.enum(ACCOUNT_GROUPS).optional(),
  provider: z.enum(WALLET_PROVIDERS).optional(),
  role: z.enum(WALLET_ROLES).optional(),
  openingBalance: z.number().int().min(-MAX_PG_INT, MIN_PG_INT_MSG).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  creditLimit: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).nullable().optional(),
  cutoffDay: z.number().int().min(1).max(28).nullable().optional(),
  statementDay: z.number().int().min(1).max(28).nullable().optional(),
  paymentDay: z.number().int().min(1).max(28).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accountNumber: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).optional(),
});

export const reconcileSchema = z.object({
  actualBalance: z.number().int().min(-MAX_PG_INT, MIN_PG_INT_MSG).max(MAX_PG_INT, MAX_PG_INT_MSG),
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi.").max(60),
  type: z.enum(CATEGORY_TYPES).default("expense"),
  bucket: z.enum(["needs", "wants", "savings"]).default("needs"),
  isMandatory: z.boolean().default(false),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#00797a"),
  budgetLimit: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  period: z.union([z.literal("default"), yearMonthSchema]).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  bucket: z.enum(["needs", "wants", "savings"]).optional(),
  isMandatory: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).optional(),
  budgetLimit: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  period: z.union([z.literal("default"), yearMonthSchema]).optional(),
});

export const upsertBudgetSchema = z.object({
  category: z.string().trim().min(1).max(60),
  period: z.union([z.literal("default"), yearMonthSchema]).default("default"),
  limitAmount: z.number().int().min(0, "Batas anggaran tidak boleh negatif.").max(MAX_PG_INT, MAX_PG_INT_MSG),
});

export const copyPreviousBudgetsSchema = z.object({
  targetPeriod: yearMonthSchema,
});

export const updateSettingsSchema = z.object({
  grossSalary: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  netSalary: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  payrollDeduction: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  defaultSalaryWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  gajianStartDay: z.number().int().min(1).max(28).optional(),
  cardCutoffDay: z.number().int().min(1).max(28).optional(),
  statementDay: z.number().int().min(1).max(28).optional(),
  cardPaymentDay: z.number().int().min(1).max(28).optional(),
  cardLimit: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
});

export const receiveSalarySchema = z.object({
  period: yearMonthSchema.optional(),
  grossSalary: z.number().int().positive("Gaji kotor harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT).optional(),
  transactionDate: isoDateSchema.optional(),
});

export const salaryPreviewQuerySchema = z.object({
  period: yearMonthSchema.optional(),
  grossSalary: z.coerce.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  walletId: z.coerce.number().int().positive().max(MAX_PG_INT).optional(),
});

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Nama target tabungan wajib diisi.").max(60),
  emoji: z.string().trim().min(1).max(10).default("🎯"),
  targetAmount: z.number().int().positive("Target nominal harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  currentAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).default(0),
  targetDate: isoDateSchema.nullable().optional(),
  isEmergencyFund: z.boolean().default(false),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  emoji: z.string().trim().min(1).max(10).optional(),
  targetAmount: z.number().int().positive().max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  currentAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  targetDate: isoDateSchema.nullable().optional(),
  isEmergencyFund: z.boolean().optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const contributeGoalSchema = z.object({
  amount: z.number().int().positive("Nominal setoran harus lebih dari 0.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  walletId: z.number().int().positive("Pilih dompet sumber dana."),
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, "Nama aset wajib diisi.").max(80),
  category: z.enum(ASSET_CATEGORIES),
  type: z.enum(ASSET_TYPES),
  valuationAmount: z.number().int().min(0, "Nilai valuasi tidak boleh negatif.").max(MAX_PG_INT, MAX_PG_INT_MSG),
  acquisitionCost: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  type: z.enum(ASSET_TYPES).optional(),
  valuationAmount: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).optional(),
  acquisitionCost: z.number().int().min(0).max(MAX_PG_INT, MAX_PG_INT_MSG).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const dashboardQuerySchema = z.object({
  cycle: z.enum(CYCLE_MODES).optional(),
  period: yearMonthSchema.optional(),
});

const backupTimestampSchema = z
  .union([z.string().min(1), z.number().finite(), z.date()])
  .transform((val, ctx) => {
    const d = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Format timestamp cadangan tidak valid." });
      return z.NEVER;
    }
    return d;
  });

const nullableBackupTimestampSchema = backupTimestampSchema.nullable().optional();

export const backupWalletRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(WALLET_TYPES),
  accountGroup: z.enum(ACCOUNT_GROUPS).default("bank"),
  provider: z.enum(WALLET_PROVIDERS).default("other"),
  role: z.enum(WALLET_ROLES).default("spending"),
  openingBalance: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).default(0),
  creditLimit: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).nullable().optional(),
  cutoffDay: z.number().int().min(1).max(28).nullable().optional(),
  statementDay: z.number().int().min(1).max(28).nullable().optional(),
  paymentDay: z.number().int().min(1).max(28).nullable().optional(),
  color: z.string().min(1),
  accountNumber: z.string().nullable().optional(),
  sortOrder: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).default(0),
  isActive: z.boolean().default(true),
  createdAt: backupTimestampSchema.optional(),
});

export const backupCategoryRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  name: z.string().min(1),
  type: z.enum(CATEGORY_TYPES),
  bucket: z.enum(["needs", "wants", "savings"]).default("needs"),
  isMandatory: z.boolean().default(false),
  color: z.string().min(1).default("#00797a"),
  sortOrder: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).default(0),
  isArchived: z.boolean().default(false),
});

export const backupDebtAccountRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  key: z.string().min(1),
  name: z.string().min(1),
  lender: z.string().min(1),
  kind: z.enum(DEBT_KINDS),
  direction: z.enum(DEBT_DIRECTIONS).default("payable"),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  initialBalance: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT),
  paymentDay: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).nullable().optional(),
  paymentMethod: z.string().min(1),
  color: z.string().min(1),
  disburseWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  disbursedAt: nullableBackupTimestampSchema,
  interestRateBps: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT).nullable().optional(),
  sourceTransactionId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  closedAt: nullableBackupTimestampSchema,
  createdAt: backupTimestampSchema.optional(),
});

export const backupInstallmentRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  accountId: z.number().int().positive().max(MAX_PG_INT),
  period: z.string().min(1).max(20),
  dueDate: isoDateSchema,
  plannedAmount: z.number().int().positive().max(MAX_PG_INT),
  principalAmount: z.number().int().min(0).max(MAX_PG_INT).nullable().optional(),
  interestAmount: z.number().int().min(0).max(MAX_PG_INT).nullable().optional(),
  actualAmount: z.number().int().min(0).max(MAX_PG_INT).nullable().optional(),
  status: z.enum(INSTALLMENT_STATUSES).default("upcoming"),
  paidAt: nullableBackupTimestampSchema,
  settlementTransactionId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
});

export const backupTransactionRowSchema = z
  .object({
    id: z.number().int().positive().max(MAX_PG_INT),
    type: z.enum(TRANSACTION_TYPES),
    merchant: z.string().min(1),
    amount: z.number().int().min(-MAX_PG_INT).max(MAX_PG_INT),
    transactionDate: isoDateSchema,
    category: z.string().min(1),
    categoryId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    walletId: z.number().int().positive().max(MAX_PG_INT),
    toWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    transferGroupId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    ccCycleKey: z.string().nullable().optional(),
    isConvertedToInstallment: z.boolean().default(false),
    convertedAccountId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    installmentId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    debtAccountId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
    source: z.enum(TRANSACTION_SOURCES).default("manual"),
    sourceRef: z.string().nullable().optional(),
    createdAt: backupTimestampSchema.optional(),
    updatedAt: backupTimestampSchema.optional(),
  })
  .refine((t) => t.type === "adjustment" || t.amount > 0, {
    message: "Nominal transaksi non-adjustment harus lebih dari 0.",
  })
  .refine((t) => t.toWalletId == null || t.toWalletId !== t.walletId, {
    message: "Dompet asal dan tujuan transfer pada transaksi tidak boleh sama.",
  });

export const backupTransactionSplitRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  transactionId: z.number().int().positive().max(MAX_PG_INT),
  category: z.string().min(1),
  categoryId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  amount: z.number().int().positive().max(MAX_PG_INT),
  note: z.string().nullable().optional(),
  createdAt: backupTimestampSchema.optional(),
});

export const backupSettlementAllocationRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  settlementTransactionId: z.number().int().positive().max(MAX_PG_INT),
  targetType: z.enum(["installment", "cc_cycle"]),
  installmentId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  ccWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  ccCycleKey: z.string().nullable().optional(),
  allocatedAmount: z.number().int().positive().max(MAX_PG_INT),
  createdAt: backupTimestampSchema.optional(),
});

export const backupBudgetRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  category: z.string().min(1),
  categoryId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  period: z.union([z.literal("default"), yearMonthSchema]),
  limitAmount: z.number().int().positive().max(MAX_PG_INT),
  createdAt: backupTimestampSchema.optional(),
  updatedAt: backupTimestampSchema.optional(),
});

export const backupGoalRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  name: z.string().min(1),
  emoji: z.string().min(1).default("🎯"),
  targetAmount: z.number().int().positive().max(MAX_PG_INT),
  currentAmount: z.number().int().min(0).default(0),
  targetDate: z.string().max(10).nullable().optional(),
  isEmergencyFund: z.boolean().default(false),
  walletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: backupTimestampSchema.optional(),
  updatedAt: backupTimestampSchema.optional(),
});

export const backupAssetRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  name: z.string().min(1),
  category: z.enum(ASSET_CATEGORIES),
  type: z.string().min(1),
  valuationAmount: z.number().int().min(0),
  acquisitionCost: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: backupTimestampSchema.optional(),
  updatedAt: backupTimestampSchema.optional(),
});

export const backupWalletRecurringFeeRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  walletId: z.number().int().positive().max(MAX_PG_INT),
  name: z.string().min(1),
  amount: z.number().int().positive().max(MAX_PG_INT),
  isActive: z.boolean().default(true),
  createdAt: backupTimestampSchema.optional(),
});

export const backupRecurringRuleRowSchema = z.object({
  id: z.number().int().positive().max(MAX_PG_INT),
  merchant: z.string().min(1),
  amount: z.number().int().positive().max(MAX_PG_INT),
  category: z.string().min(1),
  categoryId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  walletId: z.number().int().positive().max(MAX_PG_INT),
  dueDay: z.number().int().min(1).max(31),
  isActive: z.boolean().default(true),
  lastPaidPeriod: z.string().max(20).nullable().optional(),
  createdAt: backupTimestampSchema.optional(),
});

export const backupSettingsSnapshotSchema = z.object({
  grossSalary: z.number().int().min(0).default(0),
  netSalary: z.number().int().min(0).default(0),
  payrollDeduction: z.number().int().min(0).default(0),
  defaultSalaryWalletId: z.number().int().positive().max(MAX_PG_INT).nullable().optional(),
  gajianStartDay: z.number().int().min(1).max(28).default(25),
  cardCutoffDay: z.number().int().min(1).max(28).default(20),
  statementDay: z.number().int().min(1).max(28).default(21),
  cardPaymentDay: z.number().int().min(1).max(28).default(25),
  cardLimit: z.number().int().min(0).default(0),
  legacySettledBeforeCycle: z.string().max(20).nullable().optional(),
  lastAutoSyncDate: z.string().max(10).nullable().optional(),
});

export const backupSnapshotV2Schema = z.object({
  version: z.literal(2),
  exportedAt: z.string().min(1),
  period: z.literal("all"),
  scope: z.literal("full").optional(),
  settings: backupSettingsSnapshotSchema,
  categories: z.array(backupCategoryRowSchema),
  wallets: z.array(backupWalletRowSchema),
  walletRecurringFees: z.array(backupWalletRecurringFeeRowSchema),
  accounts: z.array(backupDebtAccountRowSchema),
  installments: z.array(backupInstallmentRowSchema),
  budgets: z.array(backupBudgetRowSchema),
  transactions: z.array(backupTransactionRowSchema),
  transactionSplits: z.array(backupTransactionSplitRowSchema),
  settlementAllocations: z.array(backupSettlementAllocationRowSchema),
  goals: z.array(backupGoalRowSchema),
  assets: z.array(backupAssetRowSchema),
  recurringRules: z.array(backupRecurringRuleRowSchema),
});

export type BackupSnapshotV2 = z.infer<typeof backupSnapshotV2Schema>;

export const backupImportRequestSchema = z.object({
  confirmation: z.literal("IMPORT_CONFIRMED"),
  snapshot: backupSnapshotV2Schema,
});
