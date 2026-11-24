# Task List — Milestone 10: Zero-Based Budgeting 50/30/20 & Goals Target Tabungan dengan Runway Dana Darurat

> **Referensi Spesifikasi:** `docs/10. budgeting-goals-dana-darurat/PRD.md`.

---

### 1. Skema Database & DTO Goals Tabungan

- [x] Modifikasi `app/server/src/db/schema.ts`:
  - Tambahkan tabel `goals` (id, name, emoji, targetAmount, currentAmount, targetDate, isEmergencyFund, walletId, createdAt, updatedAt).
  - Pagu anggaran per kategori tersimpan pada tabel `budgets` dengan periode default/override.
- [x] Buat dan terapkan migrasi Drizzle untuk tabel `goals` (`0009_sparkling_goals.sql`).
- [x] Definisikan DTO di `app/shared/src/dtos.ts`: `GoalDto`, `CreateGoalDto`, `UpdateGoalDto`, `ContributeGoalDto`, `EmergencyFundRunwayDto`, `BudgetCategorySummary`, `BudgetOverviewDto`.

---

### 2. Backend API Budgeting & Goals Service

- [x] Buat modul `app/server/src/routes/goals.ts`:
  - `GET /api/goals`: Ambil semua target tabungan aktif beserta kalkulasi runway dana darurat.
  - `POST /api/goals`: Tambah target tabungan baru.
  - `PATCH /api/goals/:id`: Update informasi target atau nominal.
  - `POST /api/goals/:id/contribute`: Setor tabungan (debit dompet sumber -> kredit saldo goal).
  - `DELETE /api/goals/:id`: Hapus target tabungan.
- [x] Buat endpoint `GET /api/budgets/summary` dan `PUT /api/budgets`:
  - Simpan dan hitung pagu anggaran per kategori serta perbandingan alokasi 50/30/20.
- [x] Daftarkan rute baru di `app/server/src/app.ts`.

---

### 3. Halaman Budgeting & Dynamic Custom Categories (`BudgetPage.tsx`)

- [x] Buat & Sempurnakan `app/client/src/pages/BudgetPage.tsx`:
  - Penamaan halaman & menu sidebar: **"Budgeting"** (sebelumnya "Budget 50/30/20").
  - Header kalkulasi pendapatan vs alokasi: *"Sisa dana yang belum ditugaskan: Rp X"*.
  - Section 50% Kebutuhan, 30% Keinginan, 20% Tabungan dengan visual progress bar.
  - Tombol **"+ Tambah Kategori"** pada masing-masing dari ketiga amplop (Kebutuhan, Keinginan, Tabungan) untuk membuat kategori kustom secara dinamis.
  - Tombol **Edit (pensil)** dan **Hapus (sampah)** pada setiap baris kategori untuk fleksibilitas kustomisasi tanpa hardcode.
  - Modal **Tambah / Edit Kategori**: input nama, pemilihan kelompok alokasi (50/30/20), pagu anggaran bulanan, dan palet warna penanda.
  - Modal **Konfirmasi Hapus Kategori** dengan validasi keamanan transaksi riil.
- [x] Tambahkan tautan menu Budgeting di sidebar navigasi desktop dan mobile rail.

---

### 4. Halaman Goals & Runway Dana Darurat (`GoalsPage.tsx`)

- [x] Buat `app/client/src/pages/GoalsPage.tsx`:
  - Hero Card Dana Darurat: total dana darurat + metric runway ketahanan hidup (*"X Bulan Pengeluaran"*).
  - Grid kartu target tabungan: judul, emoji, progress bar, persentase, sisa nominal yang harus dikumpulkan, dan proyeksi bulanan.
  - Modal **Tambah / Edit Goal**: formulir pembuatan target dengan emoji picker dan penanda dana darurat.
  - Modal **Setor Tabungan (Contribute)**: pilih dompet sumber, masukkan nominal setor, otomatis sinkron ke transaksi tabungan.
- [x] Tambahkan tautan menu Goals di sidebar navigasi desktop dan mobile rail.

---

### 5. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors)
- [x] Jalankan linter: `cd app; bun run lint` (0 errors)
- [x] Tulis unit test untuk kalkulasi runway dana darurat dan custom categories di `app/server/src/__tests__/goals.test.ts`.
- [x] Jalankan test suite: `cd app; bun test` (37/37 pass, 414 assertions)
- [x] Uji interaksi pembuatan goal, penyetoran tabungan, penambahan & pengeditan kategori kustom di browser (`http://localhost:5173`).

