# Task List — Milestone 2: Hutang & Piutang, Upgrade Pinjaman, Multi-CC & Timeline Siklus

### 1. Skema Database & Shared Types
- [x] Tambah `DEBT_DIRECTIONS = ["payable", "receivable"]` dan perluas `DEBT_KINDS` (`"loan"` | `"card_installment"` | `"payroll"` | `"receivable"`) di `app/shared/src/types.ts`.
- [x] Tambah `TRANSACTION_TYPES` bila diperlukan untuk `debt_disbursement` / `debt_collection` (atau gunakan metadata relasi di `transactions` + `debtAccounts`) di `app/shared/src/types.ts` dan `app/server/src/db/schema.ts`.
- [x] Perbarui `debtAccounts` di `app/server/src/db/schema.ts`:
  - Tambah `direction`, `disburseWalletId`, `disbursedAt`, `interestRateBps` (opsional).
- [x] Perbarui `installments` di `app/server/src/db/schema.ts`:
  - Tambah `principalAmount` dan `interestAmount` (nullable, fallback ke `plannedAmount`).
- [x] Tambah kolom/tabel konfigurasi biaya rutin per dompet CC (menggantikan hardcode `BANK_FEES` di `app/server/src/lib/ccBilling.ts`).
- [x] Generate migrasi Drizzle (`bun run db:generate`) dan pastikan data utang eksisting otomatis terisi `direction = "payable"`.

---

### 2. Backend Engine (Piutang, Early Payoff, Multi-CC, Timeline)
- [x] Tambah logika Piutang di `app/server/src/lib/debtEngine.ts`:
  - Buat akun piutang + opsi langsung potong saldo dompet sumber (disbursement) tanpa masuk `totalExpense`.
  - Proses penerimaan pelunasan/cicilan piutang ke dompet tujuan tanpa masuk `totalIncome`.
- [x] Tambah opsi Pencairan Pinjaman (`loan`) ke dompet tujuan tanpa dihitung sebagai income.
- [x] Tambah `earlyPayoffDebtAccount` di `app/server/src/lib/debtEngine.ts` + endpoint `POST /api/debts/:id/payoff`.
- [x] Refaktor `ledgerSnapshot.ts`, `dashboardQuery.ts`, `ccBilling.ts`, dan `debtEngine.ts` agar melakukan loop per seluruh dompet `credit_card` aktif (Multi-CC safe) dan memisahkan ringkasan per CC di `DebtsDto`.
- [x] Tambah generator `cycleTimeline` di `dashboardQuery.ts` berdasarkan tanggal tutup buku CC, cetak tagihan, jatuh tempo pinjaman, dan tanggal gajian.

---

### 3. Frontend UI (DebtsPage, AddDebtModal, OverviewPage)
- [x] Perbarui `AddDebtModal.tsx`:
  - Tambah pilihan Utang (Saya Pinjam) vs Piutang (Orang Pinjam / Talangan).
  - Tambah toggle opsional "Catat perpindahan dana ke/dari dompet sekarang" (untuk pencairan Flexi Cash atau pemberian pinjaman piutang).
  - Tambah input opsional Pokok vs Bunga atau kalkulasi cicilan otomatis.
- [x] Perbarui `DebtsPage.tsx`:
  - Tambah switcher/tab Utang & CC vs Piutang beserta ringkasan Total Utang, Total Piutang, dan Posisi Bersih.
  - Dukung selector multi-CC apabila terdapat > 1 kartu kredit aktif.
  - Tambah tombol Lunasi Sekaligus (Early Payoff) pada detail akun utang/piutang.
  - Tambah pengaturan biaya otomatis per CC di `SettingsPage.tsx`.
- [x] Tambah komponen `CycleTimeline` di `OverviewPage.tsx` dan `DebtsPage.tsx` sesuai desain strip tanggal pada prototype awal dan standar `docs/DESIGN.md`.

---

### 4. Pengujian & Verifikasi
- [x] Tambah unit & integration test di `app/server/src/__tests__/`:
  - Pencatatan piutang & penagihan balik tidak mengotori `totalExpense` / `totalIncome`.
  - Pencairan `loan` menambah saldo wallet dan utang secara konsisten.
  - Early payoff menutup sisa cicilan dengan benar.
  - Multi-CC calculation & timeline node ordering untuk bulan pendek (Februari) maupun akhir tahun (Desember $\rightarrow$ Januari).
- [x] Jalankan `bun run typecheck`, `bun run lint`, dan `bun test` di folder `app/`.
