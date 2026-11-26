export const WALLET_TYPES = ["bank", "ewallet", "cash", "credit_card"] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const ACCOUNT_GROUPS = ["bank", "ewallet", "cash", "credit", "other"] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

export const WALLET_PROVIDERS = [
  "bca",
  "mandiri",
  "bni",
  "bri",
  "btn",
  "cimb",
  "bsi",
  "permata",
  "danamon",
  "jago",
  "seabank",
  "blu",
  "jenius",
  "gopay",
  "ovo",
  "dana",
  "shopeepay",
  "linkaja",
  "astrapay",
  "isaku",
  "mega",
  "spaylater",
  "gopaylater",
  "kredivo",
  "akulaku",
  "traveloka_paylater",
  "indodana",
  "atome",
  "cash",
  "other",
] as const;
export type WalletProvider = (typeof WALLET_PROVIDERS)[number];

export const WALLET_ROLES = ["spending", "savings", "credit_card"] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

export const TRANSACTION_TYPES = [
  "expense",
  "income",
  "transfer",
  "settlement",
  "adjustment",
  "debt_disbursement",
  "debt_collection",
  "loan_disbursement",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = ["manual", "whatsapp", "import", "system"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const DEBT_DIRECTIONS = ["payable", "receivable"] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export const DEBT_KINDS = ["loan", "card_installment", "payroll", "receivable"] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const INSTALLMENT_STATUSES = ["upcoming", "paid"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const CATEGORY_TYPES = ["expense", "income"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CYCLE_MODES = ["gajian", "cc"] as const;
export type CycleMode = (typeof CYCLE_MODES)[number];

export const ASSET_CATEGORIES = ["investment", "fixed"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_TYPES = [
  "gold",
  "stocks",
  "mutual_fund",
  "crypto",
  "bonds",
  "property",
  "vehicle",
  "electronics",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Note written on bank fees that CC billing auto-posts from the statement. */
export const CC_STATEMENT_FEE_NOTE = "Biaya bank dari statement, tercatat otomatis";
