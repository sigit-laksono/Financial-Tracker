# Task List — Milestone 16: Refaktor Modularitas Komponen, Stabilitas Arsitektur & Kerapian Kode

> **Referensi Spesifikasi:** `docs/16. refaktor-modularitas-komponen/PRD.md` dan `docs/0.draft/code-review.md`.

---

### 1. Dekomposisi & Modularisasi SettingsPage

- [x] Buat direktori sub-komponen `app/client/src/pages/settings/`:
  - [x] `ProfileSecurityTab.tsx`: Konfigurasi ganti PIN, auto-lock timeout, dan status proteksi.
  - [x] `WalletsConfigTab.tsx`: Manajemen saldo awal, limit kartu kredit, dan tambah/hapus dompet.
  - [x] `CycleBudgetTab.tsx`: Tanggal gajian, cut-off kartu kredit, dan template budget bulanan.
  - [x] `CategoriesConfigTab.tsx`: Manajemen nama kategori pengeluaran dan pemasukan.
  - [x] `DataBackupTab.tsx`: Ekspor CSV/JSON, Impor data, dan konfirmasi reset database.
  - [x] `AuditLogsTab.tsx`: Riwayat aktivitas sistem dan mutasi sensitif.
- [x] Refaktor `SettingsPage.tsx` menjadi koordinator tab yang ramping (<300 baris kode).

---

### 2. Isolasi Error Shell di App.tsx & Localized Error Boundaries

- [x] Modifikasi `app/client/src/App.tsx`:
  - [x] Pisahkan pengecekan status error `dashboardQuery` dari layout utama aplikasi.
  - [x] Pastikan navigasi bar dan tab Settings tetap bisa dibuka meskipun dashboard gagal dimuat.
- [x] Bungkus widget visual (`CashflowSparkline.tsx`, `CalendarActivityGrid.tsx`, `Budget503020Progress.tsx`) dengan fallback error yang anggun (*graceful UI degradation*).

---

### 3. Perbaikan Format Angka & Pembulatan Finansial

- [x] Modifikasi `app/client/src/lib/format.ts`:
  - [x] Tambahkan logika pemformatan nominal Miliar (`M`) dan Triliun (`T`) pada `formatCompactRupiah`.
- [x] Tambahkan unit test di `app/client/src/lib/format.test.ts`:
  - [x] Uji format nominal Rp1.500.000.000 $\rightarrow$ `Rp 1,5 M`.
  - [x] Uji format nominal Rp10.000.000.000 $\rightarrow$ `Rp 10 M`.

---

### 4. Optimasi Auth Middleware & Query Cache

- [x] Modifikasi `app/server/src/lib/auth.ts`:
  - [x] Simpan konfigurasi PIN di cache in-memory untuk menghindari `SELECT app_settings` berulang pada setiap HTTP request.
  - [x] Bersihkan cache saat `PATCH /api/settings` atau ganti PIN dieksekusi.
- [x] Perbaiki penghapusan kategori di `app/server/src/routes/categories.ts:183-201`:
  - [x] Cegah hapus kategori jika masih digunakan pada `transactionSplits` atau `recurringRules`.

---

### 5. Pembersihan Linter & Dead Code

- [x] Jalankan linter Biome: `cd app; bun --bun biome lint`
- [x] Bersihkan seluruh dead variables dan parameter tidak terpakai di:
  - [x] `app/client/src/pages/OverviewPage.tsx`
  - [x] `app/client/src/pages/TransactionsPage.tsx`
  - [x] `app/client/src/lib/api.ts` (hapus Content-Type pada GET/DELETE tanpa body).
- [x] Jalankan formatter: `cd app; bun --bun biome format --write .`

---

### 6. Pengujian & Verifikasi Menyeluruh

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors).
- [x] Jalankan linter: `cd app; bun run lint` (0 errors).
- [x] Jalankan automated test suite: `cd app; bun test` (semua lulus).
- [x] Uji navigasi halaman Pengaturan di browser untuk memastikan seluruh tab berfungsi normal setelah pemecahan komponen.
