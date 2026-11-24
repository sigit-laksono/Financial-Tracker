# Task List — Milestone 1: Perbaikan Akurasi Cashflow & Siklus Gajian

> **Referensi Desain UI**: `docs/DESIGN.md` (Mars Green `#00797a`/`#19a3a4`, Hermes Orange `#ff8a00`/`#ff9a1f`, `tabular-nums`, target sentuh $\ge$ 44px, Bahasa Indonesia tanpa em dash).

---

### 1. Skema Database & Shared Types
- [x] Tambah enum `WALLET_ROLES = ["spending", "savings", "credit_card"]` di `app/shared/src/types.ts`.
  - *Catatan*: Tipe `WalletRole` diekspor untuk shared schema, backend Drizzle, dan client UI.
- [x] Tambah kolom `role` (text, notNull, default `"spending"`) dan `defaultSalaryWalletId` (di `appSettings`, nullable) pada `app/server/src/db/schema.ts`.
  - *Catatan*: Menggunakan SQLite check constraint and foreign key relation ke `wallets.id`.
- [x] Generate migrasi Drizzle (`bun run db:generate`) dan isi migrasi data agar dompet `credit_card` otomatis memiliki `role = "credit_card"`.
  - *Catatan*: Dihasilkan migrasi `drizzle/0004_new_shooting_star.sql` dengan statement update peran otomatis untuk kartu kredit.
- [x] Perbarui DTO di `app/shared/src/dtos.ts`:
  - `WalletDto`: tambah `role: WalletRole`.
  - `DashboardDto.metrics`: tambah `totalSpendableCash`, `totalSavingsCash`, `ccReservedCash`, `cycleRemaining`, `dailyAllowance`, `daysElapsed`, `daysTotal`, `daysRemaining`, `timeProgressPercent`, `pacingStatus`, `previousCycleComparison` (`currentSpentToDay`, `prevSpentToDay`, `dayN`), `salaryReceivedThisCycle`.

---

### 2. Logika Ledger & Backend API
- [x] Perbarui `computeLedgerSnapshot` di `app/server/src/lib/ledgerSnapshot.ts`:
  - Pisahkan `totalSpendableCash` (`role === "spending"`) dan `totalSavingsCash` (`role === "savings"`).
  - Hitung `unpaidCcDailyTotalAllCycles` untuk seluruh siklus (termasuk unbilled).
- [x] Perbarui `buildDashboardData` di `app/server/src/lib/dashboardQuery.ts`:
  - Hitung `safeToSpend = totalSpendableCash - unpaidInstallmentsSum - unpaidCcDailyTotalAllCycles`.
  - Hitung metrik pacing siklus gajian (`daysElapsed`, `daysTotal`, `dailyAllowance`, `pacingStatus`).
  - Hitung pengeluaran wajib vs variabel serta perbandingan hingga hari ke-N pada siklus sebelumnya (`shiftMonth(selectedPeriod, -1)`).
- [x] Tambah `receiveSalaryForPeriod` dan `getSalaryPreview` di `app/server/src/lib/salaryService.ts`:
  - Hitung total cicilan payroll yang jatuh tempo dan masih upcoming untuk periode gajian tersebut.
  - Jalankan transaksi DB atomik untuk membuat transaksi income (`netSalary`) dan memperbarui status cicilan payroll menjadi `paid`.
  - Cegah pencatatan ganda dengan `sourceRef` unik per periode (`salary-${period}`) yang idempoten.
- [x] Tambah route `POST /api/ledger/receive-salary`, `GET /api/ledger/salary-preview`, dan update `PATCH /api/wallets/:id` agar mendukung update role dompet di `app/server/src/routes/`.

---

### 3. Frontend UI (OverviewPage & SettingsPage)
- [x] Perbarui hero card di `app/client/src/pages/OverviewPage.tsx`:
  - Tampilkan Sisa Jatah Siklus & Safe-to-Spend beserta Jatah Aman Harian (Rp .../hari) dan breakdown kas harian vs tabungan.
  - Tampilkan badge status pacing (Hemat, Sesuai Jalur, Mulai Boros, Melebihi Jalur) dengan kontras warna sesuai `docs/DESIGN.md`.
  - Tampilkan ringkasan Cadangan Tagihan CC dan banner perbandingan belanja siklus ini vs siklus lalu di hari ke-N.
  - Tampilkan tombol aksi Catat Gajian Siklus Ini saat memasuki siklus baru dan transaksi gaji periode berjalan belum tercatat.
- [x] Perbarui strip dompet di `OverviewPage.tsx` dan daftar dompet di `SettingsPage.tsx`:
  - Bedakan dompet Harian vs Tabungan dengan badge ringkas, breakdown total saldo, dan form ganti peran dompet (Harian vs Tabungan).
- [x] Tambah modal/sheet konfirmasi Terima Gaji (`app/client/src/components/ReceiveSalaryModal.tsx`):
  - Input Gaji Kotor, preview potongan utang kantor otomatis per cicilan, dropdown dompet tujuan, dan kalkulasi visual Gaji Bersih.

---

### 4. Pengujian & Verifikasi
- [x] Tambah test integrasi di `app/server/src/__tests__/milestone1.test.ts` untuk:
  - Perhitungan `safeToSpend` saat ada dompet savings dan transaksi CC unbilled.
  - Perhitungan `pacingStatus`, `dailyAllowance`, dan perbandingan hari ke-N.
  - `POST /api/ledger/receive-salary` (idempotensi, potongan payroll otomatis, dan update saldo dompet tujuan).
- [x] Jalankan `bun run typecheck`, `bun run lint`, `bun test`, dan `bun run build` di folder `app/` dan pastikan semua lulus (23 tests pass, 0 lint errors, 0 typecheck errors).
