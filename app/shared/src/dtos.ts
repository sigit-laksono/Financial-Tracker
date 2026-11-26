import type {
  AccountGroup,
  AssetCategory,
  AssetType,
  CategoryType,
  CycleMode,
  DebtDirection,
  DebtKind,
  InstallmentStatus,
  TransactionSource,
  TransactionType,
  WalletProvider,
  WalletRole,
  WalletType,
} from "./types";

export type AuthStatus = {
  pinConfigured: boolean;
  authenticated: boolean;
  /** True when the server refuses to run without a PIN (production default). */
  pinRequired?: boolean;
};

export type SettingsDto = {
  grossSalary: number;
  netSalary: number;
  payrollDeduction: number;
  defaultSalaryWalletId: number | null;
  gajianStartDay: number;
  cardCutoffDay: number;
  statementDay: number;
  cardPaymentDay: number;
  cardLimit: number;
};

export type WalletDto = {
  id: number;
  key: string;
  name: string;
  type: WalletType;
  role: WalletRole;
  accountGroup: AccountGroup;
  provider: WalletProvider;
  openingBalance: number;
  creditLimit: number | null;
  cutoffDay: number | null;
  statementDay: number | null;
  paymentDay: number | null;
  color: string;
  accountNumber?: string | null;
  sortOrder: number;
  isActive: boolean;
  balance: number;
  limitUsed: number;
  currentCycleSpend: number;
};

export type TransactionSplitDto = {
  id?: number;
  transactionId?: number;
  category: string;
  categoryId?: number | null;
  amount: number;
  note?: string | null;
};

export type TransactionDto = {
  id: number;
  type: TransactionType;
  merchant: string;
  amount: number;
  transactionDate: string;
  category: string;
  categoryId?: number | null;
  walletId: number;
  toWalletId: number | null;
  walletName: string;
  walletType: WalletType;
  toWalletName: string | null;
  note: string | null;
  transferGroupId?: string | null;
  ccCycleKey: string | null;
  isConvertedToInstallment: boolean;
  convertedAccountId: number | null;
  installmentId: number | null;
  isUnbilledCc: boolean;
  source: TransactionSource;
  sourceRef: string | null;
  splits?: TransactionSplitDto[];
  linkedFeeTransaction?: { id: number; amount: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type RecurringRuleDto = {
  id: number;
  merchant: string;
  amount: number;
  category: string;
  categoryId: number | null;
  walletId: number;
  walletName?: string;
  dueDay: number;
  isActive: boolean;
  lastPaidPeriod: string | null;
  createdAt: string;
  isPaidThisCycle?: boolean;
  dueDateThisCycle?: string;
};

export type QuickPresetsDto = {
  frequentTemplates: Array<{
    merchant: string;
    type: "expense" | "income";
    category: string;
    walletId: number;
    walletName?: string;
    suggestedAmount: number;
    count: number;
  }>;
  merchantSuggestions: Array<{
    merchant: string;
    category: string;
    walletId: number;
    type: "expense" | "income";
    lastUsedAmount: number;
  }>;
  frequentTransferRoutes: Array<{
    fromWalletId: number;
    fromWalletName: string;
    toWalletId: number;
    toWalletName: string;
    adminFee: number;
    count: number;
  }>;
};

export type PaginatedTransactionsDto = {
  items: TransactionDto[];
  nextCursor: { cursorDate: string; cursorId: number } | null;
  totalCount: number;
};

export type CategoryBucket = "needs" | "wants" | "savings";

export type CategoryDto = {
  id: number;
  name: string;
  type: CategoryType;
  bucket?: CategoryBucket;
  isMandatory: boolean;
  color: string;
  accountNumber?: string | null;
  sortOrder: number;
  isArchived: boolean;
};

export type BudgetStatus = "ok" | "warning" | "over";

export type GoalDto = {
  id: number;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  isEmergencyFund: boolean;
  walletId: number | null;
  walletName?: string | null;
  notes: string | null;
  percentAchieved: number;
  remainingAmount: number;
  monthlyTargetSuggested: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateGoalDto = {
  name: string;
  emoji?: string;
  targetAmount: number;
  currentAmount?: number;
  targetDate?: string | null;
  isEmergencyFund?: boolean;
  walletId?: number | null;
  notes?: string | null;
};

export type UpdateGoalDto = {
  name?: string;
  emoji?: string;
  targetAmount?: number;
  currentAmount?: number;
  targetDate?: string | null;
  isEmergencyFund?: boolean;
  walletId?: number | null;
  notes?: string | null;
};

export type ContributeGoalDto = {
  amount: number;
  walletId: number;
  date?: string;
  note?: string;
};

export type EmergencyFundRunwayDto = {
  totalEmergencyFunds: number;
  monthlyNeedsBurnRate: number;
  runwayMonths: number;
  status: "critical" | "warning" | "good" | "excellent";
  recommendedMonthsMin: number;
  recommendedMonthsMax: number;
};

export type BudgetCategorySummary = {
  categoryId: number;
  categoryName: string;
  bucket: CategoryBucket;
  color: string;
  budgetLimit: number;
  actualSpent: number;
  remaining: number;
  percentUsed: number;
  status: "safe" | "warning" | "exceeded";
};

export type BudgetOverviewDto = {
  period: string;
  isCurrentPeriod?: boolean;
  periodStart?: string;
  periodEnd?: string;
  availablePeriods?: string[];
  estimatedIncome: number;
  totalLiquidCash?: number;
  totalRemainingAllocated?: number;
  totalAllocated: number;
  unallocated: number;
  needs: {
    allocated: number;
    categoryAllocatedTotal: number;
    allocationSource: "manual" | "categories" | "none";
    remaining?: number;
    allocatedPercent: number;
    spent: number;
    categories: BudgetCategorySummary[];
  };
  wants: {
    allocated: number;
    categoryAllocatedTotal: number;
    allocationSource: "manual" | "categories" | "none";
    remaining?: number;
    allocatedPercent: number;
    spent: number;
    categories: BudgetCategorySummary[];
  };
  savings: {
    allocated: number;
    categoryAllocatedTotal: number;
    allocationSource: "manual" | "categories" | "none";
    remaining?: number;
    allocatedPercent: number;
    spent: number;
    categories: BudgetCategorySummary[];
  };
};

export type AssetDto = {
  id: number;
  name: string;
  category: AssetCategory;
  type: AssetType;
  valuationAmount: number;
  acquisitionCost: number | null;
  unrealizedGainLoss: number | null;
  unrealizedGainLossPercent: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAssetDto = {
  name: string;
  category: AssetCategory;
  type: AssetType;
  valuationAmount: number;
  acquisitionCost?: number | null;
  notes?: string | null;
};

export type UpdateAssetDto = {
  name?: string;
  category?: AssetCategory;
  type?: AssetType;
  valuationAmount?: number;
  acquisitionCost?: number | null;
  notes?: string | null;
};

export type NetWorthSummaryDto = {
  totalNetWorth: number;
  totalLiquidAssets: number;
  totalInvestmentAssets: number;
  totalFixedAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  debtToAssetRatio: number | null;
  financialStage: {
    level: "debt_hazard" | "starting" | "secure" | "stable" | "independent";
    title: string;
    description: string;
    badgeTone: "danger" | "highlight" | "soft" | "primary";
  };
  breakdown: {
    liquidWallets: Array<{
      id: number;
      name: string;
      balance: number;
      provider: string;
      color: string;
    }>;
    investments: AssetDto[];
    fixedAssets: AssetDto[];
    liabilities: Array<{
      id: number;
      name: string;
      balance: number;
      lender: string;
      kind: string;
    }>;
  };
};

export type BudgetItemDto = {
  id: number;
  category: string;
  period: string;
  effectivePeriod: string;
  isOverride: boolean;
  templateId: number | null;
  templateLimit: number | null;
  limitAmount: number;
  spentAmount: number;
  remainingAmount: number;
  percentUsed: number;
  dailyAllowanceRemaining: number;
  status: BudgetStatus;
};

export type CycleTimelineNode = {
  id: string;
  date: string;
  title: string;
  category: "cc_cutoff" | "cc_statement" | "cc_payment" | "debt_due" | "receivable_due" | "gajian";
  amount: number | null;
  status: "done" | "due_today" | "upcoming" | "overdue";
  walletId?: number | null;
  accountId?: number | null;
  installmentId?: number | null;
  badge?: string;
};

export type WalletRecurringFeeDto = {
  id: number;
  walletId: number;
  name: string;
  amount: number;
  isActive: boolean;
  createdAt: string;
};

export type DashboardDto = {
  cycle: CycleMode;
  selectedPeriod: string;
  isCurrentPeriod: boolean;
  needsOnboarding: boolean;
  periodStart: string;
  periodEnd: string;
  availablePeriods: string[];
  settings: SettingsDto;
  metrics: {
    totalLiquidCash: number;
    totalSpendableCash: number;
    totalSavingsCash: number;
    ccReservedCash: number;
    remainingObligations: number;
    unpaidInstallmentsSum: number;
    unpaidCcCyclesSum: number;
    upcomingCcCyclesSum?: number;
    unpaidRecurringSum?: number;
    safeToSpend: number;
    cycleRemaining: number;
    dailyAllowance: number;
    daysElapsed: number;
    daysTotal: number;
    daysRemaining: number;
    timeProgressPercent: number;
    pacingStatus: "hemat" | "sesuai_jalur" | "agak_boros" | "overpace";
    previousCycleComparison: {
      currentSpentToDay: number;
      prevSpentToDay: number;
      dayN: number;
    };
    salaryReceivedThisCycle: boolean;
    totalIncome: number;
    totalExpense: number;
    installmentExpense?: number;
    surplus: number;
    totalCashOut: number;
    totalCcExpense: number;
    totalSettlement: number;
    totalTransfer: number;
    ccBilled: number;
    ccUnbilled: number;
    ccUnbilledCount: number;
    ccUnbilledStart: string | null;
    ccLimit: number;
    ccLimitUsed: number;
    ccLimitAvailable: number;
  };
  wallets: WalletDto[];
  nextDueInstallment: {
    id: number;
    accountId: number;
    accountName: string;
    lender: string;
    period: string;
    dueDate: string;
    plannedAmount: number;
    color: string;
  } | null;
  unpaidCcCycles: Array<{
    cycleKey: string;
    dueDate: string;
    amount: number;
    walletId?: number;
    walletName?: string;
  }>;
  upcomingCcCycles?: Array<{
    cycleKey: string;
    dueDate: string;
    amount: number;
    walletId?: number;
    walletName?: string;
  }>;
  cycleTimeline: CycleTimelineNode[];
  budgets: BudgetItemDto[];
  budgetAlerts: BudgetItemDto[];
  categoryTotals: Array<{ category: string; total: number; count: number }>;
  incomeCategoryTotals: Array<{ category: string; total: number; count: number }>;
  dailyTotals: Array<{ date: string; income: number; expense: number }>;
  transactions: TransactionDto[];
  categories: CategoryDto[];
  recurringBills?: RecurringRuleDto[];
  budgetBuckets?: {
    needs: {
      spent: number;
      limit: number;
      percent: number;
      status: "safe" | "warning" | "exceeded" | "unconfigured";
      isConfigured?: boolean;
    };
    wants: {
      spent: number;
      limit: number;
      percent: number;
      status: "safe" | "warning" | "exceeded" | "unconfigured";
      isConfigured?: boolean;
    };
    savings: {
      spent: number;
      target: number;
      percent: number;
      status: "on_track" | "behind" | "unconfigured";
      isConfigured?: boolean;
    };
  };
  calendarHeatmap?: Array<{
    date: string;
    expense: number;
    income: number;
    count: number;
    isToday: boolean;
  }>;
};

export type CustomInstallmentScheduleItemDto = {
  monthIndex: number;
  period: string;
  dueDate: string;
  plannedAmount: number;
  principalAmount?: number;
  interestAmount?: number;
};

export type DebtAccountDto = {
  id: number;
  key: string;
  name: string;
  lender: string;
  kind: DebtKind;
  direction: DebtDirection;
  walletId: number | null;
  initialBalance: number;
  paidAmount: number;
  remainingBalance: number;
  totalInstallments: number;
  paidInstallments: number;
  paymentDay: number | null;
  paymentMethod: string;
  color: string;
  disburseWalletId: number | null;
  disbursedAt: string | null;
  interestRateBps: number | null;
  sourceTransactionId: number | null;
  closed: boolean;
  closedAt: string | null;
  createdAt: string;
};

export type InstallmentDto = {
  id: number;
  accountId: number;
  accountName: string;
  lender: string;
  accountKind: DebtKind;
  accountClosed: boolean;
  direction: DebtDirection;
  period: string;
  dueDate: string;
  plannedAmount: number;
  principalAmount: number | null;
  interestAmount: number | null;
  actualAmount: number | null;
  status: InstallmentStatus;
  paidAt: string | null;
  settlementTransactionId: number | null;
  color: string;
};

export type DebtsDto = {
  currentCcCycle: string;
  /** Current salary (gajian) cycle bounds, inclusive (YYYY-MM-DD). */
  gajianCycle: { start: string; end: string };
  totals: {
    initialDebt: number;
    paidDebt: number;
    remainingDebt: number;
    loanRemaining: number;
    payrollRemaining: number;
    cardInstallmentRemaining: number;
    initialReceivable: number;
    paidReceivable: number;
    remainingReceivable: number;
    netDebtPosition: number;
    ccLimit: number;
    ccLimitUsed: number;
    ccLimitAvailable: number;
    currentCycleSpend: number;
  };
  accounts: DebtAccountDto[];
  installments: InstallmentDto[];
  cycleTimeline: CycleTimelineNode[];
  cards: Array<{
    walletId: number;
    walletName: string;
    color: string;
    creditLimit: number;
    limitUsed: number;
    dailyLimitUsed: number;
    installmentLimitUsed: number;
    balance: number;
    currentCycleSpend: number;
    cutoffDay: number;
    statementDay: number;
    paymentDay: number;
    cycleSummaries: Array<{
      cycleKey: string;
      dailyTotal: number;
      installmentTotal: number;
      totalBill: number;
      settled: boolean;
      dailySettled: boolean;
      unpaidInstallmentIds: number[];
      transactionCount: number;
      /** Cut-off date that closes this cycle (YYYY-MM-DD). */
      closingDate: string;
      /** Payment due date for this cycle bill (YYYY-MM-DD). */
      dueDate: string;
      /** Unpaid daily spend + unpaid installments still owed on this cycle. */
      remainingBill: number;
    }>;
  }>;
  ccTransactions: Array<{
    id: number;
    merchant: string;
    amount: number;
    transactionDate: string;
    category: string;
    walletId: number;
    walletName?: string;
    note: string | null;
    ccCycleKey: string | null;
    isConvertedToInstallment: boolean;
    convertedAccountId: number | null;
  }>;
  cycleSummaries: Array<{
    cycleKey: string;
    dailyTotal: number;
    installmentTotal: number;
    totalBill: number;
    settled: boolean;
    dailySettled: boolean;
    unpaidInstallmentIds: number[];
    transactionCount: number;
    closingDate: string;
    dueDate: string;
    remainingBill: number;
  }>;
  wallets: WalletDto[];
};

export type BackupCountsDto = {
  wallets: number;
  categories: number;
  accounts: number;
  installments: number;
  transactions: number;
  transactionSplits: number;
  settlementAllocations: number;
  budgets: number;
  goals: number;
  assets: number;
  walletRecurringFees: number;
  recurringRules: number;
};

export type BackupImportResponseDto = {
  ok: boolean;
  message: string;
  exportedAt: string;
  counts: BackupCountsDto;
};
