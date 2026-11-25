import type {
  AssetDto,
  AuthStatus,
  BackupCountsDto,
  BackupImportResponseDto,
  BudgetCategorySummary,
  BudgetItemDto,
  BudgetOverviewDto,
  CategoryDto,
  CreateAssetDto,
  CreateGoalDto,
  CustomInstallmentScheduleItemDto,
  CycleTimelineNode,
  DashboardDto,
  DebtAccountDto,
  DebtsDto,
  EmergencyFundRunwayDto,
  GoalDto,
  InstallmentDto,
  NetWorthSummaryDto,
  PaginatedTransactionsDto,
  QuickPresetsDto,
  RecurringRuleDto,
  SettingsDto,
  TransactionDto,
  TransactionSplitDto,
  UpdateAssetDto,
  UpdateGoalDto,
  WalletDto,
  WalletRecurringFeeDto,
} from "../../../shared/src/dtos";
import type {
  AccountGroup,
  AssetCategory,
  AssetType,
  CategoryType,
  CycleMode,
  DebtDirection,
  DebtKind,
  WalletProvider,
  WalletRole,
  WalletType,
} from "../../../shared/src/types";

export type {
  AssetCategory,
  AssetDto,
  AssetType,
  AuthStatus,
  BackupCountsDto,
  BackupImportResponseDto,
  BudgetCategorySummary,
  BudgetItemDto,
  BudgetOverviewDto,
  CategoryDto,
  CreateAssetDto,
  CreateGoalDto,
  CustomInstallmentScheduleItemDto,
  CycleTimelineNode,
  DashboardDto,
  DebtAccountDto,
  DebtDirection,
  DebtsDto,
  EmergencyFundRunwayDto,
  GoalDto,
  InstallmentDto,
  NetWorthSummaryDto,
  PaginatedTransactionsDto,
  QuickPresetsDto,
  RecurringRuleDto,
  SettingsDto,
  TransactionDto,
  TransactionSplitDto,
  UpdateAssetDto,
  UpdateGoalDto,
  WalletDto,
  WalletRecurringFeeDto,
  WalletRole,
};

export interface AuditLogDto {
  id: number;
  entityType: string;
  entityId: number | null;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: number;
}

export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const contentType = res.headers.get("content-type") ?? "";
  let parsedJson: unknown = null;
  let invalidJson = false;
  try {
    parsedJson = await res.json();
  } catch {
    invalidJson = true;
  }

  const data = (parsedJson && typeof parsedJson === "object" ? parsedJson : {}) as {
    error?: string;
  } & T;

  if (!res.ok) {
    throw new ApiError(data.error ?? `Permintaan gagal (${res.status})`, res.status, data);
  }
  if (invalidJson || !contentType.includes("application/json")) {
    throw new ApiError(
      "Respons server tidak valid (bukan JSON). Pastikan server backend versi terbaru sedang berjalan.",
      502,
    );
  }
  return data;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>("/api/auth/status"),
  setupPin: (pin: string) =>
    request<{ ok: boolean }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  login: (pin: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  logoutAll: () => request<{ ok: boolean }>("/api/auth/logout-all", { method: "POST" }),
  changePin: (currentPin: string | undefined, newPin: string | null) =>
    request<{ ok: boolean; pinConfigured: boolean }>("/api/auth/change-pin", {
      method: "POST",
      body: JSON.stringify({ currentPin, newPin }),
    }),

  syncLedger: (payload: { cycleKey?: string; force?: boolean } = {}) =>
    request<{ ok: boolean; synced: boolean; feesInserted: number; payrollSettled: number }>(
      "/api/ledger/sync",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  getSalaryPreview: (params?: { period?: string; grossSalary?: number; walletId?: number }) => {
    const qs = new URLSearchParams();
    if (params?.period) qs.set("period", params.period);
    if (params?.grossSalary) qs.set("grossSalary", String(params.grossSalary));
    if (params?.walletId) qs.set("walletId", String(params.walletId));
    return request<{
      ok: boolean;
      period: string;
      periodStart: string;
      periodEnd: string;
      grossSalary: number;
      totalPayrollDue: number;
      netSalary: number;
      targetWalletId: number | null;
      alreadyReceived: boolean;
      existingTransactionId: number | null;
      payrollInstallments: Array<{
        id: number;
        accountId: number;
        accountName: string;
        lender: string;
        dueDate: string;
        plannedAmount: number;
      }>;
    }>(`/api/ledger/salary-preview?${qs.toString()}`);
  },

  receiveSalary: (payload: {
    period?: string;
    grossSalary?: number;
    walletId?: number;
    transactionDate?: string;
  }) =>
    request<{
      ok: boolean;
      period: string;
      grossSalary: number;
      netSalary: number;
      totalPayrollDue: number;
      paidInstallmentsCount: number;
      transaction: TransactionDto;
    }>("/api/ledger/receive-salary", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getDashboard: (cycle: CycleMode, period?: string) => {
    const qs = new URLSearchParams({ cycle });
    if (period) qs.set("period", period);
    return request<DashboardDto>(`/api/dashboard?${qs.toString()}`);
  },
  getTransactions: (params: {
    start?: string;
    end?: string;
    walletId?: number;
    type?: string;
    category?: string;
    search?: string;
    limit?: number;
    cursorDate?: string;
    cursorId?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.start) qs.set("start", params.start);
    if (params.end) qs.set("end", params.end);
    if (params.walletId) qs.set("walletId", String(params.walletId));
    if (params.type && params.type !== "all") qs.set("type", params.type);
    if (params.category && params.category !== "all") qs.set("category", params.category);
    if (params.search?.trim()) qs.set("search", params.search.trim());
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursorDate && params.cursorId) {
      qs.set("cursorDate", params.cursorDate);
      qs.set("cursorId", String(params.cursorId));
    }
    return request<PaginatedTransactionsDto>(`/api/transactions?${qs.toString()}`);
  },

  getWallets: () => request<{ wallets: WalletDto[] }>("/api/wallets"),
  createWallet: (payload: {
    name: string;
    type: WalletType;
    accountGroup?: AccountGroup;
    provider?: WalletProvider;
    role?: WalletRole;
    openingBalance: number;
    initialUsage?: number;
    color: string;
    accountNumber?: string | null;
    creditLimit?: number | null;
    cutoffDay?: number | null;
    statementDay?: number | null;
    paymentDay?: number | null;
  }) =>
    request<{ wallet: WalletDto }>("/api/wallets", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateWallet: (
    id: number,
    payload: {
      name?: string;
      role?: WalletRole;
      accountGroup?: AccountGroup;
      provider?: WalletProvider;
      openingBalance?: number;
      accountNumber?: string | null;
      creditLimit?: number | null;
      cutoffDay?: number | null;
      statementDay?: number | null;
      paymentDay?: number | null;
      isActive?: boolean;
      color?: string;
    },
  ) =>
    request<{ wallet: WalletDto }>(`/api/wallets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteWallet: (id: number, cascade?: boolean) => {
    const qs = new URLSearchParams();
    if (cascade) qs.set("cascade", "true");
    return request<{ ok: boolean; message: string }>(
      `/api/wallets/${id}${qs.toString() ? `?${qs.toString()}` : ""}`,
      { method: "DELETE" },
    );
  },
  reconcileWallet: (id: number, payload: { actualBalance: number; date?: string; note?: string }) =>
    request<{ ok: boolean; adjusted: boolean; delta: number }>(`/api/wallets/${id}/reconcile`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getQuickPresets: (q?: string) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set("q", q.trim());
    return request<QuickPresetsDto>(`/api/transactions/quick-presets?${qs.toString()}`);
  },

  createTransaction: (payload: {
    type: "expense" | "income";
    merchant: string;
    amount: number;
    transactionDate: string;
    category: string;
    walletId: number;
    note?: string;
    splits?: Array<{ category: string; amount: number; note?: string | null }>;
  }) =>
    request<{ ok: boolean; id: number }>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createTransfer: (payload: {
    fromWalletId: number;
    toWalletId: number;
    amount: number;
    adminFee?: number;
    transactionDate: string;
    merchant?: string;
    note?: string;
    preventOverdraft?: boolean;
  }) =>
    request<{ ok: boolean; transferId: number; feeTransactionId: number | null }>(
      "/api/transactions/transfer",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  updateTransaction: (
    id: number,
    payload: {
      type?: "expense" | "income" | "transfer";
      merchant?: string;
      amount?: number;
      transactionDate?: string;
      category?: string;
      walletId?: number;
      toWalletId?: number | null;
      adminFee?: number;
      note?: string | null;
      splits?: Array<{ category: string; amount: number; note?: string | null }>;
    },
  ) =>
    request<{ ok: boolean }>(`/api/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteTransaction: (id: number) =>
    request<{ ok: boolean }>(`/api/transactions/${id}`, { method: "DELETE" }),
  getRecurringRules: () => request<{ rules: RecurringRuleDto[] }>("/api/recurring"),
  createRecurringRule: (payload: {
    merchant: string;
    amount: number;
    category: string;
    walletId: number;
    dueDay: number;
    isActive?: boolean;
  }) =>
    request<{ ok: boolean; rule: RecurringRuleDto }>("/api/recurring", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateRecurringRule: (
    id: number,
    payload: {
      merchant?: string;
      amount?: number;
      category?: string;
      walletId?: number;
      dueDay?: number;
      isActive?: boolean;
    },
  ) =>
    request<{ ok: boolean; rule: RecurringRuleDto }>(`/api/recurring/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteRecurringRule: (id: number) =>
    request<{ ok: boolean }>(`/api/recurring/${id}`, { method: "DELETE" }),
  payRecurringRule: (
    id: number,
    payload?: {
      period?: string;
      transactionDate?: string;
      walletId?: number;
      amount?: number;
      note?: string;
    },
  ) =>
    request<{ ok: boolean; alreadyPaid: boolean; transactionId: number; period: string }>(
      `/api/recurring/${id}/pay`,
      {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      },
    ),
  convertToSplitPay: (
    id: number,
    payload: {
      name?: string;
      installmentCount: number;
      installmentAmount: number;
      firstPeriod: string;
      paymentDay?: number;
    },
  ) =>
    request<{ ok: boolean; accountId: number }>(`/api/transactions/${id}/convert-to-installment`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getDebts: () => request<DebtsDto>("/api/debts"),
  createDebt: (payload: {
    name: string;
    lender: string;
    kind: DebtKind;
    direction?: DebtDirection;
    initialBalance: number;
    installmentCount: number;
    installmentAmount: number;
    principalAmount?: number;
    interestAmount?: number;
    firstDueDate: string;
    paymentMethod: string;
    walletId?: number | null;
    color?: string;
    disburseWalletId?: number | null;
    recordDisbursement?: boolean;
    interestRateBps?: number;
    customSchedule?: CustomInstallmentScheduleItemDto[];
  }) =>
    request<{ ok: boolean; accountId: number }>("/api/debts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDebt: (
    id: number,
    payload: {
      name?: string;
      lender?: string;
      kind?: DebtKind;
      paymentMethod?: string;
      walletId?: number | null;
      installments?: Array<{
        id: number;
        dueDate: string;
        plannedAmount: number;
      }>;
    },
  ) =>
    request<{ ok: boolean; accountId: number; initialBalance: number }>(`/api/debts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  earlyPayoff: (
    id: number,
    payload: {
      fromWalletId: number;
      paymentDate: string;
      customAmount?: number;
      note?: string;
      preventOverdraft?: boolean;
    },
  ) =>
    request<{
      ok: boolean;
      accountId: number;
      payoffAmount: number;
      settledCount: number;
      settlementTransactionId: number | null;
    }>(`/api/debts/${id}/payoff`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  closeDebt: (id: number, closed: boolean) =>
    request<{ ok: boolean; closed: boolean }>(`/api/debts/${id}/close`, {
      method: "PATCH",
      body: JSON.stringify({ closed }),
    }),
  deleteDebt: (id: number) =>
    request<{ ok: boolean }>(`/api/debts/${id}`, {
      method: "DELETE",
    }),
  settleInstallments: (payload: {
    installmentIds?: number[];
    ccWalletId?: number;
    ccCycleKey?: string;
    fromWalletId: number;
    paymentDate: string;
    customAmount?: number;
    recordSettlementTx?: boolean;
    note?: string;
    preventOverdraft?: boolean;
  }) =>
    request<{
      ok: boolean;
      settledCount: number;
      totalAmount: number;
      settlementTransactionId: number | null;
      closedAccountIds?: number[];
    }>("/api/installments/settle", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  unsettleInstallment: (id: number, removeSettlementTx = false) =>
    request<{ ok: boolean }>(`/api/installments/${id}/unsettle`, {
      method: "POST",
      body: JSON.stringify({ removeSettlementTx }),
    }),
  updateInstallment: (
    id: number,
    payload: { plannedAmount?: number; dueDate?: string },
  ) =>
    request<{ ok: boolean; installment: InstallmentDto }>(`/api/installments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getWalletRecurringFees: (walletId: number) =>
    request<{ fees: WalletRecurringFeeDto[] }>(`/api/wallets/${walletId}/recurring-fees`),
  createWalletRecurringFee: (
    walletId: number,
    payload: { name: string; amount: number; isActive?: boolean },
  ) =>
    request<{ ok: boolean; fee: WalletRecurringFeeDto }>(
      `/api/wallets/${walletId}/recurring-fees`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  updateWalletRecurringFee: (
    walletId: number,
    feeId: number,
    payload: { name?: string; amount?: number; isActive?: boolean },
  ) =>
    request<{ ok: boolean; fee: WalletRecurringFeeDto }>(
      `/api/wallets/${walletId}/recurring-fees/${feeId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
  deleteWalletRecurringFee: (walletId: number, feeId: number) =>
    request<{ ok: boolean }>(`/api/wallets/${walletId}/recurring-fees/${feeId}`, {
      method: "DELETE",
    }),

  getCategories: () => request<{ categories: CategoryDto[] }>("/api/categories"),
  createCategory: (payload: {
    name: string;
    type?: CategoryType;
    bucket?: "needs" | "wants" | "savings";
    isMandatory?: boolean;
    color?: string;
    budgetLimit?: number;
    period?: string;
  }) =>
    request<{ category: CategoryDto }>("/api/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCategory: (
    id: number,
    payload: {
      name?: string;
      bucket?: "needs" | "wants" | "savings";
      isMandatory?: boolean;
      color?: string;
      isArchived?: boolean;
      budgetLimit?: number;
      period?: string;
    },
  ) =>
    request<{ category: CategoryDto }>(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCategory: (id: number) =>
    request<{ ok: boolean; message?: string }>(`/api/categories/${id}`, { method: "DELETE" }),

  getBudgets: (period: string) =>
    request<{
      period: string;
      budgets: BudgetItemDto[];
    }>(`/api/budgets?period=${encodeURIComponent(period)}`),
  getBudgetSummary: (period?: string) =>
    request<BudgetOverviewDto>(
      period ? `/api/budgets/summary?period=${encodeURIComponent(period)}` : "/api/budgets/summary",
    ),
  upsertBudget: (payload: { category: string; period: string; limitAmount: number }) =>
    request<{ ok: boolean }>("/api/budgets", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteBudget: (id: number) =>
    request<{ ok: boolean }>(`/api/budgets/${id}`, { method: "DELETE" }),
  copyPreviousBudgets: (targetPeriod: string) =>
    request<{ ok: boolean; copiedCount: number }>("/api/budgets/copy-previous", {
      method: "POST",
      body: JSON.stringify({ targetPeriod }),
    }),

  getGoals: () =>
    request<{ goals: GoalDto[]; emergencyFund: EmergencyFundRunwayDto }>("/api/goals"),
  createGoal: (payload: CreateGoalDto) =>
    request<{ ok: boolean; goal: GoalDto }>("/api/goals", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateGoal: (id: number, payload: UpdateGoalDto) =>
    request<{ ok: boolean; goal: GoalDto }>(`/api/goals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteGoal: (id: number) => request<{ ok: boolean }>(`/api/goals/${id}`, { method: "DELETE" }),
  contributeGoal: (
    id: number,
    payload: {
      amount: number;
      walletId: number;
      date?: string;
      note?: string;
      preventOverdraft?: boolean;
    },
  ) =>
    request<{ ok: boolean; transactionId: number | null; goal: GoalDto }>(
      `/api/goals/${id}/contribute`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  getAssets: () => request<{ assets: AssetDto[] }>("/api/assets"),
  createAsset: (payload: CreateAssetDto) =>
    request<{ ok: boolean; asset: AssetDto }>("/api/assets", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAsset: (id: number, payload: UpdateAssetDto) =>
    request<{ ok: boolean; asset: AssetDto }>(`/api/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteAsset: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/assets/${id}`, { method: "DELETE" }),
  getNetWorthSummary: () => request<NetWorthSummaryDto>("/api/assets/net-worth-summary"),

  getSettings: () =>
    request<{
      settings: SettingsDto & { pinConfigured: boolean };
    }>("/api/settings"),
  updateSettings: (payload: Partial<SettingsDto>) =>
    request<{ ok: boolean }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getAuditLogs: (params?: { limit?: number; offset?: number; entityType?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    if (params?.entityType) sp.set("entityType", params.entityType);
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return request<{ logs: AuditLogDto[]; total: number; limit: number; offset: number }>(
      `/api/settings/audit-logs${qs}`,
    );
  },
  resetData: (confirmation: string, mode: "all" | "transactions" = "transactions") =>
    request<{ ok: boolean; message: string }>("/api/settings/reset", {
      method: "POST",
      body: JSON.stringify({ confirmation, mode }),
    }),
  importBackup: (snapshot: unknown, confirmation: string) =>
    request<BackupImportResponseDto>("/api/export/import", {
      method: "POST",
      body: JSON.stringify({ snapshot, confirmation }),
    }),
};
