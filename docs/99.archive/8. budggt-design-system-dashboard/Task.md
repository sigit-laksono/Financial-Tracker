# Task List — Milestone 8: Transformasi UI/UX Budggt (Dark Hero Card Neon Lime, Sisa Budget Harian, Privacy Mask, 50/30/20 & Kalender Aktivitas)

> **Referensi Spesifikasi:** `docs/8. budggt-design-system-dashboard/PRD.md`.

---

### 1. Skema Database & Kategori 50/30/20

- [x] Modifikasi `app/server/src/db/schema.ts`:
  - Tambahkan kolom `bucket` pada tabel `categories`:
    `bucket: text("bucket", { enum: ["needs", "wants", "savings"] }).notNull().default("needs")`
- [x] Perbarui `app/server/src/db/seed.ts`:
  - Masukkan pemetaan `bucket` untuk setiap kategori di `DEFAULT_CATEGORIES`.
- [x] Buat skrip migrasi ringan di server agar kolom `bucket` otomatis terisi pada database yang ada.

---

### 2. Backend Dashboard Query Metrics

- [x] Modifikasi `app/shared/src/dtos.ts`:
  - Perluas `DashboardDto` untuk menyertakan:
    - `budget503020`: rincian target dan realisasi `needs`, `wants`, `savings`.
    - `calendarHeatmap`: array hari dan total pengeluaran per hari untuk visualisasi kalender.
- [x] Modifikasi `app/server/src/lib/dashboardQuery.ts`:
  - Hitung agregasi pengeluaran per `bucket` dalam periode aktif.
  - Bangun data kalender bulanan dari tanggal 1 hingga akhir bulan aktif.

---

### 3. Privacy Mode & Desain Sistem Neon Lime

- [x] Buat file `app/client/src/lib/usePrivacyMode.ts`:
  - Hook reaktif membaca/menyimpan status masked di `localStorage`.
- [x] Perbarui helper pemformatan di `app/client/src/lib/format.ts`:
  - Dukung opsi `isMasked` pada `formatRupiah` dan `formatCompactRupiah`.
- [x] Perbarui `app/client/src/styles/` dan Tailwind config/CSS:
  - Definisikan token warna Neon Lime (`--neon-lime: #ccff00`, `--hero-bg: #121514`).

---

### 4. Komponen UI Baru Ala Budggt

- [x] Buat `app/client/src/components/BudggtHeroCard.tsx`:
  - Card hitam elegan dengan aksen Neon Lime.
  * Tampilkan sisa budget harian, toggle gembok/mata privasi, dan ringkasan mini pemasukan/pengeluaran.
- [x] Buat `app/client/src/components/Budget503020Progress.tsx`:
  - Visual circle indikator hari siklus + baris horizontal Kebutuhan, Keinginan, Tabungan.
- [x] Buat `app/client/src/components/CalendarActivityGrid.tsx`:
  - Kalender bulanan interaktif dengan dot densitas pengeluaran.
- [x] Integrasikan seluruh komponen ke `app/client/src/pages/OverviewPage.tsx`.

---

### 5. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck`
- [x] Jalankan linter: `cd app; bun run lint`
- [x] Jalankan unit & integration tests: `cd app; bun test`
- [x] Verifikasi manual tampilan di browser `http://localhost:5173`.
