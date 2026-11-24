export type TransactionFiltersState = {
  weekChoice: number | "all" | "auto";
  walletFilter: string;
  typeFilter: string;
  categoryFilter: string;
  search: string;
  hidePayday: boolean;
};

export const INITIAL_TRANSACTION_FILTERS: TransactionFiltersState = {
  weekChoice: "all",
  walletFilter: "all",
  typeFilter: "all",
  categoryFilter: "all",
  search: "",
  hidePayday: true,
};
