import { eq } from "drizzle-orm";
import type { AppDb } from "./index";
import { appSettings, categories, walletRecurringFees, wallets } from "./schema";

export const DEFAULT_WALLETS = [
  {
    key: "bni",
    name: "BNI",
    type: "bank",
    accountGroup: "bank",
    provider: "bni",
    color: "#00797a",
    sortOrder: 1,
  },
  {
    key: "bca",
    name: "BCA",
    type: "bank",
    accountGroup: "bank",
    provider: "bca",
    color: "#2d54bc",
    sortOrder: 2,
  },
  {
    key: "btpn",
    name: "BTPN",
    type: "bank",
    accountGroup: "bank",
    provider: "jago",
    color: "#059488",
    sortOrder: 3,
  },
  {
    key: "gopay",
    name: "GoPay",
    type: "ewallet",
    accountGroup: "ewallet",
    provider: "gopay",
    color: "#009267",
    sortOrder: 4,
  },
  {
    key: "dana",
    name: "DANA",
    type: "ewallet",
    accountGroup: "ewallet",
    provider: "dana",
    color: "#456ed1",
    sortOrder: 5,
  },
  {
    key: "tunai",
    name: "Tunai",
    type: "cash",
    accountGroup: "cash",
    provider: "cash",
    color: "#566361",
    sortOrder: 6,
  },
  {
    key: "cc-jenius",
    name: "Kartu Kredit",
    type: "credit_card",
    accountGroup: "credit",
    provider: "other",
    creditLimit: 20_000_000,
    cutoffDay: 20,
    statementDay: 21,
    paymentDay: 25,
    color: "#e16c10",
    sortOrder: 7,
  },
] as const;

export const DEFAULT_CATEGORIES = [
  // --- EXPENSE ---
  {
    name: "Makanan & Belanja Dapur",
    type: "expense",
    bucket: "needs",
    isMandatory: false,
    color: "#00797a",
    sortOrder: 1,
  },
  {
    name: "Tagihan & Utilitas Rumah",
    type: "expense",
    bucket: "needs",
    isMandatory: true,
    color: "#a79300",
    sortOrder: 2,
  },
  {
    name: "Transportasi & Bensin",
    type: "expense",
    bucket: "needs",
    isMandatory: false,
    color: "#e16c10",
    sortOrder: 3,
  },
  {
    name: "Internet & Komunikasi",
    type: "expense",
    bucket: "needs",
    isMandatory: false,
    color: "#456ed1",
    sortOrder: 4,
  },
  {
    name: "Kesehatan & Medis",
    type: "expense",
    bucket: "needs",
    isMandatory: false,
    color: "#a42423",
    sortOrder: 5,
  },
  {
    name: "Cicilan & Hutang",
    type: "expense",
    bucket: "savings",
    isMandatory: true,
    color: "#ef4444",
    sortOrder: 6,
  },
  {
    name: "Nafkah Keluarga & Ortu",
    type: "expense",
    bucket: "needs",
    isMandatory: true,
    color: "#009267",
    sortOrder: 7,
  },
  {
    name: "Biaya Bank",
    type: "expense",
    bucket: "needs",
    isMandatory: false,
    color: "#566361",
    sortOrder: 8,
  },
  {
    name: "Jajan & Nongkrong",
    type: "expense",
    bucket: "wants",
    isMandatory: false,
    color: "#ff8a00",
    sortOrder: 9,
  },
  {
    name: "Belanja Pribadi & Hobi",
    type: "expense",
    bucket: "wants",
    isMandatory: false,
    color: "#2d54bc",
    sortOrder: 10,
  },
  {
    name: "Hiburan & Langganan",
    type: "expense",
    bucket: "wants",
    isMandatory: false,
    color: "#c63895",
    sortOrder: 11,
  },
  {
    name: "Sosial & Hadiah Keluarga",
    type: "expense",
    bucket: "wants",
    isMandatory: false,
    color: "#0ea5e9",
    sortOrder: 12,
  },
  {
    name: "Tabungan",
    type: "expense",
    bucket: "savings",
    isMandatory: false,
    color: "#059488",
    sortOrder: 13,
  },
  {
    name: "Lainnya",
    type: "expense",
    bucket: "wants",
    isMandatory: false,
    color: "#64748b",
    sortOrder: 14,
  },

  // --- INCOME ---
  {
    name: "Gaji",
    type: "income",
    bucket: "savings",
    isMandatory: false,
    color: "#009267",
    sortOrder: 1,
  },
  {
    name: "Usaha & Freelance",
    type: "income",
    bucket: "savings",
    isMandatory: false,
    color: "#059488",
    sortOrder: 2,
  },
  {
    name: "Bonus & Hadiah",
    type: "income",
    bucket: "savings",
    isMandatory: false,
    color: "#10b981",
    sortOrder: 3,
  },
  {
    name: "Investasi",
    type: "income",
    bucket: "savings",
    isMandatory: false,
    color: "#2d54bc",
    sortOrder: 4,
  },
  {
    name: "Pinjaman",
    type: "income",
    bucket: "needs",
    isMandatory: false,
    color: "#e16c10",
    sortOrder: 5,
  },
  {
    name: "Piutang",
    type: "income",
    bucket: "needs",
    isMandatory: false,
    color: "#00797a",
    sortOrder: 6,
  },
  {
    name: "Saldo Awal",
    type: "income",
    bucket: "savings",
    isMandatory: false,
    color: "#566361",
    sortOrder: 7,
  },
  {
    name: "Lainnya",
    type: "income",
    bucket: "wants",
    isMandatory: false,
    color: "#64748b",
    sortOrder: 8,
  },
] as const;

export async function ensureDefaultSeed(db: AppDb): Promise<void> {
  const settings = await db
    .select({ id: appSettings.id })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  // If database was already seeded / initialized, do NOT re-insert deleted wallets or categories!
  if (settings.length > 0) {
    return;
  }

  // Categories are fundamental for budgeting and transaction classification, always seed them
  for (const category of DEFAULT_CATEGORIES) {
    await db
      .insert(categories)
      .values({
        name: category.name,
        type: category.type,
        bucket: category.bucket,
        isMandatory: category.isMandatory,
        color: category.color,
        sortOrder: category.sortOrder,
      })
      .onConflictDoNothing();
  }

  // Mock wallets should only be seeded in test environment or when explicitly requested
  const shouldSeedMockWallets =
    process.env.NODE_ENV === "test" || process.env.SEED_MOCK_WALLETS === "true";

  let defaultWalletId: number | null = null;

  if (shouldSeedMockWallets) {
    for (const wallet of DEFAULT_WALLETS) {
      const existing = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.key, wallet.key))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(wallets).values({
          key: wallet.key,
          name: wallet.name,
          type: wallet.type,
          accountGroup: wallet.accountGroup,
          provider: wallet.provider,
          role: wallet.type === "credit_card" ? "credit_card" : "spending",
          openingBalance: 0,
          creditLimit: "creditLimit" in wallet ? wallet.creditLimit : null,
          cutoffDay: "cutoffDay" in wallet ? wallet.cutoffDay : null,
          statementDay: "statementDay" in wallet ? wallet.statementDay : null,
          paymentDay: "paymentDay" in wallet ? wallet.paymentDay : null,
          color: wallet.color,
          sortOrder: wallet.sortOrder,
          isActive: true,
        });
      }
    }

    const bni = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.key, "bni"))
      .limit(1);
    defaultWalletId = bni[0]?.id ?? null;

    // Ensure default recurring fees for cc-jenius
    const ccJenius = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.key, "cc-jenius"))
      .limit(1);
    if (ccJenius[0]) {
      const existingFees = await db
        .select({ id: walletRecurringFees.id })
        .from(walletRecurringFees)
        .where(eq(walletRecurringFees.walletId, ccJenius[0].id))
        .limit(1);
      if (existingFees.length === 0) {
        await db.insert(walletRecurringFees).values([
          {
            walletId: ccJenius[0].id,
            name: "Materai",
            amount: 10_000,
            isActive: true,
          },
          {
            walletId: ccJenius[0].id,
            name: "Notifikasi",
            amount: 12_500,
            isActive: true,
          },
        ]);
      }
    }
  }

  await db.insert(appSettings).values({ id: 1, defaultSalaryWalletId: defaultWalletId });
}
