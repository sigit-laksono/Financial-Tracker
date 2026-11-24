# Task List Phase 5: Modularisasi Arsitektur, UX Parity & Aksesibilitas

**Referensi:** [PRD.md](../PRD.md) | [DESIGN.md](../DESIGN.md) | [software-architect.md](../improve-analiysis/software-architect.md) | [senior-developer.md](../improve-analiysis/senior-developer.md)  
**Prasyarat:** Phase 4 selesai.  
**Status:** Selesai & Terverifikasi (`22 Nov 2026`)  
**Target Milestone:** Memecah God Module backend dan menyatukan shared contract di `app/shared/`, menutup seluruh gap UI/UX & aksesibilitas WCAG 2.1 AA, optimasi bundle frontend, serta menuntaskan QA visual Chrome lintas breakpoint.

---

## 1. Dekomposisi Modular Backend & Shared Contract
- [x] Jadikan `app/shared/src/` sebagai Single Source of Truth:
  - [x] Pindahkan definisi Zod request/response schemas (`app/shared/src/schemas.ts`) dan DTO types (`app/shared/src/dtos.ts`: `DashboardDto`, `DebtsDto`, `WalletDto`, `TransactionDto`, `BudgetItemDto`, `SettingsDto`, dll.) ke `app/shared/src/` agar client (`app/client/src/lib/api.ts`) dan server memakai kontrak yang sama.
  - [x] Pindahkan helper tanggal/siklus murni (`app/shared/src/dates.ts`: `jakartaToday`, `shiftMonth`, `ccCycleForDate`, `periodBounds`, `periodForDate`, `isValidIsoDate`, `isValidYearMonth`) ke `app/shared/src/` dan hapus duplikasi di `server/src/lib/dates.ts`, `client/src/lib/format.ts`, dan `server/src/db/migrate-legacy.ts`.
- [x] Dekomposisi `app/server/src/lib/ledger.ts` menjadi modul domain terfokus:
  - [x] Pisahkan ke `cashLedger.ts` (transfer, rekonsiliasi), `ccBilling.ts` (bank fees), `debtEngine.ts` (utang, cicilan, Split Pay, settle/unsettle), `budgetService.ts`, `settingsService.ts`, `ledgerSnapshot.ts`, dan `dashboardQuery.ts` (dengan `ledger.ts` sebagai barrel export).
  - [x] Satukan implementasi `resolveBudgetsForPeriod` antara `budgetService.ts` dan `app/server/src/routes/budgets.ts` agar field dan perhitungannya seragam.
- [x] Terapkan pemisahan Command-Query (CQS) pada endpoint `GET`:
  - [x] Hentikan mutasi DB (`ensureMonthlyBankFees`, `ensurePayrollAutoPaid`) di dalam handler `GET` (`/api/dashboard`, `/api/debts`, `/api/wallets`, `/api/budgets`, `/api/export`).
  - [x] Pindahkan eksekusi auto-fees dan auto-payroll ke mekanisme daily sync idempoten (`runDailyLedgerSync` berbasis `lastAutoSyncDate` di `app_settings` / `0002_tan_lila_cheney.sql` pada startup, login/setup, serta endpoint eksplisit `POST /api/ledger/sync`).

## 2. Penutupan Gap Fitur UI & Sinkronisasi State Frontend
- [x] Lengkapi fitur manajemen data di `app/client/src/pages/SettingsPage.tsx`:
  - [x] Tambahkan aksi **Edit Dompet** (`PATCH /api/wallets/:id` untuk ubah nama, saldo awal/limit, atau aktif/nonaktif dompet).
  - [x] Tambahkan aksi **Edit & Arsipkan/Pulihkan Kategori** (`PATCH /api/categories/:id`).
  - [x] Gunakan endpoint `GET /api/budgets` (`api.getBudgets`) untuk mengelola template budget `"default"` (`templateId`) agar penghapusan template tidak keliru menghapus override periode aktif.
  - [x] Tambahkan pemilih periode pada fitur Export Backup CSV/JSON (`period=YYYY-MM` atau `all`).
- [x] Sempurnakan halaman transaksi & budget (`app/client/src/pages/TransactionsPage.tsx`):
  - [x] Tambahkan navigator periode (`<` Periode `>`) langsung di tab Transaksi.
  - [x] Simpan state filter transaksi (`app/client/src/lib/filters.ts`) di `App.tsx` agar tidak ter-reset saat berpindah tab.
  - [x] Tambahkan dukungan **Budget Override per Periode (`YYYY-MM`)** di samping template default (beserta aksi hapus override).
  - [x] Sediakan aksi **Hapus** (dengan konfirmasi 2 langkah) untuk transaksi bertipe `transfer`, `settlement`, dan `adjustment`.
  - [x] Sinkronkan dropdown filter kategori agar memuat seluruh kategori (`income`, `expense`, dan non-expense); ganti hardcode `endsWith("-25")` / label `"tgl 25"` mengikuti `data.settings.gajianStartDay` dinamis; perjelas label tanggal di tooltip chart Recharts (`formatShortDate`).
- [x] Perbaiki UX form, modal & error handling di `app/client/src/`:
  - [x] Tambahkan pesan validasi inline & handler `onError` di seluruh form/mutasi (`SettingsPage`, `TransactionsPage`, `AddDebtModal`, `ReconcileModal`); izinkan input nominal rekonsiliasi bernilai negatif (`parseSignedInt` / `formatSignedDigitsInput`) untuk kasus overdraft; reset state `AddDebtModal` saat modal dibuka ulang.
  - [x] Perbaiki `QuickAddSheet.tsx`: pertahankan kategori terarsip saat mode edit transaksi lama dan lengkapi dependency array `useEffect`.
  - [x] Perbaiki `showToast` di `app/client/src/App.tsx` menggunakan `useRef` timer cleanup agar toast berurutan tidak saling memotong.

## 3. Aksesibilitas (WCAG 2.1 AA) & Performa Bundle
- [x] Perbaiki aksesibilitas komponen (`app/client/src/components/` & `pages/`):
  - [x] Tambahkan keyboard focus trap (`Tab` / `Shift+Tab`) dan backdrop button di `ModalSheet` (`app/client/src/components/UI.tsx`) serta stabilkan `onClose` via `useRef` untuk menghilangkan focus jump saat parent re-render.
  - [x] Naikkan tap target seluruh tombol inline (`Kelola CC`, `Lihat Semua`, `Ubah Limit`, `Atur Batas Budget`) ke `>= 44px` (`min-h-[44px]`).
  - [x] Lengkapi navigasi keyboard `ArrowLeft`/`ArrowRight` dan relasi `aria-controls` / `role="tabpanel"` pada `role="tablist"` di `QuickAddSheet.tsx`.
  - [x] Perbaiki kontras hover tombol hero `"Sesuaikan Saldo Awal"` dengan variant `heroOutline` di `OverviewPage.tsx` dan rapikan hierarki tag `<h1>` halaman (`Ringkasan Keuangan`).
- [x] Optimasi rendering & isolasi error frontend:
  - [x] Implementasikan `React.lazy` + `Suspense` pada tab `TransactionsPage` (`412.15 kB` terpisah dari main chunk `323.31 kB`), `DebtsPage` (`11.09 kB`), dan `SettingsPage` (`24.59 kB`).
  - [x] Tambahkan React `ErrorBoundary` pada `app/client/src/main.tsx` dan isolasi error/loading state `debtsQuery` agar kegagalan tab Utang tidak memblokir tab Ringkasan/Transaksi.

## 4. Verifikasi Phase 5 (Tooling, Unit Test Client & Chrome Visual QA Gate)
- [x] Pasang **Biome** (`@biomejs/biome` + `biome.json` + scripts `lint` & `format` di `app/package.json`), rapikan kapitalisasi seed kategori (`"Keluarga"`, `"Hutang"` di `seed.ts`), dan tambahkan unit test helper client/shared (`app/client/src/lib/format.test.ts`).
- [x] Jalankan uji visual & interaksi klik-per-elemen via `browser` sub-agent pada `http://localhost:3105` di viewport `360px`, `768px`, dan `1280px` (Light Mode & Dark Mode): 0 console/network error, 0 horizontal overflow, filter persisten, keyboard tab/focus-trap lulus; 2 temuan visual minor (`select` vertical alignment & kepadatan form template budget) langsung diperbaiki di `theme.css` dan `SettingsPage.tsx`.
- [x] Verifikasi `bun run typecheck`, `bun run lint` (`0` errors, `0` warnings across 52 files), `bun test` (`14 pass, 0 fail, 119 expect() calls`), `bun run build`, dan `bun run db:audit` (`AUDIT PASSED`, 216 transaksi terverifikasi bebas duplikasi) seluruhnya lulus.
