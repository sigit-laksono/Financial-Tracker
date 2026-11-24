# Task List — Milestone 11: Modul Kekayaan Bersih & Aset (Net Worth & Assets Tracking)

> **Referensi Spesifikasi:** `docs/11. aset-net-worth/PRD.md`.

---

### 1. Skema Database & DTO Aset

- [x] Modifikasi `app/server/src/db/schema.ts`:
  - Buat tabel `assets` (id, name, category, type, valuationAmount, acquisitionCost, notes, createdAt, updatedAt).
- [x] Buat dan terapkan migrasi Drizzle untuk tabel `assets` (`0010_tranquil_assets.sql`).
- [x] Definisikan DTO di `app/shared/src/dtos.ts`:
  - `AssetDto`, `CreateAssetDto`, `UpdateAssetDto`, `NetWorthSummaryDto`.
- [x] Definisikan Zod schema di `app/shared/src/schemas.ts`:
  - `createAssetSchema`, `updateAssetSchema`.

---

### 2. Backend Service Net Worth & Assets

- [x] Buat modul `app/server/src/routes/assets.ts`:
  - `GET /api/assets`: Daftar semua aset terdaftar lengkap dengan kalkulasi unrealized gain/loss.
  - `POST /api/assets`: Simpan aset baru.
  - `PATCH /api/assets/:id`: Update nilai taksiran/valuasi aset (Re-quote).
  - `DELETE /api/assets/:id`: Hapus aset.
  - `GET /api/assets/net-worth-summary`:
    - Jumlahkan saldo seluruh dompet aktif (Kas, Bank, E-Wallet).
    - Jumlahkan seluruh valuasi aset investasi dan aset fisik.
    - Kurangkan total kewajiban (sisa pokok pinjaman + tagihan CC) dari database utang.
    - Hitung rasio utang terhadap aset (*Debt-to-Asset ratio*).
    - Tentukan tahap finansial (*Financial Stage*) secara dinamis.
- [x] Daftarkan router aset di `app/server/src/app.ts`.

---

### 3. Halaman Kekayaan Bersih & Aset (`AssetsPage.tsx`)

- [x] Buat `app/client/src/pages/AssetsPage.tsx`:
  - Hero Card Net Worth: total kekayaan bersih dengan format Rupiah (mendukung `isMasked`).
  - Badge Level Finansial berdasarkan rasio aset terhadap pengeluaran tahunan.
  - Ringkasan 4 pilar: **Kas & Rekening**, **Investasi**, **Aset Fisik**, dan **Kewajiban/Utang**.
  - Daftar aset terkelompok (Investasi & Aset Tetap) dengan aksi cepat *Update Nilai*.
  - Sinkronisasi rincian dompet likuid dan rincian liabilitas utang.
- [x] Buat Modal Tambah Aset & Modal Penyesuaian Valuasi Aset (*Quick Re-quote*).
- [x] Tambahkan tautan menu "Aset & Net Worth" di sidebar navigasi desktop dan mobile category rail.

---

### 4. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors)
- [x] Jalankan linter: `cd app; bun run lint` (0 errors)
- [x] Tulis unit test untuk kalkulasi agregasi Net Worth di `app/server/src/__tests__/assets.test.ts`.
- [x] Jalankan test suite: `cd app; bun test` (39/39 pass, 449 assertions)
- [x] Uji fungsionalitas pencatatan aset dan kalkulasi kekayaan bersih di browser (`http://localhost:5173`).

