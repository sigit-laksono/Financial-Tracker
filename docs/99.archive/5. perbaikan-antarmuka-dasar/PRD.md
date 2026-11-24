# PRD — Milestone 4: Perbaikan Kritis Antarmuka, Presets Kontekstual & Aksesibilitas Mobile

## 1. Latar Belakang & Masalah

Berdasarkan hasil live browser audit dan pengujian pada berbagai viewport (mobile 390×844 dan desktop 1280×800), ditemukan sejumlah friksi interaksi fundamental dan bug logika pada antarmuka aplikasi:

1. **Pemenggalan Tanda Minus (-) pada Kartu Safe-to-Spend Mobile:**
   Pada layar smartphone (360px–390px), nominal negatif mengalami *hyphen wrapping*, di mana tanda minus (`-`) menggantung di baris atas sendirian terpisah dari angka `Rp 3.919.661`. Hal ini merusak hierarki visual dan membingungkan persepsi pengguna.
2. **Preset Template Cepat Bocor Lintas-Tab di `QuickAddSheet`:**
   Daftar *Template Cepat Tersering* ("Makan Siang", "Kopi", "Warung") dirender global di bagian atas sheet tanpa memfilter mode aktif, sehingga chip pengeluaran tetap muncul saat pengguna membuka tab **Masuk**, **Transfer**, maupun **Bayar**.
3. **Filter Default "Minggu 5" di `TransactionsPage` Menimbulkan Kepanikan Data:**
   Inisialisasi filter transaksi menggunakan `weekChoice: "auto"` yang otomatis mengunci ke minggu berjalan. Menjelang akhir siklus (misal tanggal 21–24), sistem memilih "Minggu 5" yang baru berisi 1–2 transaksi, memicu persepsi bahwa riwayat transaksi pengguna hilang.
4. **Pergeseran Tata Letak (Cumulative Layout Shift) pada Tombol Nominal Cepat:**
   Tombol penambah nominal (+10k, +25k, +50k, +100k) menggunakan `flex-wrap` dengan tombol Reset kondisional yang tiba-tiba muncul, menyebabkan pergeseran layout saat pengguna mengetik.
5. **Kegagalan Rasio Kontras Aksesibilitas WCAG AA:**
   Teks oranye `--highlight` (`#ff8a00`) pada latar belakang putih memiliki rasio kontras hanya **2.36:1** (gagal standar minimum 4.5:1), menyulitkan keterbacaan peringatan jatuh tempo dan unbilled CC.
6. **Fat-Finger Error pada Input Nominal:**
   Pengguna rentan salah memasukkan jumlah angka nol di kasir (misal Rp50.000 terketik Rp500.000) tanpa adanya konfirmasi ejaan nominal otomatis.
7. **Virtual Keyboard Mobile Menutupi Kontrol Aksi:**
   Pada saat input nominal dibuka di HP, form terdorong dan tombol simpan tertutup keyboard tanpa penanganan scroll otomatis.

---

## 2. Tujuan Milestone

1. **Menghilangkan seluruh bug visual dan layout shift pada tampilan mobile** (Safe-to-Spend minus wrapping dan zero-CLS nominal button grid).
2. **Menjamin relevansi kontekstual form pencatatan** (hanya tampilkan template pengeluaran di tab Keluar, dan template relevan di tab lainnya).
3. **Mencegah kepanikan hilangnya riwayat transaksi** dengan mengubah default filter transaksi ke "Semua Minggu" siklus aktif disertai indikator jumlah per minggu.
4. **Mencapai standar aksesibilitas WCAG 2.1 AA** pada seluruh token warna dan ukuran sentuh interaktif ($\ge$ 44×44px).
5. **Mencegah kesalahan input nominal di kasir** lewat ejaan teks Rupiah otomatis (*Smart Spell-Out Helper*).

---

## 3. Ruang Lingkup Fungsional & Solusi Desain

### A. Perbaikan Hero Card Safe-to-Spend (`OverviewPage.tsx`)
- Container nominal Rupiah ditambahkan kelas `whitespace-nowrap` dan `word-break: keep-all`.
- Karakter minus diganti menggunakan simbol tipografis Unicode `\u2212` (`−`).
- Skala tipografi responsif disesuaikan dengan clamp: `text-[clamp(22px,5.2vw,40px)]`.
- Bila `safeToSpend < 0`, tampilkan badge status tegas namun ramah: `🚨 Jatah Defisit` disertai jatah harian `Rp 0 / hari`.

### B. Scoping Kontekstual Quick Presets (`QuickAddSheet.tsx`)
- Filter daftar chip template berdasarkan mode aktif:
  - **Tab Keluar (`expense`):** Menampilkan merchant pengeluaran tersering (Kopi, Warung, Minimarket).
  - **Tab Masuk (`income`):** Menampilkan sumber pemasukan tersering (Gaji, Freelance, Cashback) atau sembunyikan jika belum ada riwayat.
  - **Tab Transfer (`transfer`):** Menyembunyikan template merchant; menampilkan chip rute transfer dompet cepat (BNI $\rightarrow$ GoPay, BCA $\rightarrow$ BNI).
  - **Tab Bayar (`settle`):** Menyembunyikan template merchant; menampilkan tagihan CC atau cicilan aktif terdekat.

### C. Restrukturisasi Filter Transaksi (`TransactionsPage.tsx` & `filters.ts`)
- Nilai inisial `INITIAL_TRANSACTION_FILTERS.weekChoice` diubah dari `"auto"` menjadi `"all"`.
- Tab strip mingguan menampilkan badge total transaksi per minggu:
  `[ Semua (38) ]` `[ Mgg 1 (12) ]` `[ Mgg 2 (10) ]` `[ Mgg 3 (8) ]` `[ Mgg 4 (6) ]` `[ Mgg 5 (2) ]`.
- Minggu berjalan ditandai dengan dot aksen hijau/teal bertuliskan *(Berjalan)*.
- Bila tab minggu tertentu kosong, sediakan *Contextual Empty State* dengan tombol 1-klik: *"Tampilkan Semua Transaksi Siklus Ini"*.

### D. Zero-CLS Nominal Buttons Grid & Spell-Out Rupiah (`QuickAddSheet.tsx`)
- Ganti layout flex dengan grid statis 5 kolom:
  `[ +10rb ]` `[ +25rb ]` `[ +50rb ]` `[ +100rb ]` `[ Reset ]`.
  Tombol `Reset` selalu berada di slot ke-5 dan berada dalam status `disabled:opacity-40` jika input kosong.
- Tambahkan komponen helper ejaan di bawah input nominal:
  Input `50000` $\rightarrow$ *"Lima puluh ribu rupiah"*.
  Input `1500000` $\rightarrow$ *"Satu juta lima ratus ribu rupiah"*.

### E. Penyesuaian Token Warna & Tipografi (`theme.css`)
- Pisahkan token `--highlight` menjadi:
  - `--highlight-bg: #ff8a00` (dipadukan teks `#1f1100`, kontras 7.81:1).
  - `--highlight-text: #b45309` (tema terang, kontras 5.08:1) dan `#ffaa33` (tema gelap, kontras 8.30:1).
- Terapkan fitur OpenType Figtree untuk angka tabular pada kelas `.tabular-nums`:
  `font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;`.

### F. Mobile Virtual Keyboard Resilience & Touch Targets
- Seluruh elemen kontrol (tombol filter, tombol edit transaksi, tab navigasi, tombol modal) dipastikan memiliki area sentuh minimum 44×44px.
- Pada event `onFocus` elemen input nominal/merchant di `QuickAddSheet`, trigger `scrollIntoView({ behavior: 'smooth', block: 'center' })` setelah jeda 150ms agar input tetap di tengah layar saat keyboard virtual muncul.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Pada mobile viewport (360px–390px), angka nominal negatif pada kartu *Safe-to-Spend* tidak pernah terpisah baris antara tanda minus dan angka Rupiah.
- [ ] Membuka tab Masuk, Transfer, atau Bayar pada `QuickAddSheet` tidak menampilkan template merchant pengeluaran.
- [ ] Membuka tab Transaksi pada hari ke-30 siklus langsung menampilkan seluruh 38+ transaksi siklus berjalan, bukan hanya 1–2 transaksi Minggu 5.
- [ ] Mengetik angka nominal di `QuickAddSheet` tidak menimbulkan pergeseran letak tombol (CLS = 0) dan ejaan teks nominal muncul akurat di bawah input.
- [ ] Semua teks peringatan oranye terbaca dengan kontras rasio $\ge$ 4.5:1 terhadap latar belakang (lolos uji WCAG AA).
- [ ] Tombol Simpan pada `QuickAddSheet` tetap terlihat dan dapat ditekan dengan satu tangan saat keyboard HP terbuka.
