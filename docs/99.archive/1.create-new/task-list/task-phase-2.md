# Task List Phase 2: Backend API, Auth PIN/Password & Core Ledger Engine

**Referensi:** [PRD.md](./PRD.md) | [DESIGN.md](./DESIGN.md)  
**Status:** Selesai & Terverifikasi (`22 Nov 2026`)  
**Target:** Seluruh endpoint REST API (Hono) berjalan stabil, tervalidasi Zod, terlindungi auth single-owner, dan mengimplementasikan seluruh logika bisnis akuntansi kas, kartu kredit, cicilan, dan budgeting.

---

## 1. Keamanan & Auth Single-Owner
- [x] Buat utilitas auth (`app/server/src/lib/auth.ts`):
  - [x] Hashing PIN/password menggunakan `Bun.password.hash` / `Bun.password.verify`.
  - [x] Signed session token (HMAC-SHA256) yang disimpan di HTTP-only cookie (`SameSite=Lax`).
  - [x] Rate-limiting sederhana di memory untuk endpoint login (`LoginRateLimiter`, 5 percobaan/menit).
- [x] Implementasikan endpoint auth (`app/server/src/routes/auth.ts`):
  - [x] `GET /api/auth/status`: cek apakah PIN sudah diset & apakah request saat ini sudah terautentikasi.
  - [x] `POST /api/auth/setup`: set PIN/password pertama kali (hanya jika `pinHash` masih kosong).
  - [x] `POST /api/auth/login`: verifikasi PIN/password dan set cookie sesi.
  - [x] `POST /api/auth/logout`: hapus cookie sesi.
  - [x] `POST /api/auth/change-pin`: ubah atau nonaktifkan PIN (butuh verifikasi PIN lama jika aktif).
- [x] Pasang auth middleware pada seluruh `/api/*` selain `/api/auth/status`, `/api/auth/setup`, `/api/auth/login`, dan `/api/health`.

## 2. Helper Siklus & Otomatisasi Ledger (`app/server/src/lib/dates.ts` & `ledger.ts`)
- [x] Implementasikan utilitas tanggal `Asia/Jakarta` (WIB):
  - [x] `periodBounds(period, cycle)` untuk siklus Gajian (`gajianStartDay`) & siklus CC (`cardCutoffDay`).
  - [x] `ccCycleForDate(date, cutoffDay)` untuk menentukan tagihan CC `YYYY-MM`.
  - [x] Jembatan `ccBilled` vs `ccUnbilled` untuk belanja CC setelah tanggal tutup buku dalam tampilan siklus gajian.
- [x] Implementasikan `ensureMonthlyBankFees(cycleKey)` (auto insert Materai Rp10.000 & Notifikasi Rp12.500 di tanggal 19 pada wallet `CC Jenius`, idempoten).
- [x] Implementasikan `ensurePayrollAutoPaid()` (auto-settle cicilan `kind = "payroll"` yang `dueDate <= today` WIB, idempoten).
- [x] Implementasikan kalkulasi saldo dompet real-time, limit CC terpakai, dan metrik `Safe-to-Spend`.

## 3. Endpoint Dashboard & Ringkasan
- [x] `GET /api/dashboard?cycle=gajian|cc&period=YYYY-MM` (`app/server/src/routes/dashboard.ts`):
  - [x] Trigger `ensureMonthlyBankFees` dan `ensurePayrollAutoPaid`.
  - [x] Kembalikan metrik lengkap: `safeToSpend`, `totalLiquidCash`, `remainingObligations`, `totalIncome`, `totalExpense`, `surplus`, `ccBilled`, `ccUnbilled`, `ccLimitUsed`, `wallets`, `nextDueInstallment`, `budgetAlerts`, `categoryTotals`, `dailyTotals`, dan `transactions`.

## 4. Endpoint Dompet, Transaksi, Transfer & Rekonsiliasi
- [x] `GET /api/wallets`, `POST /api/wallets`, `PATCH /api/wallets/:id` (`app/server/src/routes/wallets.ts`).
- [x] `POST /api/wallets/:id/reconcile`: hitung selisih terhadap saldo sistem saat ini dan buat transaksi `type = "adjustment"`.
- [x] `POST /api/transactions`: buat transaksi `expense` atau `income` (`app/server/src/routes/transactions.ts`).
- [x] `POST /api/transactions/transfer`: buat transaksi `transfer` (`walletId -> toWalletId`) + opsional otomatis `Biaya Bank` jika `adminFee > 0`.
- [x] `PATCH /api/transactions/:id` & `DELETE /api/transactions/:id`: edit dan hapus transaksi dengan proteksi Split Pay & rollback settlement.

## 5. Endpoint Utang, Cicilan, Bayar Tagihan & Split Pay
- [x] `GET /api/debts`, `POST /api/debts`, `PATCH /api/debts/:id/close` (`app/server/src/routes/debts.ts`).
- [x] `POST /api/installments/settle` (**1-Klik Bayar Cicilan / Tagihan CC**) dalam satu transaksi DB.
- [x] `POST /api/installments/:id/unsettle`: batalkan status lunas beserta opsi hapus transaksi settlement terkait.
- [x] `POST /api/transactions/:id/convert-to-installment` (**Konversi Transaksi CC ke Split Pay**).

## 6. Endpoint Kategori, Budgeting, Settings & Export
- [x] `GET /api/categories`, `POST /api/categories`, `PATCH /api/categories/:id` (`app/server/src/routes/categories.ts`).
- [x] `GET /api/budgets?period=YYYY-MM`, `PUT /api/budgets`, `DELETE /api/budgets/:id` (`app/server/src/routes/budgets.ts`).
- [x] `GET /api/settings`, `PATCH /api/settings` (`app/server/src/routes/settings.ts`).
- [x] `GET /api/export?format=json|csv&period=YYYY-MM|all` (`app/server/src/routes/export.ts`).

## 7. Verifikasi Phase 2 & Hygiene Kode
- [x] Komentar kode mematuhi `antislop-code` (singkat 1-2 baris penjelas alasan bisnis).
- [x] Seluruh tes di `app/server/src/api.test.ts` lulus (`5 pass, 0 fail, 47 expect() calls`) dan `bun run typecheck` lulus tanpa error.
