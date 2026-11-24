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
  WALLET_PROVIDERS,
  WALLET_ROLES,
  WALLET_TYPES,
} from "./types";

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
  amount: z.number().int().positive("Nominal pecahan harus lebih dari 0."),
  note: z.string().trim().max(300).nullable().optional(),
});

export const createTxSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    merchant: z.string().trim().min(1, "Nama merchant atau keterangan wajib diisi.").max(120),
    amount: z.number().int().positive("Nominal harus lebih dari 0."),
    transactionDate: isoDateSchema,
    category: z.string().trim().min(1).max(60),
    walletId: z.number().int().positive(),
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
    amount: z.number().int().positive().optional(),
    transactionDate: isoDateSchema.optional(),
    category: z.string().trim().min(1).max(60).optional(),
    walletId: z.number().int().positive().optional(),
    toWalletId: z.number().int().positive().nullable().optional(),
    adminFee: z.number().int().min(0).optional(),
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
  fromWalletId: z.number().int().positive(),
  toWalletId: z.number().int().positive(),
  amount: z.number().int().positive("Nominal transfer harus lebih dari 0."),
  adminFee: z.number().int().min(0).optional(),
  transactionDate: isoDateSchema,
  merchant: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const convertSplitPaySchema = z.object({
  name: z.string().trim().max(120).optional(),
  installmentCount: z.number().int().min(2).max(60),
  installmentAmount: z.number().int().positive(),
  firstPeriod: yearMonthSchema,
  paymentDay: z.number().int().min(1).max(28).optional(),
});

export const customInstallmentScheduleItemSchema = z.object({
  monthIndex: z.number().int().min(1),
  period: z.string().trim().min(1).max(20),
  dueDate: isoDateSchema,
  plannedAmount: z.number().int().positive("Nominal cicilan harus lebih dari Rp 0."),
  principalAmount: z.number().int().min(0).optional(),
  interestAmount: z.number().int().min(0).optional(),
});

export const updateInstallmentSchema = z.object({
  plannedAmount: z.number().int().positive("Nominal cicilan harus lebih dari Rp 0.").optional(),
  dueDate: isoDateSchema.optional(),
});

export const createDebtSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lender: z.string().trim().min(1).max(120),
  kind: z.enum(DEBT_KINDS),
  direction: z.enum(DEBT_DIRECTIONS).default("payable"),
  initialBalance: z.number().int().positive(),
  installmentCount: z.number().int().min(1).max(120),
  installmentAmount: z.number().int().positive(),
  principalAmount: z.number().int().min(0).optional(),
  interestAmount: z.number().int().min(0).optional(),
  firstDueDate: isoDateSchema,
  paymentMethod: z.string().trim().min(1).max(60),
  walletId: z.number().int().positive().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  disburseWalletId: z.number().int().positive().nullable().optional(),
  recordDisbursement: z.boolean().default(false),
  interestRateBps: z.number().int().min(0).max(10000).optional(),
  customSchedule: z.array(customInstallmentScheduleItemSchema).optional(),
});

export const closeDebtSchema = z.object({
  closed: z.boolean(),
});

export const earlyPayoffSchema = z.object({
  fromWalletId: z.number().int().positive("Pilih dompet untuk transaksi pelunasan."),
  paymentDate: isoDateSchema,
  customAmount: z.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const settleSchema = z.object({
  installmentIds: z.array(z.number().int().positive()).optional(),
  ccWalletId: z.number().int().positive().optional(),
  ccCycleKey: yearMonthSchema.optional(),
  fromWalletId: z.number().int().positive(),
  paymentDate: isoDateSchema,
  customAmount: z.number().int().positive().optional(),
  recordSettlementTx: z.boolean().default(true),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const unsettleSchema = z.object({
  removeSettlementTx: z.boolean().default(false),
});

export const createWalletRecurringFeeSchema = z.object({
  name: z.string().trim().min(1, "Nama biaya wajib diisi.").max(60),
  amount: z.number().int().positive("Nominal biaya harus lebih dari 0."),
  isActive: z.boolean().default(true),
});

export const updateWalletRecurringFeeSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  amount: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const createRecurringRuleSchema = z.object({
  merchant: z.string().trim().min(1, "Nama tagihan atau merchant wajib diisi.").max(120),
  amount: z.number().int().positive("Nominal tagihan harus lebih dari 0."),
  category: z.string().trim().min(1).max(60),
  walletId: z.number().int().positive("Pilih dompet pembayaran."),
  dueDay: z.number().int().min(1).max(31, "Tanggal jatuh tempo harus antara 1-31."),
  isActive: z.boolean().default(true),
});

export const updateRecurringRuleSchema = z.object({
  merchant: z.string().trim().min(1).max(120).optional(),
  amount: z.number().int().positive().optional(),
  category: z.string().trim().min(1).max(60).optional(),
  walletId: z.number().int().positive().optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  isActive: z.boolean().optional(),
});

export const payRecurringRuleSchema = z.object({
  period: yearMonthSchema.optional(),
  transactionDate: isoDateSchema.optional(),
  walletId: z.number().int().positive().optional(),
  amount: z.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

export const createWalletSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(WALLET_TYPES),
  accountGroup: z.enum(ACCOUNT_GROUPS).optional(),
  provider: z.enum(WALLET_PROVIDERS).optional(),
  role: z.enum(WALLET_ROLES).optional(),
  openingBalance: z.number().int().default(0),
  creditLimit: z.number().int().positive().nullable().optional(),
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
  openingBalance: z.number().int().optional(),
  creditLimit: z.number().int().positive().nullable().optional(),
  cutoffDay: z.number().int().min(1).max(28).nullable().optional(),
  statementDay: z.number().int().min(1).max(28).nullable().optional(),
  paymentDay: z.number().int().min(1).max(28).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accountNumber: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const reconcileSchema = z.object({
  actualBalance: z.number().int(),
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
  budgetLimit: z.number().int().min(0).optional(),
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
  sortOrder: z.number().int().optional(),
  budgetLimit: z.number().int().min(0).optional(),
});

export const upsertBudgetSchema = z.object({
  category: z.string().trim().min(1).max(60),
  period: z.union([z.literal("default"), yearMonthSchema]).default("default"),
  limitAmount: z.number().int().min(0, "Batas anggaran tidak boleh negatif."),
});

export const updateSettingsSchema = z.object({
  grossSalary: z.number().int().min(0).optional(),
  netSalary: z.number().int().min(0).optional(),
  payrollDeduction: z.number().int().min(0).optional(),
  defaultSalaryWalletId: z.number().int().positive().nullable().optional(),
  gajianStartDay: z.number().int().min(1).max(28).optional(),
  cardCutoffDay: z.number().int().min(1).max(28).optional(),
  statementDay: z.number().int().min(1).max(28).optional(),
  cardPaymentDay: z.number().int().min(1).max(28).optional(),
  cardLimit: z.number().int().min(0).optional(),
});

export const receiveSalarySchema = z.object({
  period: yearMonthSchema.optional(),
  grossSalary: z.number().int().positive("Gaji kotor harus lebih dari 0.").optional(),
  walletId: z.number().int().positive().optional(),
  transactionDate: isoDateSchema.optional(),
});

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Nama target tabungan wajib diisi.").max(60),
  emoji: z.string().trim().min(1).max(10).default("🎯"),
  targetAmount: z.number().int().positive("Target nominal harus lebih dari 0."),
  currentAmount: z.number().int().min(0).default(0),
  targetDate: z.string().trim().nullable().optional(),
  isEmergencyFund: z.boolean().default(false),
  walletId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  emoji: z.string().trim().min(1).max(10).optional(),
  targetAmount: z.number().int().positive().optional(),
  currentAmount: z.number().int().min(0).optional(),
  targetDate: z.string().trim().nullable().optional(),
  isEmergencyFund: z.boolean().optional(),
  walletId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const contributeGoalSchema = z.object({
  amount: z.number().int().positive("Nominal setoran harus lebih dari 0."),
  walletId: z.number().int().positive("Pilih dompet sumber dana."),
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300).optional(),
  preventOverdraft: z.boolean().optional(),
});

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, "Nama aset wajib diisi.").max(80),
  category: z.enum(ASSET_CATEGORIES),
  type: z.enum(ASSET_TYPES),
  valuationAmount: z.number().int().min(0, "Nilai valuasi tidak boleh negatif."),
  acquisitionCost: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  type: z.enum(ASSET_TYPES).optional(),
  valuationAmount: z.number().int().min(0).optional(),
  acquisitionCost: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const dashboardQuerySchema = z.object({
  cycle: z.enum(CYCLE_MODES).optional(),
  period: yearMonthSchema.optional(),
});
