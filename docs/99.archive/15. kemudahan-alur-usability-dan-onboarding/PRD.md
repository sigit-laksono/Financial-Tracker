# PRD — Milestone 15: Penyederhanaan Bahasa Finansial, Alur Usability & Onboarding

## 1. Latar Belakang & Masalah

Berdasarkan audit alur produk pada `docs/0.draft/usability-analysis.md`, keberhasilan aplikasi pencatatan keuangan harian ditentukan oleh **retensi penggunaan tanpa friksi kognitif**. Pengguna sering berhenti mencatat (*tracking fatigue*) jika menghadapi istilah akuntansi yang membingungkan atau alur pencatatan yang membutuhkan terlalu banyak langkah:

1. **Beban Kognitif Istilah Akuntansi Asing / Kaku:**
   Pengguna awam di Indonesia tidak terbiasa dengan istilah perbankan seperti *Unbilled*, *Billed*, *Reconcile*, *Safe-to-Spend*, *Emergency Runway*, dan *Split Pay*. Istilah ini memicu keraguan saat mengklik fitur.
2. **Friksi Pencatatan Harian (Formulir Terlalu Panjang):**
   Formulir `QuickAddSheet` saat ini mengharuskan pengguna memilih dompet dan kategori secara manual setiap kali mencatat, padahal 80% pengeluaran harian berasal dari dompet operasional utama (misalnya BCA atau Tunai).
3. **Ketiadaan Panduan Awal (Onboarding First-Run Wizard):**
   Saat pengguna baru membuka aplikasi, layar langsung menyajikan tabel kosong dan dashboard dengan angka 0 tanpa bimbingan langkah awal.
4. **Empty State yang Kurang Bermanfaat:**
   Tampilan kosong saat ini hanya menampilkan pesan statis *"Tidak ada transaksi"* tanpa tindakan lanjut yang jelas (*call to action*).

---

## 2. Tujuan Milestone

1. **Penyelarasan Bahasa Manusiawi (Human-Friendly Financial Terms)**:
   Mengganti seluruh istilah kaku menjadi padanan Bahasa Indonesia yang ramah, jelas, dan tidak menimbulkan salah persepsi.
2. **Pencatatan Harian Cepat 2-Tap (Frictionless Logging)**:
   Menyediakan tombol preset nominal cepat, mengingat pilihan dompet/kategori terakhir secara cerdas (*smart defaults*), dan memungkinkan pencatatan selesai dalam 2 tap.
3. **Wizard Pengaturan Awal (First-Run Onboarding Modal)**:
   Menyajikan wizard 3 langkah ringkas bagi pengguna baru untuk menyetel tanggal gajian, saldo awal rekening utama, dan budget bulanan dalam <60 detik.
4. **Empty States Interaktif & Bantuan Kontekstual**:
   Setiap layar kosong dilengkapi ilustrasi mini, penjelasan fungsi, dan tombol aksi langsung untuk memulai pencatatan.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Standar Kamus Istilah Bahasa Indonesia
Terapkan standarisasi terminologi di seluruh komponen frontend:
- `Safe-to-Spend` $\rightarrow$ **"Uang Aman Belanja"**
- `Daily Allowance` $\rightarrow$ **"Jatah Belanja Hari Ini"**
- `Unbilled CC` $\rightarrow$ **"Tagihan Berjalan (Belum Dicetak)"**
- `Billed CC` $\rightarrow$ **"Tagihan Siap Bayar"**
- `Reconcile` $\rightarrow$ **"Cocokkan Saldo Dompet"**
- `Emergency Fund Runway` $\rightarrow$ **"Daya Tahan Dana Darurat"**
- `Split Pay` $\rightarrow$ **"Ubah Jadi Cicilan"**
- `Early Payoff` $\rightarrow$ **"Pelunasan Dipercepat"**
- `Pacing / Overdraft` $\rightarrow$ **"Laju Belanja / Saldo Menipis"**

### B. Penyempurnaan `QuickAddSheet.tsx`
- **Smart Memory**:
  - Simpan dompet terakhir yang digunakan di `localStorage`.
  - Berikan sugesti kategori otomatis saat mengetik merchant yang sudah pernah dicatat sebelumnya (misal ketik "Indomaret" $\rightarrow$ otomatis pilih kategori "Kebutuhan Pokok / Belanja").
- **Chips Preset Nominal Cepat**:
  - Sediakan tombol chip cepat: `+Rp10.000`, `+Rp20.000`, `+Rp50.000`, `+Rp100.000`.

### C. Komponen Onboarding Wizard (`OnboardingModal.tsx`)
- Tampil otomatis saat aplikasi baru pertama kali dibuka (jika belum ada transaksi):
  - **Langkah 1**: Setel Tanggal Gajian Bulanan (default: tanggal 25) & Dompet Rekening Utama.
  - **Langkah 2**: Masukkan Saldo Awal Rekening & Limit Kartu Kredit (opsional).
  - **Langkah 3**: Tentukan Anggaran Bulanan Kasar (50/30/20).
- Tombol *"Mulai Catat Keuangan Sekarang!"* yang langsung membuka dashboard siap pakai.

### D. Empty State & Help Tooltip Interaktif
- Perbarui komponen `StateView` di `UI.tsx`:
  - Tambahkan tombol aksi primer (misal: tombol *"Tambah Transaksi Pertama"*, *"Daftarkan Dompet Baru"*).
- Pasang tooltip bantuan (`HelpTooltip.tsx`) di samping istilah-istilah finansial penting.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [x] Seluruh antarmuka aplikasi menggunakan terminologi Bahasa Indonesia yang seragam dan mudah dimengerti orang awam.
- [x] Pengguna dapat mencatat pengeluaran berulang (seperti makan siang / kopi) hanya dengan 2 tap.
- [x] Pengguna baru disambut dengan Onboarding Wizard 3 langkah saat pertama kali membuka aplikasi.
- [x] Seluruh halaman saat tidak ada data (transaksi, utang, aset) menampilkan petunjuk jelas dan tombol aksi langsung.
- [x] Setiap tooltip bantuan menjelaskan formula finansial (misal cara hitung Uang Aman Belanja) secara transparan.
- [x] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus.
