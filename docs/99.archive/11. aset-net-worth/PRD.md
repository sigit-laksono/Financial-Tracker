# PRD — Milestone 11: Modul Kekayaan Bersih & Aset (Net Worth & Assets Tracking)

## 1. Latar Belakang & Masalah

Kesehatan keuangan jangka panjang seseorang tidak hanya dinilai dari arus kas bulanan (*cashflow*), melainkan dari akumulasi kekayaan bersihnya (*Net Worth*):

1. **Aplikasi Saat Ini Baru Mencatat Saldo Operasional Harian:**
   Uang yang ada di rekening kas harian hanyalah sebagian kecil dari total aset pengguna. Portofolio investasi (reksadana, saham, emas, kripto) dan aset fisik bernilai tinggi (laptop kerja, motor/mobil, tanah/properti) belum tercatat.
2. **Ketiadaan Visibilitas Kekayaan Bersih Riil (*Net Worth*):**
   Pengguna belum bisa melihat potret menyeluruh:
   $$\text{Kekayaan Bersih} = (\text{Total Saldo Dompet Likuid} + \text{Nilai Aset Investasi} + \text{Nilai Aset Tetap}) - \text{Total Sisa Pokok Utang}$$
   Ketika pengguna membayar cicilan utang, kekayaan bersihnya sebenarnya bertambah karena liabilitas berkurang. Tanpa modul Net Worth, hal ini tidak terlihat.
3. **Motivasi Finansial & Gamifikasi Tahapan Finansial:**
   Di aplikasi Budggt, pengguna termotivasi melihat level finansial mereka meningkat (misal: *Financial Security*, *Financial Stability*, *Financial Independence*). Menyajikan indikator level ini memberikan dorongan psikologis positif untuk terus menabung dan berinvestasi.

---

## 2. Tujuan Milestone

1. **Pencatatan & Pengelompokan Aset Komprehensif:**
   - **Aset Likuid**: Saldo otomatis dari seluruh dompet operasional (Bank, Kas Tunai, E-Wallet).
   - **Aset Investasi**: Saham (IDX/US), Reksadana (Bibit/Bareksa), Emas Logam Mulia, Kripto, Obligasi/SBN.
   - **Aset Tetap (Fixed Assets)**: Kendaraan, Gadget/Elektronik Produktif, Properti.
2. **Kalkulasi Otomatis Kekayaan Bersih (Net Worth Calculation Engine):**
   - Agregasi real-time dari seluruh aset dikurangi total sisa pokok pinjaman dan limit kartu kredit terpakai dari modul Utang.
   - Riwayat tren perkembangan kekayaan bersih dari bulan ke bulan.
3. **Halaman Khusus Aset & Kekayaan Bersih (`AssetsPage.tsx`):**
   - Hero card total Kekayaan Bersih (dengan dukungan Privacy Mask `Rp •••••••`).
   - Rasio Aset Bersih terhadap Liabilitas (*Debt-to-Asset Ratio*).
   - Indikator Level Finansial (Tahap Keuangan Pengguna).
   - Daftar aset per kategori lengkap dengan aksi pembaruan taksiran nilai (*Valuation Re-quote*).

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Skema Database & Model (`schema.ts`)
- **Tabel Baru `assets`**:
  ```typescript
  export const assets = sqliteTable("assets", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category", { enum: ["investment", "fixed"] }).notNull(),
    type: text("type").notNull(), // "gold", "stocks", "mutual_fund", "crypto", "property", "vehicle", "electronics", "other"
    valuationAmount: integer("valuation_amount").notNull(),
    acquisitionCost: integer("acquisition_cost"), // modal beli awal untuk hitung untung/rugi
    notes: text("notes"),
    updatedAt: text("updated_at").notNull(),
    createdAt: text("created_at").notNull(),
  });
  ```
- Tambahkan migrasi Drizzle untuk tabel `assets`.

### B. Shared DTOs & API Endpoint
- DTOs: `AssetDto`, `CreateAssetDto`, `UpdateAssetDto`, `NetWorthSummaryDto`.
- Endpoints:
  - `GET /api/assets`: Ambil seluruh aset terdaftar.
  - `POST /api/assets`: Tambah aset baru.
  - `PATCH /api/assets/:id`: Perbarui taksiran nilai aset.
  - `DELETE /api/assets/:id`: Hapus aset.
  - `GET /api/assets/net-worth-summary`: Kalkulasi komprehensif total kekayaan bersih, perbandingan aset likuid vs investasi vs fisik vs total utang.

### C. Komponen UI Frontend
- **`AssetsPage.tsx`**:
  - Hero Card Net Worth dengan aksen Neon Lime `#ccff00` dan background hitam `#121514`.
  - Level Finansial Badge (*Taraf Finansial: Aman / Stabil / Merdeka*).
  - Kartu Metrik 3 Kolom: Total Aset Likuid, Total Aset Investasi, Total Aset Tetap, dan Total Liabilitas (Utang).
  - Section tabel/grid per kategori aset dengan tombol *Update Nilai*.
  - Modal Tambah Aset & Modal Update Valuasi Aset.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Pengguna dapat mencatat dan mengupdate aset investasi (saham, emas, kripto) dan aset tetap (kendaraan, gadget).
- [ ] Sistem menghitung total Kekayaan Bersih secara otomatis dengan mengintegrasikan saldo dompet likuid dan sisa pokok utang riil.
- [ ] Tombol Privacy Mask menyamarkan seluruh nominal angka di halaman Aset secara instan.
- [ ] Level Finansial tampil secara dinamis sesuai perbandingan aset bersih terhadap pengeluaran tahunan pengguna.
- [ ] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus tanpa error.
