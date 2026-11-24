# PRD — Milestone 16: Refaktor Modularitas Komponen, Stabilitas Arsitektur & Kerapian Kode

## 1. Latar Belakang & Masalah

Seiring bertambahnya fitur dari Milestone 1 sampai 12, beberapa bagian codebase mengalami pembengkakan teknis (*code bloat* & *architectural debt*) yang diidentifikasi pada `docs/0.draft/code-review.md`:

1. **Komponen Raksasa Monolitik (`SettingsPage.tsx` 1.856 Baris - CR-13):**
   Halaman pengaturan menggabungkan terlalu banyak tanggung jawab dalam satu file besar: konfigurasi PIN keamanan, manajemen dompet, preferensi siklus, kategori, template budget, ekspor/impor data, reset database, dan riwayat audit log. Ini menyulitkan navigasi kode, meningkatkan risiko regresi saat refaktor, dan memperlambat waktu build/HMR.
2. **Kopling Monolitik Error pada `App.tsx` (CR-08 - P1):**
   Di `App.tsx:341-365`, jika kueri `dashboardQuery` mengalami error jaringan atau validasi, seluruh aplikasi langsung me-render tampilan error total (*blanket error state*). Pengguna tidak dapat membuka tab lain seperti *Settings* untuk memperbaiki konfigurasi atau *Export Data* untuk backup.
3. **Penyimpangan Format Angka Finansial Besar (CR-14):**
   Fungsi `formatCompactRupiah` memformat nominal di atas Rp 1 Miliar menjadi `Rp 2500 jt`, alih-alih `Rp 2,5 M`, yang janggal dibaca pengguna.
4. **Penyisihan Error Boundary Lokal untuk Visual Widgets (CR-11):**
   Jika widget visual (seperti grafik `CashflowSparkline` atau `CalendarActivityGrid`) mengalami error kalkulasi data kosong, seluruh halaman berisiko crash karena tidak dibungkus dalam *Localized Error Boundary*.
5. **Kerapian Linting & Dead Code (CR-10):**
   Terdapat sisa variabel yang tidak terpakai (*unused variables*) dan warning pada pemeriksaan linter Biome.
6. **Query Overhead Berulang pada Middleware Auth (CR-12):**
   Pengecekan sesi PIN mengeksekusi `SELECT * FROM app_settings` pada setiap request API tanpa in-memory caching untuk setting statis.

---

## 2. Tujuan Milestone

1. **Dekomposisi Bersih `SettingsPage.tsx`**:
   Memecah halaman pengaturan menjadi sub-komponen modular terfokus dengan batas tanggung jawab tunggal (*Single Responsibility Principle*).
2. **Resilience & Isolasi Error Frontend**:
   Memastikan kegagalan pada satu kueri dashboard tidak mematikan seluruh aplikasi. Tab Pengaturan dan Bantuan tetap dapat diakses untuk mitigasi.
3. **Penyempurnaan Formatting Angka Finansial**:
   Format Rupiah kompak mendukung rentang triliun (T), miliar (M), dan juta (jt) dengan presisi rapi.
4. **Kebersihan Linter & Standar Kode Biome 100%**:
   Menghilangkan seluruh dead code, unused parameters, dan error linter pada codebase.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Modularisasi `app/client/src/pages/Settings/`
Pecah `SettingsPage.tsx` menjadi direktori terstruktur:
- `app/client/src/pages/settings/SettingsPage.tsx` (Koordinator Tab)
- `components/ProfileSecurityTab.tsx` (PIN, sesi, auto-lock timeout)
- `components/WalletsConfigTab.tsx` (Daftar & konfigurasi dompet/kartu kredit)
- `components/CycleBudgetTab.tsx` (Tanggal gajian, cut-off, template 50/30/20)
- `components/CategoriesConfigTab.tsx` (Pengaturan kategori dan ikon)
- `components/DataBackupTab.tsx` (Export CSV/JSON, Import, Reset Data)
- `components/AuditLogsTab.tsx` (Riwayat mutasi & log perubahan data)

### B. Isolasi Error & Resilient Shell di `App.tsx`
- Refaktor `App.tsx`:
  - Bungkus rendering halaman dalam `ErrorBoundary` lokal per-tab.
  - Jangan memblokir rendering navigation bar saat `dashboardQuery` sedang error.
  - Berikan banner peringatan dengan tombol *Coba Lagi* di area konten tanpa menutup menu pengaturan.

### C. Formatting & Library Helper
- Modifikasi `app/client/src/lib/format.ts`:
  - Dukung nominal $\ge \text{Rp } 1.000.000.000 \rightarrow \text{Rp } 1,0 \text{ M}$.
  - Dukung nominal $\ge \text{Rp } 1.000.000.000.000 \rightarrow \text{Rp } 1,0 \text{ T}$.

### D. Optimasi Auth Middleware & Database Cache
- Di `app/server/src/lib/auth.ts`:
  - Terapkan cache in-memory sederhana dengan TTL pendek (atau invalidasi saat setting berubah) untuk pembacaan konfigurasi PIN.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [x] `SettingsPage.tsx` terpecah menjadi sub-komponen dengan ukuran masing-masing di bawah 400 baris kode.
- [x] Kegagalan kueri dashboard tidak mengunci tab Pengaturan dan Transaksi.
- [x] Nominal Rp2.500.000.000 terformat dengan benar sebagai `Rp 2,5 M`.
- [x] Pemeriksaan `bun --bun biome lint` menghasilkan 0 error dan 0 warning.
- [x] Seluruh widget visual (Sparkline, Calendar Grid) terlindungi oleh Error Boundary lokal.
- [x] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus tanpa regresi.
