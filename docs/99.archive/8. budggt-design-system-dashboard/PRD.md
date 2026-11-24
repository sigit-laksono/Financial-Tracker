# PRD — Milestone 8: Transformasi UI/UX Budggt (Dark Hero Card Neon Lime, Sisa Budget Harian, Privacy Mask, 50/30/20 & Kalender Aktivitas)

## 1. Latar Belakang & Masalah

Setelah dilakukan pengujian dan benchmarking langsung terhadap aplikasi **Budggt** (https://budggt.com), ditemukan sejumlah keunggulan desain dan fungsional yang membuat pencatatan keuangan harian terasa jauh lebih intuitif, menyenangkan, dan relevan bagi pengguna di Indonesia:

1. **Ketiadaan Fokus Harian yang Langsung Menjawab Pertanyaan Pokok Pengguna:**
   Saat ini dashboard menampilkan angka *Safe-to-Spend* siklus gajian, namun belum secara instan menjawab: *"Hari ini aku boleh jajan berapa?"* (Sisa Budget Harian).
2. **Kebutuhan Privasi di Tempat Umum (*Privacy Mode*):**
   Pengguna sering membuka aplikasi di kantor, kafe, atau transportasi umum. Belum ada tombol satu klik untuk menyamarkan nominal (`Rp •••••••`).
3. **Belum Ada Klasifikasi Pengeluaran 50/30/20 (Kebutuhan vs Keinginan vs Tabungan):**
   Kategori pengeluaran masih datar tanpa pengelompokan *Needs* (50%), *Wants* (30%), dan *Savings* (20%). Akibatnya pengguna sulit mengevaluasi apakah pengeluaran mereka sehat atau impulsif.
4. **Visual Kalender Aktivitas Bulanan Masih Absen:**
   Pengguna ingin melihat kalender tanggal 1–31 dengan indikator visual kepadatan belanja (*spending heatmap*) untuk mengetahui hari-hari boros vs hari-hari hemat.
5. **Palet Warna & Daya Tarik Visual:**
   Gaya visual saat ini masih fungsional-minimalis. Kombinasi kartu hero hitam kontras tinggi (`#121212`) berpadu dengan aksen **Neon Lime (`#ccff00` / `#d9f99d`)** ala Budggt memberikan energi positif dan modern tanpa mengorbankan keterbacaan (*contrast AA*).

---

## 2. Tujuan Milestone

1. **Menghadirkan Hero Card Gelap Beraksen Neon Lime di Dashboard:**
   - Menampilkan **Budget Harian yang Tersisa** (`👆 budget harian yang tersisa`) dengan tipografi tabular tebal.
   - Menyediakan status harian suportif (*"Suppeerrr! Belum ada pengeluaran hari ini"*).
   - Menampilkan mini metrics pemasukan & pengeluaran periode ini.
2. **Fitur Sensor Nominal Global (*Privacy Mode*):**
   - Menghadirkan tombol toggle gembok/mata di header/hero card.
   - Ketika aktif, seluruh nominal Rupiah di halaman berubah menjadi `Rp •••••••` dan tersimpan di `localStorage`.
3. **Framework Pengeluaran 50/30/20 Terintegrasi:**
   - Menambahkan kolom `bucket` pada kategori: `needs`, `wants`, `savings`.
   - Menampilkan bar progres 3 lapis di dashboard (Kebutuhan 50%, Keinginan 30%, Tabungan 20%) lengkap dengan status ("Masih aman" / "Perlu hemat").
4. **Kalender Aktivitas Transaksi Bulanan (`CalendarActivityGrid.tsx`):**
   - Menampilkan kalender visual bulan berjalan dengan heatmap pengeluaran harian dan highlight hari ini.
5. **Menjaga 100% Stabilitas Backend & Engine Utang:**
   - Seluruh integrasi perhitungan saldo kas, siklus gajian, dan cicilan utang tetap 100% akurat dan lulus test.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Skema Database & Kategori (`schema.ts`)
- Tambahkan kolom `bucket` pada tabel `categories`:
  - `text("bucket", { enum: ["needs", "wants", "savings"] }).notNull().default("needs")`
- Migrasi otomatis kategori default:
  - **Needs (Kebutuhan)**: Makanan & Minuman, Transportasi, Listrik, Internet, Paket Data, Kesehatan, Pendidikan, Tagihan, Biaya Bank, Keluarga, Hutang.
  - **Wants (Keinginan)**: Jajan, Belanja, Hiburan, Langganan, Perjalanan, Buku, Peliharaan, Lainnya.
  - **Savings (Tabungan)**: Investasi, Tabungan, Dana Darurat.

### B. Backend Dashboard Query (`dashboardQuery.ts`)
- Endpoint `GET /api/dashboard` memperluas payload:
  - `dailyAllowance`: kalkulasi sisa batas belanja harian hari ini.
  - `budget503020`:
    - `needs`: `{ spent: number, limit: number, percent: number, status: "safe" | "warning" | "exceeded" }`
    - `wants`: `{ spent: number, limit: number, percent: number, status: "safe" | "warning" | "exceeded" }`
    - `savings`: `{ spent: number, target: number, percent: number, status: "on_track" | "behind" }`
  - `calendarHeatmap`: peta `Array<{ date: string; amount: number; count: number; isToday: boolean }>` untuk bulan aktif.

### C. State Privasi Global (`usePrivacyMode.ts`)
- Custom hook dan context/store sederhana yang mengontrol boolean `isMasked`.
- Helper pemformatan `formatRupiah(amount, isMasked)` yang otomatis mengembalikan `Rp •••••••` saat aktif.

### D. Komponen UI Baru & Redesain
- **`BudggtHeroCard.tsx`**:
  - Background `#141716` / `#121212`, hairline border halus, aksen Neon Lime `#ccff00`.
  - Nominal budget harian besar, tombol mask privasi, status harian.
- **`Budget503020Progress.tsx`**:
  - Lingkaran hari periode berjalan (`Hari 30 dari 31`).
  - Bar progres Kebutuhan, Keinginan, Tabungan.
- **`CalendarActivityGrid.tsx`**:
  - Grid 7 kolom (Sn, Sl, Rb, Km, Jm, Sb, Mg) dengan indikator pengeluaran per tanggal.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Dashboard menampilkan Hero Card gelap dengan aksen Neon Lime dan nominal sisa budget harian yang akurat.
- [ ] Tombol Privacy Mode menyamarkan seluruh nominal Rupiah di halaman menjadi `Rp •••••••` secara instan dan persist saat refresh.
- [ ] Bar progres pengeluaran 50/30/20 menampilkan kalkulasi real-time sesuai kategori transaksi yang dicatat.
- [ ] Kalender aktivitas menampilkan tanggal bulan aktif dengan penanda visual belanja dan highlight hari ini.
- [ ] `bun run typecheck`, `bun run lint`, dan `bun test` berhasil 100% tanpa error atau regresi.
