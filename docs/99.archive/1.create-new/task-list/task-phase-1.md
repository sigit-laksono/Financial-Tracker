# Task List Phase 1: Fondasi, Skema Database & Migrasi Data

**Referensi:** [PRD.md](./PRD.md) | [DESIGN.md](./DESIGN.md)  
**Status:** Selesai & Terverifikasi (`22 Nov 2026`)  
**Target:** Workspace aplikasi siap dijalankan di Windows lokal (`Bun 1.4.4`), skema SQLite terpadu terbentuk, dan seluruh data histori dari kedua aplikasi lama termigrasi tanpa duplikasi.

---

## 1. Setup Struktur Project
- [x] Tentukan lokasi project baru (`app/` dengan `server/`, `client/`, `shared/`) agar tidak mengganggu folder arsip `debt-management/` dan `money-management/`.
- [x] Inisialisasi `package.json` dengan scripts terpadu (`dev`, `dev:server`, `dev:client`, `build`, `typecheck`, `db:generate`, `db:migrate`, `db:migrate-legacy`, `db:audit`).
- [x] Setup `tsconfig.json` untuk shared types, server (Bun + Hono), dan client (React 19 + Vite).
- [x] Install dependencies utama (420 packages via `bun install`):
  - Backend: `hono`, `drizzle-orm`, `zod` (`bun:sqlite`).
  - Frontend: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss` v4, `@tanstack/react-query`, `recharts` (ikon custom SVG sesuai `DESIGN.md`, tanpa `lucide-react`).
  - Tooling/PWA: `drizzle-kit`, `vite-plugin-pwa`, `@types/react`, `@types/react-dom`, `typescript`.
- [x] Buat `.env.example` & konfigurasi path database SQLite lokal (`./data/financial-tracker.db`).

## 2. Desain & Implementasi Skema Database (Drizzle + SQLite)
- [x] Buat `app/server/src/db/schema.ts` sesuai spesifikasi PRD:
  - [x] `wallets` (`id`, `key`, `name`, `type`, `openingBalance`, `creditLimit`, `cutoffDay`, `statementDay`, `paymentDay`, `color`, `sortOrder`, `isActive`, `createdAt`)
  - [x] `categories` (`id`, `name`, `type`, `isMandatory`, `color`, `sortOrder`, `isArchived`)
  - [x] `transactions` (`id`, `type`, `merchant`, `amount`, `transactionDate`, `category`, `walletId`, `toWalletId`, `note`, `ccCycleKey`, `isConvertedToInstallment`, `convertedAccountId`, `installmentId`, `source`, `sourceRef` unique, `createdAt`, `updatedAt`) + index tanggal, tipe, wallet, dan `ccCycleKey`
  - [x] `debtAccounts` (`id`, `key`, `name`, `lender`, `kind`, `walletId`, `initialBalance`, `paymentDay`, `paymentMethod`, `color`, `sourceTransactionId`, `closedAt`, `createdAt`)
  - [x] `installments` (`id`, `accountId`, `period`, `dueDate`, `plannedAmount`, `actualAmount`, `status`, `paidAt`, `settlementTransactionId`)
  - [x] `budgets` (`id`, `category`, `period`, `limitAmount`, `createdAt`, `updatedAt`)
  - [x] `appSettings` (`id`, `grossSalary`, `netSalary`, `payrollDeduction`, `gajianStartDay`, `cardCutoffDay`, `statementDay`, `cardPaymentDay`, `cardLimit`, `pinHash`, `updatedAt`)
- [x] Setup `app/drizzle.config.ts` dan generate migrasi SQL awal (`app/drizzle/0000_nosy_killer_shrike.sql`).
- [x] Buat helper koneksi DB `app/server/src/db/index.ts` dan migrator `app/server/src/db/migrate.ts` dengan `PRAGMA foreign_keys = ON` dan `PRAGMA journal_mode = WAL`.
- [x] Terapkan standar komentar kode `antislop-code`.

## 3. Seed Default & Script Migrasi Data Lama (`migrate-legacy.ts`)
- [x] Buat `app/server/src/db/seed.ts` (idempoten) untuk seed default wallets (`BNI`, `BCA`, `BTPN`, `GoPay`, `DANA`, `Tunai`, `CC Jenius`) dan kategori standar.
- [x] Implementasikan `app/server/src/db/migrate-legacy.ts` membaca `debt-management/data/app.db` dan `money-management/data/app.db`.
- [x] Mapping & deduplikasi data:
  - [x] Migrasi `settings` ke `appSettings`.
  - [x] Migrasi seluruh 6 `debt_accounts` (termasuk `closedAt`) dan 47 `installments` apa adanya.
  - [x] Migrasi 195 transaksi `money-management.expenses` ke `transactions` (`is_cc_settlement = 1` -> `type = "settlement"`).
  - [x] Migrasi & deduplikasi `debt-management.card_transactions`: transaksi baru masuk dan transaksi duplikat dilewati berdasarkan fingerprint tanggal + merchant + nominal.
- [x] Verifikasi idempotensi migrasi (eksekusi ulang ke-2 menghasilkan 0 insert baru).

## 4. Verifikasi Phase 1
- [x] `bun run typecheck` lulus tanpa error.
- [x] `bun run db:audit` lulus (`AUDIT PASSED`) tanpa selisih total akun utang, cicilan, pemasukan, pengeluaran, dan sisa kas terhadap snapshot legacy.
