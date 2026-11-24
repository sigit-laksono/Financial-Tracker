/**
 * Central TanStack Query Keys
 * Standardizes query key hierarchies for consistent cache synchronization and invalidation.
 */

export const budgetKeys = {
  all: ["budgets"] as const,
  list: (period?: string) => (period ? (["budgets", period] as const) : (["budgets"] as const)),
  summaryRoot: ["budget-summary"] as const,
  summary: (period?: string) =>
    period ? (["budget-summary", period] as const) : (["budget-summary"] as const),
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
  period: (cycleKey?: string) =>
    cycleKey ? (["dashboard", cycleKey] as const) : (["dashboard"] as const),
};

export const transactionKeys = {
  all: ["transactions"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["transactions", filters] as const) : (["transactions"] as const),
};

export const walletKeys = {
  all: ["wallets"] as const,
  detail: (id: number) => ["wallets", id] as const,
  recurringFees: (walletId: number) => ["wallet-recurring-fees", walletId] as const,
};

export const debtKeys = {
  all: ["debts"] as const,
  detail: (id: number) => ["debts", id] as const,
};

export const assetKeys = {
  all: ["assets"] as const,
  summary: ["net-worth-summary"] as const,
};

export const goalKeys = {
  all: ["goals"] as const,
};
