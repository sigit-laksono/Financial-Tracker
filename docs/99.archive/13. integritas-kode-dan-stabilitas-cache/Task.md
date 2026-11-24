# Task List — Milestone 13: Integritas Kode, Transaksi Atomik & Stabilitas Cache

> **Referensi Spesifikasi:** `docs/13. integritas-kode-dan-stabilitas-cache/PRD.md` dan `docs/0.draft/code-review.md`.

---

### 1. Transaksi Atomik & Perbaikan Backend Kritis (P0)

- [x] Perbaiki alur penerimaan gaji di `app/server/src/lib/salaryService.ts`:
  - [x] Bungkus seluruh operasi insert transaksi dan update status cicilan dalam `db.transaction(async (tx) => ...)`.
  - [x] Tambahkan pencatatan ke `settlementAllocations` untuk setiap cicilan payroll yang terpotong.
- [x] Buat unit test regresi di `app/server/src/__tests__/salaryService.test.ts` untuk menguji rollback atomik saat terjadi error di tengah loop cicilan.

---

### 2. Penyelarasan Query Key & Cache Synchronization (P0)

- [x] Buat modul konstanta query key terpadu di `app/client/src/lib/queryKeys.ts`:
  - [x] Definisikan `budgetKeys`, `dashboardKeys`, `transactionKeys`, `walletKeys`, `debtKeys`, dan `assetKeys`.
- [x] Perbarui `app/client/src/pages/BudgetPage.tsx`:
  - [x] Gunakan query key konsisten `budgetKeys.summary(period)` dan `budgetKeys.all`.
- [x] Perbarui `app/client/src/components/QuickAddSheet.tsx`:
  - [x] Tambahkan invalidasi `["budget-summary"]` selain `["budgets"]` pada mutasi transaksi pengeluaran.
- [x] Perbarui `app/client/src/pages/TransactionsPage.tsx`:
  - [x] Pastikan aksi edit dan delete transaksi meng-invalidate `["budget-summary"]`.

---

### 3. Perbaikan Multi-Kartu Kredit & Alur Piutang (P1)

- [x] Perbaiki konfigurasi kartu kredit di `app/server/src/routes/settings.ts`:
  - [x] Hapus klausul `UPDATE wallets SET ... WHERE type = 'credit_card'` yang menimpa seluruh kartu tanpa ID.
  - [x] Pastikan perubahan limit dan cutoff kartu kredit diarahkan ke `PATCH /api/wallets/:id`.
- [x] Perbaiki query unbilled transaksi di `app/server/src/routes/transactions.ts`:
  - [x] Filter unbilled berdasarkan masing-masing `walletId` dompet kartu kredit.
- [x] Perbaiki penghapusan transaksi penerimaan piutang di `app/server/src/routes/transactions.ts:803-813`:
  - [x] Kembalikan status cicilan piutang menjadi `pending` jika transaksi pelunasannya dihapus.
- [x] Perbaiki parameter `recordAuditLog` di `app/server/src/routes/debts.ts:171`:
  - [x] Ganti instance `db` dengan `tx` agar tidak mengganggu transaksi SQLite yang sedang aktif.

---

### 4. Optimasi Performa & Setoran Goal Tabungan (P1)

- [x] Optimasi `computeWalletBalance` di `app/server/src/lib/cashLedger.ts`:
  - [x] Ganti in-memory filtering dengan native SQL aggregate `SELECT SUM(...) WHERE wallet_id = ?`.
- [x] Perbaiki `POST /api/goals/:id/contribute` di `app/server/src/routes/goals.ts`:
  - [x] Tambahkan transaksi masuk (*transfer in*) ke dompet tabungan tujuan goal jika didefinisikan.

---

### 5. Pengujian & Verifikasi Kualitas

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors).
- [x] Jalankan linter: `cd app; bun run lint` (0 errors).
- [x] Jalankan automated test suite: `cd app; bun test` (pastikan seluruh tes lulus).
- [x] Uji manual di browser: buat transaksi baru dan verifikasi halaman Budget langsung terupdate seketika tanpa reload.
