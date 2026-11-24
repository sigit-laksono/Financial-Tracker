# Task List — Milestone 6: Visualisasi Tren Arus Kas, Glanceability Dompet & Timeline Risiko Siklus

> **Referensi Desain & Audit:** `docs/DESIGN.md`, `docs/0.draft/ui-designer.md`, `docs/0.draft/frontend-developer.md`.

---

### 1. Komponen Baru `CashflowSparkline.tsx`

- [x] Buat file `app/client/src/components/CashflowSparkline.tsx`:
  - Ambil data 7 hari terakhir dari prop `dailyTotals: Array<{ date: string; expense: number; income: number }>`.
  - Normalisasi nilai koordinat X dan Y ke dalam viewbox SVG `0 0 320 60`.
  - Bangun path kurva halus menggunakan kubik Bézier interpolation (`C x1 y1, x2 y2, x y`).
  - Tambahkan linear gradient fill di bawah kurva dengan opasitas memudar (`fill="url(#sparkline-grad)"`).
  - Sediakan titik interaktif (dot hover/tap) yang menampilkan tanggal dan nominal belanja hari itu.
  - Tambahkan ARIA attribute: `role="img"` dan `aria-label="Grafik tren pengeluaran 7 hari terakhir"`.
  - Tambahkan unit test untuk memastikan kalkulasi path kurva tidak menghasilkan NaN jika data pengeluaran bernilai 0.

---

### 2. Integrasi Sparkline ke `OverviewPage.tsx`

- [x] Pasang komponen `CashflowSparkline` di bawah kartu *Safe-to-Spend*:
  - Header kartu: *"Tren Belanja 7 Hari Terakhir"*.
  - Rata-rata belanja harian minggu ini vs minggu lalu.
  - Pastikan tidak menimbulkan layout shift pada saat loading data dashboard.

---

### 3. Redesain Tata Letak Saldo Dompet Modular (`OverviewPage.tsx`)

- [x] Pisahkan daftar dompet di `OverviewPage.tsx` menjadi 2 kelompok visual:
  - **Kelompok 1: Kas Belanja Harian (Spending)**
    - Tampilkan total kas belanja siap pakai.
    - Grid kartu dompet: BNI, BCA, GoPay dengan warna identitas brand dan tombol *"Cocokkan Saldo Dompet"*.
  - **Kelompok 2: Tabungan & Dana Darurat (Savings)**
    - Tampilkan total kas tersimpan.
    - Kartu ringkas tabungan (Jenius Maxi Saver, Tabungan Berjangka) dengan penanda bahwa dana ini tidak dihitung sebagai uang belanja harian.
- [x] Berikan penanda badge visual perbankan Indonesia yang kontras dan mudah dikenali sekilas.

---

### 4. Peningkatan Timeline Siklus (`CycleTimeline.tsx`)

- [x] Tambahkan kalkulasi perbandingan tanggal jatuh tempo kartu kredit vs tanggal gajian:
  - Deteksi apakah `cardPaymentDay < gajianStartDay`.
  - Tampilkan banner peringatan arus kas jika tagihan harus dibayar sebelum gaji masuk.
  - Tampilkan penanda aman jika tagihan dibayar setelah gaji masuk.
- [x] Perbarui indikator penunjuk **"HARI INI"**:
  - Gunakan badge warna kontras tinggi dengan pulsing dot animation yang halus.

---

### 5. Micro-Nudge & Apresiasi Finansial

- [x] Buat kartu apresiasi mikro di `OverviewPage.tsx`:
  - Lencana *"🛡️ Bebas Bunga Kartu Kredit"*: hitung estimasi rupiah bunga kartu kredit yang berhasil dihemat siklus ini.
  - Tampilkan pesan penguat disiplin jika belanja harian stabil di bawah batas jatah.

---

### 6. Pengujian & Verifikasi

- [x] Jalankan linter dan typecheck:
  ```bash
  cd app
  bun run lint
  bun run typecheck
  ```
- [x] Jalankan unit test frontend & backend:
  ```bash
  cd app
  bun test
  ```
- [x] Verifikasi render di mobile dan desktop:
  - Pastikan grafik sparkline SVG mulus dan tajam di resolusi retina mobile.
  - Pastikan kelompok dompet belanja vs tabungan tidak membingungkan pengguna.
