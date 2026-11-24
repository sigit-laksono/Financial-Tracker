# Task List — Milestone 3: Pencatatan Harian Cepat, Split Category, Recurring Bills & Atomic Transfer

### 1. Skema Database & Shared Types
- [x] Tambah tabel `transactionSplits` (`id`, `transactionId`, `category`, `categoryId`, `amount`, `note`) di `app/server/src/db/schema.ts`.
- [x] Tambah tabel `recurringRules` (`id`, `merchant`, `amount`, `category`, `categoryId`, `walletId`, `dueDay`, `isActive`, `lastPaidPeriod`, `createdAt`) di `app/server/src/db/schema.ts`.
- [x] Generate migrasi Drizzle (`bun run db:generate` -> `app/drizzle/0006_loose_typhoid_mary.sql`).
- [x] Perbarui `TransactionDto` di `app/shared/src/dtos.ts` untuk menyertakan `splits?: Array<{ category: string; amount: number; note?: string | null }>` dan `linkedFeeTransaction?: { id: number; amount: number } | null`.
- [x] Tambah `RecurringRuleDto` & `QuickPresetsDto` di `app/shared/src/dtos.ts`.

---

### 2. Backend Logic & API Endpoints
- [x] Perbarui `POST /api/transactions` dan `PUT /api/transactions/:id` di `app/server/src/routes/transactions.ts`:
  - Terima array opsional `splits`, validasi total `splits.amount === transaction.amount`, dan simpan secara atomik.
- [x] Perbarui agregasi kategori & budget di `app/server/src/lib/dashboardQuery.ts` dan `app/server/src/routes/budgets.ts` agar membaca `transactionSplits` ketika transaksi memiliki split.
- [x] Perbarui `PUT /api/transactions/:id` dan `DELETE /api/transactions/:id` untuk transaksi bertipe transfer:
  - Jika memiliki `transferGroupId`, edit/hapus ikut memproses baris biaya admin (Biaya Bank) terkait secara atomik.
- [x] Tambah CRUD & aksi bayar `recurringRules` (`/api/recurring` dan `POST /api/recurring/:id/pay`) untuk menandai tagihan rutin terbayar di siklus aktif sekaligus membuat transaksi expense.
- [x] Tambah `GET /api/transactions/quick-presets` yang mengembalikan merchant tersering, mapping merchant $\rightarrow$ kategori/wallet terakhir, dan rute transfer favorit.

---

### 3. Frontend UI (QuickAddSheet, TransactionsPage, OverviewPage)
- [x] Perbarui `app/client/src/components/QuickAddSheet.tsx`:
  - Tambah bar Template Cepat (4–6 chip dari transaksi/transfer tersering).
  - Tambah Auto-suggest Kategori & Wallet saat mengetik nama merchant.
  - Tambah chip Rute Transfer Cepat (misal BNI $\rightarrow$ GoPay, BNI $\rightarrow$ BCA, BNI $\rightarrow$ Jenius) + preset biaya admin (Gratis, Rp2.500, Custom).
  - Tambah toggle "Pecah Kategori (Split Struk)" untuk input > 1 kategori dengan validasi sisa nominal real-time.
  - Tambah tombol preset nominal cepat (+10rb, +25rb, +50rb, +100rb).
- [x] Perbarui `app/client/src/pages/TransactionsPage.tsx`:
  - Tampilkan transaksi transfer + biaya admin (`transferGroupId`) sebagai satu kartu gabungan dengan rincian biaya admin di subteks.
  - Tampilkan badge rincian kategori pada transaksi yang memiliki splits.
  - Dukung edit transaksi bertipe transfer langsung dari daftar transaksi.
- [x] Tambah panel Tagihan Rutin Siklus Ini di `OverviewPage.tsx` (dengan tombol 1-klik Catat Bayar) dan halaman kelola tagihan rutin di `SettingsPage.tsx`.
- [x] Tambah tombol Cocokkan Saldo di kartu strip dompet pada `OverviewPage.tsx` untuk membuka `ReconcileModal` secara langsung.

---

### 4. Pengujian & Verifikasi
- [x] Tambah test integrasi di `app/server/src/__tests__/milestone3.test.ts`:
  - Validasi dan agregasi budget untuk transaksi dengan `transactionSplits`.
  - Edit & delete atomik untuk transfer dengan `adminFee` (`transferGroupId`).
  - Eksekusi `POST /api/recurring/:id/pay` agar idempoten dalam periode yang sama.
  - Verifikasi endpoint `GET /api/transactions/quick-presets`.
- [x] Uji responsivitas mobile (360px) dan kontras mode Terang & Gelap sesuai `docs/DESIGN.md`.
- [x] Jalankan `bun run typecheck`, `bun run lint`, dan `bun test` di folder `app/` (32 passing, zero errors).
