# PRD — Milestone 10: Zero-Based Budgeting 50/30/20 & Goals Target Tabungan dengan Runway Dana Darurat

## 1. Latar Belakang & Masalah

Pengelolaan keuangan pribadi yang efektif tidak hanya mencatat uang yang sudah keluar, tetapi juga merencanakan ke mana uang harus pergi sebelum bulan dimulai (*Zero-Based Budgeting*) dan mengamankan masa depan finansial pengguna:

1. **Belum Ada Alokasi Budget Terencana per Amplop Kategori:**
   Meskipun dashboard sudah menampilkan realisasi 50/30/20, pengguna belum memiliki antarmuka khusus untuk menetapkan pagu (*spending cap*) anggaran bulanan per kategori (misal: Makanan Rp 2.000.000, Jajan Rp 800.000, Listrik Rp 500.000).
2. **Ketiadaan Fitur Target Tabungan (*Goals*):**
   Pengguna ingin menabung untuk tujuan spesifik (DP Rumah, Liburan, Beli Laptop, Biaya Pendidikan Anak) dengan visual progres bar dan estimasi tanggal tercapai.
3. **Pentingnya Perhitungan Runway Dana Darurat (*Emergency Fund*):**
   Metrik paling krusial bagi ketahanan finansial seorang individu adalah: *"Berapa bulan saya bisa bertahan hidup jika hari ini saya kehilangan pendapatan?"*. Belum ada kalkulator dinamis yang menghitung runway dana darurat (*"Setara X Bulan Pengeluaran"*) berdasarkan rata-rata pengeluaran bulanan riil pengguna.

---

## 2. Tujuan Milestone

1. **Halaman Budgeting Terapan 50/30/20 (`BudgetPage.tsx`):**
   - Menampilkan total estimasi pendapatan bulanan (dari pengaturan gaji / rata-rata pemasukan).
   - Menghitung batas ideal alokasi: **Kebutuhan (50%)**, **Keinginan (30%)**, dan **Tabungan (20%)**.
   - Menampilkan status alokasi dana: *"Dana Siap Dialokasikan: Rp X"* atau *"Over-budget: Rp Y"*.
   - Menyediakan input pagu budget per kategori dengan tanggal jatuh tempo tagihan rutin.
2. **Halaman Target Finansial & Tabungan (`GoalsPage.tsx`):**
   - Membuat kartu target tabungan dengan nama, emoji, target nominal, target tanggal, dan saldo terkumpul saat ini.
   - Progres bar persentase pencapaian target tabungan.
   - Integrasi tombol *Setor Tabungan*: transaksi transfer dari dompet operasional ke dompet/rekening tabungan yang langsung menambah saldo goal.
3. **Kartu Khusus Dana Darurat (Emergency Fund Runway):**
   - Menampilkan total saldo dana darurat.
   - Menghitung ketahanan hidup: `Total Dana Darurat / Rata-rata Pengeluaran Kebutuhan Bulanan = X Bulan Runway`.
   - Memberikan rekomendasi batas aman (standar perencana keuangan: 3–6 bulan untuk lajang, 6–12 bulan untuk berkeluarga).

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Skema Database & Model (`schema.ts`)
- **Tabel Baru `goals`**:
  ```typescript
  export const goals = sqliteTable("goals", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default("🎯"),
    targetAmount: integer("target_amount").notNull(),
    currentAmount: integer("current_amount").notNull().default(0),
    targetDate: text("target_date"),
    isEmergencyFund: integer("is_emergency_fund", { mode: "boolean" }).notNull().default(false),
    walletId: text("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  });
  ```
- **Tabel `category_budgets`** (atau kolom `monthly_budget` pada `categories`):
  - Memungkinkan penentuan batas pengeluaran bulanan per kategori.

### B. Shared DTOs & API Endpoint
- DTOs: `GoalDto`, `CreateGoalDto`, `UpdateGoalDto`, `BudgetOverviewDto`.
- Endpoints:
  - `GET /api/goals` & `POST /api/goals`: CRUD target tabungan.
  - `POST /api/goals/:id/contribute`: Setor nominal ke target tabungan (otomatis membuat transaksi).
  - `GET /api/budgets/summary`: Mengambil ringkasan pagu alokasi 50/30/20 vs realisasi berjalan.

### C. Komponen UI Frontend
- **`BudgetPage.tsx`**:
  - Banner alokasi nol (Zero-based): *Semua pendapatan telah dialokasikan*.
  - 3 Accordion Section: Kebutuhan (50%), Keinginan (30%), Tabungan (20%).
  - Input pagu cepat per kategori dengan indikator realisasi belanja saat ini.
- **`GoalsPage.tsx`**:
  - Kartu Hero Dana Darurat dengan badge runway *"Setara 4.5 Bulan Pengeluaran"*.
  - Grid kartu goals tabungan dengan visual progress bar, sisa hari, dan tombol *Setor Dana*.
  - Modal Tambah/Edit Target Tabungan dengan emoji picker.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Pengguna dapat menetapkan pagu anggaran per kategori dan melihat rasio 50/30/20 terhadap total pendapatan.
- [ ] Pengguna dapat membuat target tabungan baru dengan target nominal, tanggal target, dan emoji.
- [ ] Kartu Dana Darurat menghitung runway bulan bertahan hidup secara akurat dari riwayat pengeluaran riil.
- [ ] Aksi setor tabungan pada goal otomatis mencatat transaksi dan memperbarui progres target tabungan.
- [ ] Tampilan halaman konsisten dengan tema Budggt (Neon Lime `#ccff00`, Dark Hero `#121514`, dan Privacy Mask).
- [ ] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus tanpa error.
