# PRD — Milestone 9: Manajemen Dompet Terkelompok & Modal Transaksi Cepat Ala Budggt

## 1. Latar Belakang & Masalah

Pada aplikasi pelacak keuangan modern seperti **Budggt**, pengelolaan dompet (*wallets*) dan pencatatan transaksi (*quick add*) merupakan dua pintu gerbang interaksi yang paling sering disentuh oleh pengguna:

1. **Dompet Belum Terkelompok Berdasarkan Sifat Likuiditasnya:**
   Saat ini, daftar dompet masih flat tanpa pengelompokan yang jelas antara **Kas Tunai**, **Rekening Bank Harian**, **E-Wallet Belanja**, dan **Kredit/Paylater**. Akibatnya, pengguna sulit melihat total saldo riil yang benar-benar likuid dan siap dibelanjakan.
2. **Ketiadaan Identitas Provider Finansial Indonesia:**
   Pengguna di Indonesia sangat familiar dengan visual brand bank dan e-wallet (BCA, Mandiri, BRI, BNI, Jago, SeaBank, Blu, GoPay, OVO, DANA, ShopeePay). Tanpa logo/badge provider, daftar dompet terlihat monoton dan sulit dikenali secara cepat.
3. **Form Transaksi Baru (Quick Add) Perlu Disederhanakan:**
   Form input transaksi saat ini perlu diselaraskan dengan UX Budggt: tab yang jelas antara **Pengeluaran**, **Pemasukan**, **Transfer**, dan **Bayar Tagihan/Kewajiban**, dengan shortcut tanggal cepat (*Hari Ini*, *Kemarin*) dan dukungan pencatatan **Biaya Admin (Transfer Fee)** otomatis (misal biaya BI-FAST Rp 2.500).
4. **Fitur Rekonsiliasi / Sesuaikan Saldo Dompet:**
   Saldo dompet fisik kadang berbeda dengan catatan aplikasi karena pembulatan atau lupa catat nominal kecil. Pengguna membutuhkan tombol aksi *Sesuaikan Saldo* (*Reconcile*) yang transparan dan mencatat selisihnya sebagai penyesuaian (*adjustment*) tanpa merusak metrik pengeluaran 50/30/20.

---

## 2. Tujuan Milestone

1. **Pengelompokan Dompet Terstruktur (*Categorized Accounts*):**
   - Mengelompokkan dompet menjadi:
     - **Kas & Tabungan Bank** (BCA, Mandiri, BRI, BNI, Jago, Tunai, dsb.)
     - **E-Wallet** (GoPay, OVO, DANA, ShopeePay)
     - **Kartu Kredit & Pinjaman** (Limit terpakai / utang aktif)
   - Menampilkan total saldo per grup dan grand total saldo likuid di bagian atas.
2. **Badge & Identitas Visual Provider Indonesia (`BankBadge.tsx`):**
   - Menghadirkan ikon/badge visual untuk institusi keuangan utama Indonesia: BCA, Mandiri, BNI, BRI, Jago, SeaBank, Blu, GoPay, OVO, DANA, ShopeePay, Kas Tunai, dan Lainnya.
3. **Redesain Modal Transaksi Cepat (`QuickAddSheet.tsx`):**
   - 4 Tab intuitif: **Pengeluaran**, **Pemasukan**, **Transfer**, **Bayar Kewajiban**.
   - Input nominal besar berformat Rupiah dengan keyboard friendly.
   - Pilihan kategori dengan pill badge pembagian bucket 50/30/20 (Kebutuhan vs Keinginan).
   - Pada tab Transfer, sediakan opsi **Biaya Admin** yang otomatis mendebit rekening asal.
4. **Fitur Rekonsiliasi Saldo Dompet (Penyesuaian Saldo Cepat):**
   - Aksi 1-klik di kartu dompet untuk update saldo aktual langsung ke angka riil.
5. **Tetap Terintegrasi dengan Engine Arus Kas & Utang:**
   - Semua mutasi dompet otomatis sinkron dengan grafik arus kas, timeline gajian, dan proteksi saldo minimum.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Skema Database & Model (`schema.ts`)
- Perluas tabel `wallets`:
  - `accountGroup`: `text("account_group", { enum: ["cash", "bank", "ewallet", "credit", "other"] }).notNull().default("bank")`
  - `provider`: `text("provider", { enum: ["bca", "mandiri", "bni", "bri", "jago", "seabank", "blu", "gopay", "ovo", "dana", "shopeepay", "cash", "other"] }).notNull().default("cash")`
- Tambahkan migrasi Drizzle untuk kolom baru.

### B. Shared DTOs & Types (`app/shared/src/`)
- Perbarui `WalletDto`:
  ```typescript
  export type AccountGroup = "cash" | "bank" | "ewallet" | "credit" | "other";
  export type WalletProvider = "bca" | "mandiri" | "bni" | "bri" | "jago" | "seabank" | "blu" | "gopay" | "ovo" | "dana" | "shopeepay" | "cash" | "other";
  ```
- Tambahkan field `adminFee?: number` pada `CreateTransactionDto` untuk tipe transaksi transfer.

### C. Komponen UI Frontend
- **`BankBadge.tsx`**:
  - Komponen visual yang merender badge warna brand dan logo/inisial untuk setiap provider (misal: BCA biru tua, Mandiri kuning-emas/navy, Jago oranye/kuning neon, GoPay hijau/biru, dsb.).
- **`WalletsPage.tsx` / `WalletList.tsx`**:
  - Grouping accordion/section per kategori akun.
  - Kartu dompet modern dengan aksen warna, nominal saldo (mendukung privacy mask `Rp •••••••`), tombol edit, dan tombol sesuaikan saldo.
  - Dialog Rekonsiliasi Saldo: masukkan saldo fisik terbaru -> buat penyesuaian otomatis.
- **`QuickAddSheet.tsx` (Redesain Modal Transaksi):**
  - Tab 1: **Pengeluaran** (Nominal, Kategori 50/30/20, Dompet Sumber, Tanggal, Catatan).
  - Tab 2: **Pemasukan** (Nominal, Kategori Pendapatan, Dompet Tujuan, Tanggal, Catatan).
  - Tab 3: **Transfer** (Dompet Asal, Dompet Tujuan, Nominal, Biaya Admin opsional, Tanggal, Catatan).
  - Tab 4: **Bayar Kewajiban** (Pilih tagihan CC / cicilan utang aktif, pilih dompet bayar, 1-klik lunas).

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Pengguna dapat membuat, mengedit, dan menghapus dompet dengan memilih grup akun dan provider Indonesia yang sesuai.
- [ ] Daftar dompet terkelompok rapi (Bank, E-Wallet, Kas Tunai, Kredit) dengan subtotal saldo masing-masing.
- [ ] Komponen `BankBadge` menampilkan visual brand provider Indonesia yang jelas dan mudah dibedakan.
- [ ] Pengguna dapat melakukan rekonsiliasi saldo dompet secara instan dengan pencatatan selisih yang rapi.
- [ ] Modal Transaksi Cepat memiliki 4 tab fungsional (Pengeluaran, Pemasukan, Transfer dengan biaya admin, Bayar Kewajiban).
- [ ] Seluruh transaksi baru langsung memperbarui sisa budget harian, bar 50/30/20, dan kalender aktivitas di dashboard secara real-time.
- [ ] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus tanpa error.
