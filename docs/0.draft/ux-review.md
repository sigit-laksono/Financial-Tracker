# Laporan Evaluasi & Audit UX/UI: Financial Tracker

**Tanggal:** 23 November 2026  
**Status:** Selesai (Draft Review)  
**Dokumen Referensi:** `docs/DESIGN.md`, `dens-ui`, WCAG 2.1 AA Guidelines, Anti-Slop Frontend Standard  
**Penyusun:** UX & UI Systems Architect  

---

## 1. Ringkasan Eksekutif (Executive Summary)

Aplikasi **Financial Tracker** adalah aplikasi pencatatan keuangan pribadi (*personal cashflow, credit card, and debt ledger*) berbasis Progressive Web App (PWA) yang ditujukan untuk pengguna harian di Indonesia. Desain mengadopsi sistem **dens-ui** bertema *Swiss-inspired tactile ops* dengan palet warna utama **Mars Green** (`#00797a`), aksen **Hermes Orange** (`#ff8a00`), serta kartu hero berlatar gelap kontras tinggi (*ENERGY 1 / RHYTHM 2 / MOTION 1*).

Evaluasi mendalam dilakukan terhadap seluruh halaman dan komponen di `app/client/src/` untuk menguji intuitivitas antarmuka, kenyamanan visual, pencegahan kebingungan mental (*cognitive friction*), serta kepatuhan teknis terhadap panduan desain `docs/DESIGN.md`.

### Tabel Skor Kesehatan UX/UI Saat Ini

| Dimensi Evaluasi | Skor (1–10) | Status | Keterangan Singkat |
| :--- | :---: | :---: | :--- |
| **Akurasi Arah Desain (`DESIGN.md`)** | **7.5 / 10** | *Perlu Penyesuaian* | Struktur visual sangat rapi, namun hero utama `OverviewPage` menyimpang dari arahan desain (*Net Worth* menggantikan *Safe-to-Spend*). |
| **Mobile Ergonomics & Tap Targets** | **7.0 / 10** | *Butuh Perbaikan* | Sebagian tombol aksi ikon, inline-edit, dan badge aksi masih berukuran `32px`–`36px` (di bawah standar minimum `44px`). |
| **Kepatuhan Token Warna (WCAG AA)** | **7.0 / 10** | *Butuh Perbaikan* | Terdapat kebocoran warna *hardcoded* (Tailwind hex mentah seperti `bg-[#00797a]`, `emerald-500`, `rose-500`) yang merusak konsistensi Dark Mode. |
| **Kejelasan Bahasa & Terminologi Finansial** | **8.0 / 10** | *Baik* | Sebagian besar istilah sudah dalam Bahasa Indonesia alami, namun pembedaan antara *Likuiditas Kas* vs *Net Worth* dan *Siklus Gajian* vs *Cut-Off CC* masih rentan membingungkan pemula. |
| **Manajemen State (Loading, Empty, Error)** | **9.0 / 10** | *Sangat Baik* | Komponen `StateView` dan penanganan *error boundary* diterapkan secara konsisten di seluruh tab. |
| **Kecepatan Pencatatan (Quick-Add Flow)** | **8.5 / 10** | *Sangat Baik* | `QuickAddSheet` sangat responsif, dilengkapi *spell-out* nominal Rupiah, pencegahan *overdraft*, dan pemecahan struk (*split transaction*). |

---

## 2. Lima Temuan Kritis (Top 5 UX Critical Findings)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TOP 5 TEMUAN KRITIS UX                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. MISKONSEPSI HERO RINGKASAN:                                              │
│    OverviewPage menampilkan Total Net Worth sebagai hero teratas, padahal   │
│    kebutuhan harian pengguna adalah Safe-to-Spend (Jatah Belanja Hari Ini). │
│                                                                             │
│ 2. PELANGGARAN TAP TARGET MOBILE (< 44px):                                  │
│    Banyak tombol aksi sekunder, ikon edit, dan hapus berukuran 32x32px.     │
│    Rentan salah tekan (fat-finger error) pada perangkat ponsel 360-390px.   │
│                                                                             │
│ 3. HARDCODED TAILWIND COLORS & KEBOCORAN TOKEN:                             │
│    Penggunaan warna mentah (#00797a, emerald, amber, rose) di 5 file        │
│    komponen mem-bypass token CSS variabel dan merusak kontras Dark Mode.    │
│                                                                             │
│ 4. BIAS PSIKOLOGIS NET WORTH VS LIKUIDITAS KAS:                             │
│    Pengguna bisa merasa "kaya" karena aset fisik/emas bernilai tinggi,       │
│    padahal saldo rekening belanja sedang menipis dan tagihan CC mendekat.   │
│                                                                             │
│ 5. AKSESIBILITAS SUB-MENU MOBILE (DRAWER vs TAB BAR):                       │
│    Tab "Budget", "Goals", "Aset", dan "Kartu" tersembunyi di balik modal    │
│    sheet "Menu", menambah satu langkah klik (2-tap friction) setiap navigasi│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Audit Halaman Demi Halaman (Screen-by-Screen In-Depth Audit)

### 3.1. OverviewPage (Ringkasan Keuangan)

`OverviewPage.tsx` adalah pintu gerbang utama yang dibuka pengguna berkali-kali setiap hari.

#### A. Temuan Struktur & Hirarki Visual:
1. **Hero Card Tidak Sesuai Kebutuhan Harian:**
   - Saat ini, halaman merender `NetWorthHeroCard` di posisi paling atas (baris 145).
   - *Masalah UX:* Pengguna harian yang membuka aplikasi sebelum memesan makan siang ingin tahu: *"Berapa uang yang aman saya belanjakan hari ini tanpa mengorbankan tagihan akhir bulan?"*. Melihat angka Net Worth (misal: Rp 180.000.000 karena ada aset tanah/emas) memberikan ilusi kelonggaran kas, padahal uang kas di rekening harian mungkin hanya tersisa Rp 450.000.
   - Komponen `DailyHeroCard` (yang memuat *Daily Allowance*, *Safe-to-Spend*, pengeluaran hari ini, dan *pacing indicator*) sudah dibuat di `DailyHeroCard.tsx`, namun **tidak dipasang sama sekali** di `OverviewPage.tsx`!
2. **Penyajian Dompet Kas Belanja vs Tabungan:**
   - Pemisahan antara *Kas Belanja Harian* dan *Tabungan & Simpanan Aman* (baris 174–294) adalah langkah UX yang sangat bagus. Ini mencegah pengguna menganggap uang darurat sebagai uang jajan.
   - Namun, tombol *"Cocokkan Saldo"* di tiap kartu dompet memiliki tinggi `min-h-[36px]` (baris 229, 284), yang di bawah standar `44px`.
3. **Budget 50/30/20 Progress Barometer:**
   - Komponen `Budget503020Progress` menyajikan dial lingkaran hari siklus (misal: Hari 12 dari 30) dan 3 bar pengeluaran (*Kebutuhan, Keinginan, Tabungan*).
   - Terdapat tombol shortcut langsung ke tab *Budget* dan *Target Goals*. Ini memangkas jarak navigasi dengan sangat baik.
4. **Kalender Aktivitas & Transaksi Terbaru (Grid 7:5):**
   - Di layar desktop/tablet, proporsi 7 kolom (Kalender) dan 5 kolom (Transaksi Terbaru) terasa seimbang dan tidak memanjang ke bawah.
   - Di layar mobile (< 640px), kalender bertumpuk di atas transaksi. Tap target tanggal pada kalender (`min-h-[44px] h-11 sm:h-12`) sudah memenuhi standar ergonomi.
5. **Dua Kolom Kewajiban (Tagihan Terdekat & Kontrol Kartu Kredit):**
   - Kolom kiri menampilkan *Tagihan Terdekat* dan *Tagihan Rutin Siklus Ini*.
   - Fitur bayar 1-klik untuk tagihan rutin (`payRecurringMutation`) sangat memudahkan rutinitas bulanan.
   - Kolom kanan menampilkan *Kartu Kredit Bridge* yang memuat rasio limit, cadangan kas CC (*Reserved Cash*), dan nominal *Belanja Belum Ditagih (Unbilled)*.

---

### 3.2. TransactionsPage (Transaksi & Anggaran)

`TransactionsPage.tsx` mengelola mutasi harian, filter mingguan, grafik arus kas, dan pagu anggaran per kategori.

#### A. Temuan Positif:
1. **Week Slice Pills:** Pemotongan per minggu (Minggu 1, Minggu 2, dst. dengan indikator titik hijau pada minggu berjalan) sangat membantu pengguna mengevaluasi pengeluaran mingguan tanpa harus menghitung kalender manual.
2. **Filter Bar Sticky Mobile:** Filter diletakkan di `sticky top-0 z-20` dengan latar `backdrop-blur-md`, sehingga pengguna tetap bisa memfilter dompet, kategori, atau mencari merchant saat scrolling panjang.
3. **Pemberitahuan Status Transaksi yang Lengkap:**
   - Transfer dua arah menampilkan nama dompet asal & tujuan (`Dompet A → Dompet B`) beserta biaya admin jika ada.
   - Badge status: `Transfer`, `Pembayaran Tagihan`, `Penyesuaian`, `Belum Ditagih`, `Split Pay`, dan `Split (X)` untuk transaksi pemecahan struk.
4. **Aksi Transaksi Inline:**
   - Tombol *Split Pay* langsung tersedia pada mutasi kartu kredit yang belum dipecah cicilan.
   - Konfirmasi hapus transaksi dilakukan secara inline (`Konfirmasi Hapus` / `Batal`) tanpa membuka modal terpisah yang mengagetkan.

#### B. Area Perbaikan:
1. **Pilihan Kategori Budget Tersembunyi di Bawah Grafik:**
   - Panel pengeluaran per kategori & pagu anggaran berada di sebelah grafik arus kas harian (`lg:col-span-5`). Pada layar mobile, panel ini terdorong jauh ke bawah sebelum daftar mutasi. Pengguna yang ingin memantau sisa limit kategori harus scrolling melewati grafik.
2. **Radio Button Scope Anggaran:**
   - Saat mengubah pagu kategori secara inline (baris 590–612), pengguna disodori opsi *"Template tiap bulan"* vs *"Khusus periode [gajianPeriod]"*. Opsi ini sangat powerful (zero-based budgeting override), tetapi teks radio button terlalu padat di layar ponsel sempit (360px).

---

### 3.3. WalletsPage (Dompet & Rekening)

`WalletsPage.tsx` menjadi pusat inventarisasi rekening bank, e-wallet, uang tunai, dan kartu kredit.

#### A. Temuan Positif:
1. **Hero Total Dana Likuid:**
   - Menampilkan total uang kas siap pakai tanpa menyertakan limit kartu kredit yang merupakan utang.
   - Persentase alokasi dana per dompet terhadap total likuiditas (`percentOfLiquid`) memberikan konteks visual dompet mana yang menyimpan porsi dana terbesar.
2. **Identitas Visual Penyedia Keuangan (Bank Badge):**
   - Penggunaan komponen `BankBadge` dengan palet warna dan inisial resmi (BCA, Mandiri, BRI, BNI, Jenius, GoPay, OVO, ShopeePay) memudahkan scanning visual instan tanpa harus membaca teks satu per satu.
3. **Pemisahan Kategori yang Jelas:**
   - Rekening Bank, Dompet Digital (E-Wallet), Uang Tunai (Cash), dan Kartu Kredit dipisahkan per bagian lengkap dengan subtotal masing-masing.

#### B. Area Perbaikan:
1. **Tombol "Sesuaikan Saldo" vs "Transfer":**
   - Pada kartu dompet (baris 184–199), tombol *"Sesuaikan Saldo"* memakai gaya tombol surface padat, sedangkan *"Transfer"* hanya teks link underline. Padahal bagi pengguna harian, aksi *Transfer Antar Dompet* (misal top-up GoPay dari BCA) jauh lebih sering dilakukan daripada *Rekonsiliasi/Penyesuaian Saldo*.

---

### 3.4. BudgetPage (Alokasi Anggaran 50/30/20)

`BudgetPage.tsx` menerapkan prinsip *Zero-Based Budgeting* dengan formula 50% Kebutuhan (*Needs*), 30% Keinginan (*Wants*), dan 20% Tabungan/Investasi (*Savings*).

#### A. Temuan Positif:
1. **Hero Alokasi Nol (Zero-Based):**
   - Menghitung pendapatan estimasi bulanan, jumlah yang sudah teralokasi, dan sisa uang yang belum dialokasikan (*Unallocated*).
   - Jika ada sisa alokasi, aplikasi memberi tahu berapa rupiah lagi yang harus diberi pos perencanaan.
2. **Struktur Pembagian 3 Bucket:**
   - Setiap bucket menampilkan target persentase ideal, nominal rupiah terencana, realisasi belanja aktual, dan daftar kategori kustom di bawahnya.

#### B. Area Perbaikan Kritis:
1. **Ukuran Tombol Ikon Edit & Hapus (32px):**
   - Di baris 403 dan 412:
     ```tsx
     className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] ..."
     ```
     Ukuran `h-8 w-8` (32x32px) **melanggar aturan tap target minimal 44x44px** yang digariskan di `docs/DESIGN.md`. Tombol hapus kategori yang kecil sangat riskan terpencet salah pada layar sentuh.
2. **Hardcoded Tailwind Colors:**
   - Baris 339 (`bg-amber-500`), baris 412 (`hover:bg-rose-50 dark:hover:bg-rose-950/30`).
   - Warna-warna ini harus diganti dengan token CSS: `var(--highlight)` dan `var(--destructive)`.

---

### 3.5. DebtsPage (Hutang, Piutang & Multi-CC)

`DebtsPage.tsx` adalah salah satu modul terlengkap dan paling krusial untuk mencegah kebocoran bunga kartu kredit dan kelalaian cicilan.

#### A. Temuan Positif:
1. **4 Pilar Metrik yang Komprehensif:**
   - *1. Sisa Utang Saya* (Kewajiban pokok ke pihak luar).
   - *2. Sisa Piutang Teman* (Uang talangan yang harus ditagih kembali).
   - *3. Total Terpakai CC* (Pemakaian limit gabungan kartu kredit).
   - *4. Beban Cicilan Bulan Berjalan* (Angsuran yang jatuh tempo bulan ini).
2. **Dukungan Multi-Kartu Kredit (Multi-CC Selector):**
   - Pengguna dengan beberapa kartu kredit (misal: Jenius Card & Mandiri Card) dapat berpindah kartu secara mulus melalui selector kartu.
   - Siklus cetak tagihan (*billing cycle*), tanggal jatuh tempo, pemakaian limit, dan transaksi *unbilled* per kartu dipisah secara rapi.
3. **Timeline Siklus & Arus Kas (`CycleTimeline`):**
   - Deteksi risiko otomatis: Jika tanggal jatuh tempo kartu kredit jatuh **sebelum tanggal gajian**, aplikasi menampilkan kotak peringatan berwarna oranye untuk memperingatkan pengguna agar menyiapkan kas cadangan.
4. **Modal Pelunasan Dini (Early Payoff):**
   - Mendukung pelunasan seluruh sisa pokok cicilan sekaligus dengan verifikasi saldo dompet sumber pembayaran untuk mencegah *overdraft*.

#### B. Area Perbaikan:
1. **Beban Kognitif Tinggi (Information Density):**
   - Halaman ini sangat padat. Tab filter di bagian atas (`Utang Saya`, `Piutang`, `Kartu Kredit`, `Semua Akun`) sangat membantu, namun pengguna baru bisa merasa kewalahan melihat kombinasi antara timeline siklus, daftar akun, jadwal angsuran bulanan, dan mutasi CC secara bersamaan.
   - *Rekomendasi:* Gunakan *collapsible section* atau visual stepper yang lebih bertahap.

---

### 3.6. GoalsPage (Target & Dana Darurat)

`GoalsPage.tsx` memvisualisasikan ketahanan dana darurat (*Emergency Fund Runway*) dan target resolusi keuangan.

#### A. Temuan Positif:
1. **Perhitungan Runway Bertahan Hidup (Bulan):**
   - Membagi total saldo tabungan likuid dengan rata-rata kebutuhan bulanan (*monthly needs burn rate*).
   - Memberikan angka riil ketahanan (misal: *"3.5 Bulan"*), yang jauh lebih bermakna secara psikologis daripada sekadar melihat nominal saldo tabungan.
2. **Kategori Tingkat Keamanan:**
   - *Kritis* (< 1 bulan), *Waspada* (1–3 bulan), *Aman* (3–6 bulan), *Sangat Aman* (≥ 6 bulan).

#### B. Area Perbaikan:
1. **Hardcoded Tailwind Colors:**
   - Baris 140–145 menggunakan `bg-emerald-500/20 text-emerald-600`, `bg-teal-500/20`, `bg-amber-500/20`, `bg-rose-500/20`, dan baris 157 menggunakan `text-neutral-400`.
   - Ini melanggar prinsip anti-slop `DESIGN.md` dan menyebabkan teks status sulit terbaca pada tema gelap tertentu.

---

### 3.7. AssetsPage (Aset & Kekayaan Bersih)

`AssetsPage.tsx` mengelola aset investasi (saham, reksadana, emas, kripto) dan aset fisik (kendaraan, properti, elektronik) untuk menghasilkan kalkulasi Net Worth total.

#### A. Temuan Positif:
1. **Indikator Tahap Keuangan (*Financial Stage*):**
   - Aplikasi menyematkan label tahap keuangan (misal: *Fondasi Keuangan*, *Pertumbuhan Aset*, atau *Kemandirian Finansial*) yang memberikan motivasi jangka panjang.
2. **Rasio Utang Terhadap Aset (*Debt-to-Asset Ratio*):**
   - Progress bar dwibahasa yang membandingkan porsi kepemilikan bersih (*net asset*) vs liabilitas utang.
3. **Pembaruan Nilai Taksiran Cepat (*Quick Re-Quote*):**
   - Modal cepat untuk mengupdate valuasi harga pasar aset tanpa harus membuka formulir edit lengkap.

#### B. Area Perbaikan:
1. **Tap Target Tombol Aksi:**
   - Serupa dengan `BudgetPage`, tombol update nilai dan ikon edit/hapus di baris 353, 363, 372 memiliki tinggi `32px` yang perlu dinaikkan ke minimal `44px`.

---

### 3.8. SettingsPage (Pengaturan & Konfigurasi)

`SettingsPage.tsx` menangani konfigurasi sistem, parameter gajian, biaya rutin kartu kredit, tagihan rutin, PIN aplikasi, dan ekspor data.

#### A. Temuan Positif:
1. **Pengaturan Fleksibilitas Siklus:**
   - Pengguna bisa memilih antara siklus bulanan kalender (tgl 1–akhir bulan) atau siklus gajian kustom (misal tgl 25).
   - Pengaturan cut-off CC, tanggal statement, dan tanggal jatuh tempo tagihan tersinkronisasi ke seluruh kalkulasi dashboard.
2. **Manajemen Biaya Rutin CC (Materai & Iuran Tahunan):**
   - Mendukung penambahan biaya rutin otomatis (contoh: Bea Materai Rp 10.000 jika tagihan di atas Rp 5.000.000).

#### B. Area Perbaikan:
1. **Panjang Halaman Ekstrem (1856 Baris):**
   - Komponen ini menyatukan semua form pengaturan dalam satu scroll vertikal yang sangat panjang. Di layar ponsel, mencari pengaturan ekspor data atau PIN membutuhkan scrolling panjang melewati daftar dompet dan kategori.
   - *Rekomendasi:* Kelompokkan dalam tab/sub-kategori pengaturan: `Umum & Siklus`, `Dompet & Rekening`, `Tagihan Rutin`, `Keamanan & Data`.

---

## 4. Audit Modal, Bottom Sheet & Interaksi Mikro

### 4.1. QuickAddSheet (Modal Pencatatan Cepat)

`QuickAddSheet.tsx` adalah komponen paling vital dalam interaksi harian. Pengguna berinteraksi dengan sheet ini 3–10 kali sehari.

```
┌─────────────────────────────────────────────────────────────┐
│                     QUICK ADD SHEET                         │
├─────────────────────────────────────────────────────────────┤
│ [ Pengeluaran ]  [ Pemasukan ]  [ Transfer ]  [ Bayar ]     │
│                                                             │
│ Nominal (Rp)                                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Rp 75.000                                              │ │
│ └─────────────────────────────────────────────────────────┘ │
│ Tujuh puluh lima ribu rupiah                                │
│                                                             │
│ Merchant / Toko: [ Kopi Kenangan                        ]   │
│ Kategori:        [ Makanan & Minuman                    ]   │
│ Dari Dompet:     [ BCA Harian (Saldo: Rp 1.450.000)     ]   │
│                                                             │
│ [x] Pecah Struk (Split Kategori)                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Kategori 1: Makan (Rp 50.000)                           │ │
│ │ Kategori 2: Jasa Kirim (Rp 25.000)                      │ │
│ │ Status: Pas (Selisih: Rp 0)                             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [                     Simpan Transaksi                    ] │
└─────────────────────────────────────────────────────────────┘
```

#### Keunggulan UX:
1. **Spell-Out Rupiah Otomatis:** Fitur pengejaan huruf (misal: *"Tujuh puluh lima ribu rupiah"*) menghilangkan keraguan saat mengetik angka nol pada nominal Rupiah yang panjang di Indonesia.
2. **Proteksi Saldo Defisit (Overdraft Warning):** Pada mode *Transfer* dan *Bayar Kewajiban*, jika saldo dompet sumber tidak mencukupi, tombol menampilkan peringatan jelas dan memblokir submit yang berpotensi menghasilkan saldo minus.
3. **Preset Merchant Cerdas:** Mengetik nama toko yang sering dikunjungi langsung mengisi otomatis kategori dan dompet yang biasa dipakai.

#### Catatan Usability:
1. **Mobile Virtual Keyboard Obstruction:** Pada layar ponsel dengan keyboard virtual aktif, tombol simpan di bagian bawah sheet bisa terdorong keluar layar pandang. Pengguna harus menutup keyboard terlebih dahulu untuk menekan tombol simpan.
2. **Tap Target Mode Tab:** Tab switcher mode 4 kolom di bagian atas (`Pengeluaran`, `Pemasukan`, `Transfer`, `Bayar Kewajiban`) memiliki teks agak padat pada layar 360px.

---

### 4.2. ModalSheet Dasar (`UI.tsx`)

Komponen `ModalSheet` menyediakan dasar untuk semua bottom sheet dan dialog di aplikasi:
- **Focus Trap & Keyboard Escape:** Sudah mengimplementasikan *focus trap* dan tombol `Escape` dengan sangat patuh aksesibilitas (baris 148–193).
- **Safe Area Bottom Padding:** Sudah menyertakan `pb-[calc(24px+env(safe-area-inset-bottom))]` agar tidak tertutup home bar iPhone/Android gesture bar.
- **Kekurangan:** Belum mendukung gesture *swipe-down to dismiss* (tarik ke bawah untuk menutup) yang umum dijumpai pada aplikasi modern mobile.

---

## 5. Kepatuhan Terhadap `DESIGN.md` & Prinsip Anti-Slop

### 5.1. Checklist Aturan Desain

| Aturan | Deskripsi Mandat | Status Audit | Temuan & Rekomendasi |
| :--- | :--- | :---: | :--- |
| **R-02 / R-15** | Copywriting alami tanpa buzzword atau klaim berlebihan | **PASS** | Bahasa lugas, fokus fungsional, istilah relevan lokal. |
| **R-03** | Mobile ergonomics & safe-area padding | **PASS** | Menggunakan `.safe-bottom-pad` dan `env(safe-area-inset-bottom)`. |
| **R-04** | Ikon SVG crisp 1.75px, hindari emoji dekoratif di heading | **PASS** | Semua ikon memakai SVG kustom bersudut tajam tanpa emoji di judul. |
| **R-06** | Figtree (sans) + JetBrains Mono (tabular-nums) | **PASS** | Semua angka nominal menggunakan `.tabular-nums` atau `font-mono`. |
| **R-10 / R-12** | Border datar 1px hairline, hindari glassmorphism berlebihan | **PASS** | Kartu konten bersih tanpa blur tumpuk; shadow hanya pada floating element. |
| **R-11** | Hierarki Radius: Input 10px, Card 14px, Hero 20px, Sheet 24px | **PASS** | Radius diterapkan konsisten di seluruh komponen UI. |
| **R-21 / R-34** | Dual mode Light & Dark toggle manual + system fallback | **PASS** | Toggle responsif, tersinkronisasi dengan `localStorage` dan media query. |
| **R-26 / R-32** | Aksesibilitas WCAG, tap target minimal 44x44px | **PARTIAL** | **Perlu Perbaikan:** Ditemukan tombol aksi berukuran 32px & 36px di beberapa halaman. |
| **Token CSS** | Tidak menggunakan warna hardcoded selain CSS Variables | **FAIL** | **Perlu Perbaikan:** Ditemukan warna hex dan class Tailwind mentah di 5 file komponen. |

---

### 5.2. Daftar Komponen dengan Pelanggaran Tap Target (< 44px)

Berikut adalah daftar tombol interaktif yang harus dinaikkan ukurannya agar mematuhi standar ergonomi mobile:

1. **`BudgetPage.tsx`:**
   - Baris 276: Tombol *"Tambah Kategori"* (`min-h-[34px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 403: Tombol Edit Ikon (`h-8 w-8`) -> Ubah ke `min-h-[44px] min-w-[44px]`.
   - Baris 412: Tombol Hapus Ikon (`h-8 w-8`) -> Ubah ke `min-h-[44px] min-w-[44px]`.
2. **`AssetsPage.tsx`:**
   - Baris 262: Tombol *"Tambah Aset"* (`min-h-[34px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 353: Tombol *"Update Nilai"* (`min-h-[32px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 363: Tombol Edit Ikon (`h-8 w-8`) -> Ubah ke `min-h-[44px] min-w-[44px]`.
   - Baris 372: Tombol Hapus Ikon (`h-8 w-8`) -> Ubah ke `min-h-[44px] min-w-[44px]`.
3. **`OverviewPage.tsx`:**
   - Baris 154: Tombol *"Catat Gajian"* di Net Worth hero (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 164: Tombol *"Sesuaikan Saldo Awal"* (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 229, 284: Tombol *"Cocokkan Saldo"* kartu dompet (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 453: Tombol *"Bayar Sekarang"* tagihan rutin (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
4. **`RecentTransactionsWidget.tsx`:**
   - Baris 35: Tombol link *"Lihat Semua"* (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
   - Baris 56: Tombol empty state *"Catat Transaksi"* (`min-h-[36px]`) -> Ubah ke `min-h-[44px]`.
5. **`SettingsPage.tsx`:**
   - Baris 150: Tombol hapus fee rutin (`h-8 w-8`) -> Ubah ke `min-h-[44px] min-w-[44px]`.

---

### 5.3. Daftar Komponen dengan Pelanggaran Hardcoded Token Warna

Warna-warna berikut mem-bypass CSS Variables dan berisiko gagal kontras di mode gelap:

1. **`Budget503020Progress.tsx`:**
   - Baris 65: `text-[#00797a]` -> Ganti dengan `text-[var(--primary)]`.
   - Baris 129, 163: `bg-[#a42423]` -> Ganti dengan `bg-[var(--destructive)]`.
   - Baris 131, 165: `bg-[#ff8a00]` -> Ganti dengan `bg-[var(--highlight)]`.
   - Baris 132: `bg-[#00797a]` -> Ganti dengan `bg-[var(--primary)]`.
   - Baris 166: `bg-[#059488]` -> Ganti dengan `bg-[var(--primary)]`.
   - Baris 204: `bg-[#009267]` -> Ganti dengan `bg-[var(--chart-income)]`.
2. **`GoalsPage.tsx`:**
   - Baris 140–145: Raw Tailwind `bg-emerald-500/20 text-emerald-600 dark:text-emerald-300`, `bg-teal-500/20`, `bg-amber-500/20`, `bg-rose-500/20` -> Ganti dengan token semantik badge: `soft`, `primary`, `highlight`, `danger`.
   - Baris 157: `text-neutral-400` -> Ganti dengan `text-[var(--hero-card-muted)]`.
3. **`AssetsPage.tsx`:**
   - Baris 317: `text-emerald-500` / `text-rose-500` -> Ganti dengan `text-[var(--chart-income)]` dan `text-[var(--destructive)]`.
   - Baris 438: `text-[#009267] dark:text-emerald-400` -> Ganti dengan `text-[var(--chart-income)]`.
4. **`CycleTimeline.tsx`:**
   - Baris 109: `border-l-[#e16c10]` -> Ganti dengan `border-l-[var(--chart-expense)]`.
   - Baris 111: `border-l-[#009267]` -> Ganti dengan `border-l-[var(--chart-income)]`.
   - Baris 115: `border-l-[#2d54bc]` -> Ganti dengan `border-l-[var(--primary)]`.
5. **`CalendarActivityGrid.tsx`:**
   - Baris 127: `bg-[#fb7185]` -> Ganti dengan `bg-[var(--destructive)]`.

---

## 6. Penyederhanaan Terminologi Keuangan Bahasa Indonesia

Pengguna aplikasi finansial harian di Indonesia sering kali merasa terintimidasi oleh jargon akuntansi atau istilah perbankan asing. Berikut adalah tabel standarisasi glosarium istilah UI yang direkomendasikan untuk seluruh aplikasi:

### Tabel Glosarium & Standardisasi Microcopy

| Istilah Teknis / Asing | Label Rekomendasi di UI | Penjelasan Singkat (Tooltip / Microcopy) |
| :--- | :--- | :--- |
| **Safe-to-Spend** | **Jatah Belanja Aman** (atau **Uang Bebas Jajan**) | Sisa uang kas belanja dibagi sisa hari sampai gajian, setelah dikurangi komitmen tagihan dan cicilan. |
| **Total Liquid Cash** | **Total Kas Siap Pakai** | Jumlah uang tunai, saldo rekening bank, dan e-wallet yang bisa langsung dibelanjakan detik ini juga. |
| **Savings / Locked Cash** | **Tabungan Aman (Terkunci)** | Dana yang sengaja dipisahkan agar tidak terpakai untuk belanja harian (misal: dana darurat, deposito). |
| **Net Worth** | **Kekayaan Bersih** | Total seluruh aset (kas + investasi + properti/kendaraan) dikurangi seluruh kewajiban utang & tagihan CC. |
| **Unbilled CC** | **Belanja CC Belum Ditagih** | Transaksi kartu kredit pada siklus berjalan yang baru akan ditagihkan pada tanggal cetak tagihan berikutnya. |
| **Billed CC / Statement** | **Tagihan CC Siklus Ini** | Total belanja kartu kredit yang sudah resmi dicetak dan wajib dibayar sebelum tanggal jatuh tempo. |
| **Card Cut-off / Billing Date**| **Tanggal Cetak Tagihan** | Tanggal bank menutup mutasi bulanan kartu kredit dan menerbitkan lembar tagihan resmi. |
| **Card Payment Due Date** | **Jatuh Tempo Pembayaran** | Batas hari terakhir membayar tagihan kartu kredit agar terhindar dari denda dan bunga perbankan. |
| **Reserved Cash (CC)** | **Cadangan Pembayaran CC** | Uang di rekening bank yang sudah disisihkan untuk melunasi transaksi kartu kredit saat jatuh tempo tiba. |
| **50/30/20: Needs** | **Kebutuhan Pokok (50%)** | Pengeluaran wajib untuk bertahan hidup (makan harian, listrik, sewa tempat tinggal, transportasi kerja). |
| **50/30/20: Wants** | **Keinginan & Gaya Hidup (30%)** | Belanja hiburan, nongkrong di kafe, hobi, langganan streaming, dan liburan. |
| **50/30/20: Savings** | **Tabungan & Masa Depan (20%)** | Alokasi untuk dana darurat, investasi reksadana/saham, dan persiapan masa depan. |
| **Runway (Dana Darurat)** | **Ketahanan Bertahan Hidup** | Perkiraan berapa bulan Anda bisa bertahan hidup jika hari ini kehilangan penghasilan utama. |
| **Reconcile Wallet** | **Cocokkan Saldo M-Banking** | Membandingkan saldo catatan di aplikasi dengan angka mutasi asli di aplikasi bank agar tidak ada selisih. |
| **Split Pay** | **Ubah ke Cicilan Bulanan** | Memecah pembayaran kartu kredit besar menjadi cicilan tetap beberapa bulan agar arus kas tidak kaget. |
| **Overdraft Warning** | **Saldo Kas Tidak Cukup** | Saldo rekening yang Anda pilih lebih kecil daripada tagihan atau transfer yang ingin dilakukan. |

---

## 7. Rekomendasi Wireframe & Restrukturisasi Layout

### 7.1. Restrukturisasi Hero Section pada `OverviewPage`

Untuk mengembalikan fokus pengguna ke pengelolaan kas harian, susunan vertikal `OverviewPage` direkomendasikan diubah:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SEBELUM (Current Layout):                                                   │
│ 1. [ Net Worth Hero Card ] -> Menampilkan Total Kekayaan Bersih             │
│ 2. [ Kas Belanja Harian ]  -> Grid dompet bank & e-wallet                   │
│ 3. [ Tabungan Aman ]       -> Grid dompet tabungan                          │
│ 4. [ 50/30/20 Budgeting ]  -> Dial hari & progress bar alokasi             │
│ 5. [ Kalender & Mutasi ]   -> Aktivitas belanja                             │
│ 6. [ Kewajiban & CC ]      -> Tagihan terdekat & kartu kredit               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ SESUDAH (Recommended Layout):                                               │
│ 1. [ DailyHeroCard (Safe-to-Spend) ] -> FOKUS UTAMA HARIAN                  │
│    - Jatah Belanja Hari Ini: Rp 125.000 / hari                              │
│    - Total Kas Bebas Belanja: Rp 2.500.000 (sisa 20 hari sampai gajian)     │
│    - Pengeluaran Hari Ini: Rp 45.000 (Terkendali / Hemat)                   │
│                                                                             │
│ 2. [ Strip Status Cepat Arus Kas ]:                                         │
│    - Kas Siap Pakai: Rp 4.200.000 │ Cadangan Tagihan CC: Rp 1.700.000       │
│                                                                             │
│ 3. [ 50/30/20 Pacing & Budget Barometer ]                                   │
│                                                                             │
│ 4. [ Kalender Aktivitas & Transaksi Terbaru (Grid 7:5) ]                    │
│                                                                             │
│ 5. [ Grid 2 Kolom: Kewajiban Pembayaran (Kiri) & Kontrol CC (Kanan) ]       │
│                                                                             │
│ 6. [ Widget Kompak Ringkasan Kekayaan Bersih (Net Worth Mini-Bar) ]         │
│    - Net Worth: Rp 145.000.000 (Aset: Rp 160jt - Utang: Rp 15jt)           │
│    - Tautan cepat: "Buka Analisis Portofolio & Aset →"                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 7.2. Perbaikan Ergonomi Mobile Bottom Navigation Bar

Navigasi bawah mobile saat ini menyembunyikan 5 menu utama di balik satu tombol `"Menu"`. Pengguna sering mengeluh harus membuka modal terlebih dahulu untuk memeriksa cicilan kartu kredit atau target dana darurat.

```
Usulan Optimasi Tab Navigasi Bawah (5 Slot):

┌─────────────────────────────────────────────────────────────────┐
│  [ Home ]    [ Transaksi ]     (+)      [ Kartu/Utang ] [ Lainnya]│
│  Overview      Mutasi        Catat       Multi-CC &     Drawer   │
│                             Cepat        Cicilan        (Aset,   │
│                                                         Budget,  │
│                                                         Goals)   │
└─────────────────────────────────────────────────────────────────┘
```
- **Alasan:** Fitur *Kartu & Utang* memiliki interaksi pembayaran siklus bulanan yang sangat sering diakses, sehingga lebih layak mendapatkan slot langsung di Bottom Bar menggantikan tab Dompet (karena saldo dompet sudah terlihat jelas di halaman Home).

---

## 8. Panduan Microcopy yang Bersahabat & Positif

Pencatatan keuangan rentan memicu stres psikologis (*financial anxiety*). Microcopy yang digunakan harus memberi dorongan positif dan kejelasan tindakan:

1. **Ketika Belanja Hari Ini Masih Kosong (Pagi/Siang):**
   - *Teks Sekarang:* `"Belum ada pengeluaran hari ini."`
   - *Rekomendasi:* `"Arus kas terjaga. Anda masih memiliki kuota Rp 120.000 untuk dibelanjakan hari ini."`
2. **Ketika Kategori Mendekati Limit 80%:**
   - *Teks Sekarang:* `"Mendekati batas (84%)"`
   - *Rekomendasi:* `"Anggaran Makanan terpakai 84%. Sisa Rp 160.000 aman untuk 4 hari ke depan."`
3. **Ketika Terjadi Overbudget:**
   - *Teks Sekarang:* `"Lewat batas (112%)"`
   - *Rekomendasi:* `"Melebihi anggaran Rp 50.000. Sesuaikan batas atau kurangi pos keinginan di minggu ini."`
4. **Ketika Tagihan Kartu Kredit Lunas:**
   - *Teks Rekomendasi:* `"Hebat! Kartu kredit lunas tanpa bunga. Anda menghemat estimasi bunga perbankan bulan ini."`
5. **Saat Menambah Rekening Dompet Baru:**
   - *Teks Placeholder:* `"Contoh: Rekening Operasional BCA, Dompet Uang Kas"`
   - *Petunjuk:* `"Pilih peran dompet: Kas Belanja untuk mutasi harian, atau Tabungan agar saldo terlindungi dari perhitungan uang jajan."`

---

## 9. Rencana Aksi Implementasi Perbaikan (Action Plan)

Perbaikan dikelompokkan ke dalam 3 level prioritas:

### Prioritas P0 (Mendesak / Bug & Pelanggaran Standar Desain):
1. **Pemasangan `DailyHeroCard` di `OverviewPage`:**
   - Kembalikan komponen `DailyHeroCard` sebagai fokus teratas `OverviewPage` untuk menampilkan *Daily Allowance*, *Safe-to-Spend*, dan *Pengeluaran Hari Ini*.
   - Ubah `NetWorthHeroCard` di Overview menjadi kartu ringkasan kompak di bagian bawah halaman dengan link menuju tab *Aset & Net Worth*.
2. **Penghapusan Seluruh Hardcoded Colors:**
   - Bersihkan seluruh warna hex dan class Tailwind mentah di `Budget503020Progress.tsx`, `GoalsPage.tsx`, `AssetsPage.tsx`, `CycleTimeline.tsx`, dan `CalendarActivityGrid.tsx`.
   - Ganti sepenuhnya dengan variabel tema: `var(--primary)`, `var(--highlight)`, `var(--destructive)`, `var(--chart-income)`, dan `var(--chart-expense)`.
3. **Normalisasi Tap Target Mobile (Minimal 44x44px):**
   - Perbesar padding dan area sentuh tombol edit/hapus di `BudgetPage`, `AssetsPage`, `OverviewPage`, dan `SettingsPage` menjadi minimal `44px`.

### Prioritas P1 (Dampak UX Tinggi):
1. **Standardisasi Microcopy & Integrasi Tooltip Bantuan:**
   - Terapkan komponen `HelpTooltip` pada label-label yang rentan membingungkan (*Jatah Belanja Aman*, *Unbilled CC*, *Cadangan Kas CC*, *Runway Dana Darurat*).
2. **Optimasi Mobile Menu Navigation:**
   - Berikan indikator visual aktif yang jelas pada tombol Menu jika pengguna sedang berada di salah satu sub-halaman (*Budget*, *Goals*, *Assets*, *Debts*).
3. **Penyempurnaan Feedback Toast & Notifikasi Aksi:**
   - Pastikan toast memiliki ikon status sukses/peringatan dan durasi tampil yang cukup (3 detik) agar terbaca jelas oleh pengguna ponsel.

### Prioritas P2 (Polesan Estetika & Keunggulan Interaksi):
1. **Dukungan Gesture Mobile Sheet:**
   - Tambahkan *drag handle* visual di bagian atas `ModalSheet` dan pertimbangkan penambahan gesture swipe-down untuk menutup dialog.
2. **Onboarding Empty State yang Edukatif:**
   - Tambahkan ilustrasi tipografi minimalis dan panduan langkah pertama (1. Tambah Dompet -> 2. Atur Gaji -> 3. Catat Transaksi Pertama) saat database masih kosong.

---

## 10. Kesimpulan

Secara fondasi teknis dan visual, project **Financial Tracker** telah memiliki sistem arsitektur UI yang sangat solid: tata letak responsif, dukungan tema Terang/Gelap, tipografi angka *tabular-nums* yang rapi, dan sistem pencegahan *overdraft* yang matang.

Dengan menerapkan rekomendasi perbaikan P0 dan P1 di atas—khususnya mengembalikan **Daily Allowance (Safe-to-Spend)** sebagai jangkar utama *Overview*, merapikan **token warna WCAG AA**, menaikkan **tap target ke 44px**, serta menyederhanakan **terminologi perbankan ke bahasa sehari-hari**—aplikasi ini akan mencapai tingkat kenyamanan dan kepuasan pengguna (*user satisfaction*) yang optimal bagi pengelolaan finansial harian di Indonesia.
