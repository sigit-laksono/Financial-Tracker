# PRD — Milestone 3: Pencatatan Harian Cepat, Split Category, Recurring Bills & Atomic Transfer

## 1. Latar Belakang & Masalah

Agar aplikasi benar-benar dipakai setiap hari untuk mencatat jajan, kebutuhan hidup, dan transfer antar bank/e-wallet, gesekan input harus seminimal mungkin dan struktur transaksi harus mendukung skenario belanja nyata:

1. **Satu struk sering multi-kategori** (misal belanja Indomaret Rp150.000 terdiri dari Makanan Rp100.000 + Kebutuhan Kucing Rp50.000), sementara `transactions` di `schema.ts` baru mendukung 1 category per transaksi.
2. **Transfer dengan biaya admin di `cashLedger.ts` menghasilkan 2 baris** (transfer + expense Biaya Bank) lewat `transferGroupId`, namun tampilan dan aksi edit/hapus perlu dipastikan atomik agar tidak meninggalkan baris biaya admin yatim.
3. **Tagihan rutin bulanan (Internet, Listrik, Paket Data, Langganan) belum terjadwal** sebagai proyeksi kewajiban awal siklus.
4. **Input transaksi di `QuickAddSheet.tsx` belum memiliki shortcut** untuk kebiasaan rutin (jajan harian & rute transfer favorit seperti BNI $\rightarrow$ GoPay, BNI $\rightarrow$ BCA, BNI $\rightarrow$ Jenius).

## 2. Tujuan Milestone

1. **Mendukung Split Category** dalam satu transaksi pengeluaran.
2. **Menyediakan Atomic Transfer Group** (tampilan gabungan + edit/hapus atomik + shortcut transfer/top-up 1-tap).
3. **Menambahkan Recurring Bills / Tagihan Rutin** agar proyeksi kewajiban siklus langsung terlihat sejak tanggal 25.
4. **Mempercepat pencatatan harian menjadi < 5 detik** lewat template transaksi cepat dan auto-suggest kategori dari riwayat merchant.

## 3. Ruang Lingkup Fungsional

### A. Split Category pada 1 Transaksi (`transaction_splits`)
- Tambah tabel `transactionSplits` (`id`, `transactionId`, `category`, `categoryId`, `amount`, `note`).
- Validasi server: jumlah seluruh `splits.amount` harus sama persis dengan `transactions.amount`.
- Agregasi kategori di `dashboardQuery.ts` dan budgets membaca dari `transactionSplits` jika tersedia, atau fallback ke `transactions.category` jika tidak di-split.

### B. Atomic Transfer & 1-Tap Transfer/Top-Up Preset
- Pada daftar transaksi (`TransactionsPage`), baris transfer dan baris expense biaya admin yang memiliki `transferGroupId` sama digabungkan tampilannya menjadi satu kartu (`BNI → GoPay · Rp500.000 (+Admin Rp2.500)`).
- Mengedit atau menghapus transfer otomatis memperbarui/menghapus kedua record dalam `transferGroupId` secara atomik dalam 1 DB transaction.
- Tambah Quick Transfer Chips di tab Transfer `QuickAddSheet` (diambil dari kombinasi `fromWalletId → toWalletId` yang paling sering digunakan atau preset tersimpan, lengkap dengan default admin fee misalnya Rp0 atau Rp2.500).
- Tambah tombol Cocokkan Saldo Cepat langsung di kartu dompet di `OverviewPage` yang memanggil modal `ReconcileModal`.

### C. Tagihan Rutin (`recurring_rules`)
- Tambah tabel `recurringRules` (`id`, `name`, `amount`, `categoryId`, `walletId`, `dueDay`, `isMandatory`, `isActive`).
- Contoh: Listrik tgl 5, Internet tgl 10, Paket Data tgl 26, Langganan tgl 15.
- Di `dashboardQuery.ts`: tagihan rutin yang belum dibayar pada siklus berjalan otomatis masuk ke daftar "Proyeksi Tagihan Rutin Siklus Ini" (sehingga mempengaruhi proyeksi jatah aman) dan muncul sebagai pengingat 1-klik "Bayar Sekarang" untuk langsung mencetak transaksinya.

### D. Quick Input < 5 Detik & Auto-Categorize
- Endpoint ringkas `GET /api/transactions/suggestions?q=...` (atau dari cache transaksi terbaru) untuk:
  - Menampilkan 4–6 Template Cepat (berdasarkan transaksi/rute tersering).
  - Auto-fill `category` dan `walletId` terakhir saat user mengetik nama merchant yang pernah dicatat sebelumnya.
- Tambah tombol Preset Nominal Cepat (+10rb, +25rb, +50rb, +100rb) di `QuickAddSheet` agar input di HP lebih cepat.

## 4. Kriteria Penerimaan (Acceptance Criteria)

- Transaksi Rp150.000 yang di-split Rp100.000 (Makanan & Minuman) + Rp50.000 (Kebutuhan Kucing) mengurangi saldo dompet Rp150.000, namun membagi pemakaian budget ke masing-masing kategori secara tepat.
- Menghapus transaksi transfer BNI $\rightarrow$ GoPay yang memiliki biaya admin Rp2.500 otomatis menghapus transfer dan biaya adminnya sekaligus tanpa menyisakan selisih saldo.
- Tagihan rutin yang belum dibayar pada siklus aktif muncul di proyeksi kewajiban & bisa dicatat dalam 1 klik.
- Mencatat transaksi jajan berulang dari `QuickAddSheet` dapat diselesaikan maksimal dalam 3 tap.
