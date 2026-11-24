# Task List Phase 3: Frontend Mobile-First PWA & Design System (`dens-ui` + `antislop`)

**Referensi:** [PRD.md](./PRD.md) | [DESIGN.md](./DESIGN.md)  
**Prasyarat:** Phase 2 selesai.  
**Status:** Selesai & Terverifikasi (`22 Nov 2026`; uji visual Chrome selesai pada QA Phase 5).  
**Target:** UI/UX lengkap yang cepat dipakai dengan satu tangan di HP, mendukung Light & Dark mode sesuai token terverifikasi di `DESIGN.md`, bebas pola AI slop, dan lolos pemeriksaan aksesibilitas & mobile layout.

---

## 1. Design System, Aksesibilitas Dasar & App Shell (`dens-ui`)
- [x] Setup font `Figtree` & `JetBrains Mono` dengan utility `tabular-nums` khusus nominal Rupiah dan tanggal (`app/client/index.html`, `app/client/src/styles/theme.css`).
- [x] Setup `<html lang="id">`, `<title>` unik, viewport tanpa `user-scalable=no`, dan struktur landmark (`header`, `nav`, `main`, satu `<h1>` per tampilan).
- [x] Implementasikan CSS variables Light Mode & Dark Mode di `app/client/src/styles/theme.css` sesuai token terverifikasi di [DESIGN.md](./DESIGN.md) (termasuk `--control-border` >= 3.0:1).
- [x] Atur base layer CSS untuk interaksi & aksesibilitas (R-32, R-39):
  - [x] `cursor: pointer` untuk seluruh kontrol interaktif aktif dan `cursor: not-allowed` untuk kontrol `disabled`.
  - [x] Focus indicator `:focus-visible` kontras tinggi di Light & Dark mode.
  - [x] Bungkus motion non-esensial dengan `@media (prefers-reduced-motion: reduce)`.
- [x] Buat komponen SVG icon custom (`app/client/src/components/Icons.tsx`) dan komponen dasar (`app/client/src/components/UI.tsx`: `Card`, `Badge`, `Button`, `ModalSheet` dengan `Escape` & restore focus, `ProgressBar`, `StateView`, `Toast`).
- [x] Implementasikan theme toggle (`Terang`, `Gelap`, `Sistem`) yang aktif di Light & Dark Mode.
- [x] Bangun **App Shell** (`app/client/src/App.tsx`):
  - [x] Mobile: Bottom Nav 4 tab (*Ringkasan*, *Transaksi*, *Kartu*, *Atur*) + tombol FAB `+` di tengah dengan `safe-bottom-pad`.
  - [x] Tablet & Desktop: Left Icon Rail dengan tombol collapse `aria-expanded` dan layout grid responsif.

## 2. Layar Keamanan (Lock Screen & Setup PIN)
- [x] Buat layar **PIN / Password Lock** (`app/client/src/components/LockScreen.tsx`).
- [x] Buat banner opsional **Atur PIN** saat `pinHash` belum diset (`app/client/src/App.tsx`).

## 3. Tab 1: Ringkasan (Command Center) (`app/client/src/pages/OverviewPage.tsx`)
- [x] Switcher **Siklus Gajian (25-24)** vs **Siklus CC (20-19)** dan navigator periode (`<` Periode `>`).
- [x] **Hero Card "Safe-to-Spend"** beserta breakdown `Kas Likuid` dan `Kewajiban Periode Ini`.
- [x] **Kartu Tagihan Terdekat** dengan tombol cepat **Bayar Tagihan**.
- [x] **Strip Dompet** horizontal scroll terkontrol + ringkasan limit **CC Jenius** & *Unbilled*.
- [x] **Budget Alerts** dengan badge status teks dan persentase.

## 4. Tab 2: Transaksi & Budget (`app/client/src/pages/TransactionsPage.tsx`)
- [x] **Filter Bar:** Pill minggu (`Semua`, `Minggu 1..5`), filter Dompet, Tipe, Kategori, Search input, dan toggle `Sembunyikan Gajian (tgl 25)`.
- [x] **Grafik Harian (Recharts)** dengan judul pertanyaan & **Breakdown Kategori + Progress Budget** (beserta inline ubah limit).
- [x] **Daftar Transaksi** per tanggal lengkap dengan badge status & tombol Edit / Split Pay.
- [x] **State Lengkap (R-27):** Loading, First-Run Empty, Filtered Empty (dengan tombol **Reset Filter**), dan Error (dengan tombol **Coba Lagi**).

## 5. Tab 3: Kartu Kredit & Utang (`app/client/src/pages/DebtsPage.tsx`)
- [x] **Panel CC Jenius:** Gauge limit vs Rp20.000.000, pilih siklus tagihan, tombol **Bayar Tagihan CC**, dan daftar transaksi CC beserta tombol **Split Pay**.
- [x] **Portofolio Utang & Jadwal Pembayaran:** Progress total pelunasan, daftar akun aktif + **Tambah Utang** + **Tutup Akun** + collapsible **Akun Ditutup**, serta jadwal cicilan per bulan (`Auto Potong Gaji` vs `Bayar` / `Batal Lunas`).

## 6. Tab 4: Pengaturan & Manajemen Data (`app/client/src/pages/SettingsPage.tsx`)
- [x] **Dompet & Rekonsiliasi:** Daftar dompet, tambah dompet baru, dan modal **Sesuaikan Saldo** (`app/client/src/components/ReconcileModal.tsx`).
- [x] **Kategori & Template Budget:** Tambah kategori baru & atur template budget bulanan.
- [x] **Aturan Gaji & Siklus:** Form edit gaji kotor/bersih, potongan, tanggal siklus, dan limit CC.
- [x] **Tema, Keamanan & Backup:** Switch tema, buat/ubah/nonaktifkan PIN, kunci sesi, dan unduh backup CSV/JSON.

## 7. Quick-Add Bottom Sheet (`+` FAB) & Modals Interaktif
- [x] **Quick-Add Sheet** (`app/client/src/components/QuickAddSheet.tsx`) dengan 4 tab (*Keluar*, *Masuk*, *Transfer* + biaya admin opsional, *Bayar*) serta mode Edit/Hapus.
- [x] Modal **Ubah ke Cicilan (Split Pay)** (`app/client/src/components/SplitPayModal.tsx`).
- [x] Modal **Tambah Akun Utang Baru** (`app/client/src/components/AddDebtModal.tsx`).

## 8. Verifikasi Phase 3 (Antislop & Responsiveness Check)
- [x] Audit kode & perbaikan tap target: seluruh tombol/kontrol interaktif dinaikkan ke minimal `44px` (`min-h-[44px]` / `h-11 w-11`).
- [x] Audit copywriting UI: nol em dash (`—`) di `app/client/src` & `app/server/src`, nol emoji dekoratif, nol data dummy.
- [x] `bun run typecheck`, `bun run build`, dan `bun test` (`5 pass, 0 fail`).
- [x] Uji visual & klik-per-elemen langsung di Google Chrome (`360px`, `768px`, `1280px`, Light & Dark mode) — diverifikasi melalui `browser` sub-agent pada QA Phase 5 (`0` console/network error, `0` horizontal overflow).
