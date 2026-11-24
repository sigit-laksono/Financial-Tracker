# PRD — Milestone 2: Hutang & Piutang, Upgrade Pinjaman, Multi-CC & Timeline Siklus

## 1. Latar Belakang & Masalah

Saat ini `schema.ts` dan `debtEngine.ts` sudah menangani utang cicilan dan Split Pay, tetapi masih memiliki keterbatasan:

1. **Belum ada Piutang (Receivables)**: Meminjamkan uang ke teman atau menalangi biaya kantor tercatat sebagai expense biasa sehingga merusak evaluasi boros dan laporan pengeluaran.
2. **Flexi Cash / Pinjaman belum lengkap**: Tidak ada pencatatan pencairan awal (disbursement), pemisahan pokok vs bunga, maupun pelunasan dipercepat (early payoff).
3. **Asumsi Single Credit Card & Biaya Bank Global**: `ledgerSnapshot.ts` memakai `.find(w => w.type === "credit_card")` tunggal dan `ccBilling.ts` meng-hardcode `BANK_FEES` (Materai & Notifikasi) secara global.
4. **Timeline Jatuh Tempo Siklus Hilang**: Tampilan kronologis tanggal penting (20 Tutup buku CC $\rightarrow$ 21 Tagihan cetak $\rightarrow$ 23 Flexi Cash $\rightarrow$ 25 Gaji & bayar CC) belum tersedia di UI aktif.

## 2. Tujuan Milestone

1. **Menyediakan fitur Hutang & Piutang lengkap** (termasuk pinjaman ke pihak lain, talangan/reimburse, dan penerimaan cicilan balik).
2. **Melengkapi siklus hidup pinjaman tunai** seperti Flexi Cash Jenius (pencairan awal tanpa dianggap gaji, rincian pokok vs bunga, dan early payoff).
3. **Mendukung Multi-Kartu Kredit** dan konfigurasi biaya rutin per kartu.
4. **Mengembalikan Timeline Siklus Tagihan & Gajian** di Ringkasan / Kartu & Utang agar tidak ada jatuh tempo yang terlewat.

## 3. Ruang Lingkup Fungsional

### A. Hutang & Piutang (`direction: payable | receivable`)
- Menambah kolom `direction` pada `debtAccounts`: `"payable"` (kita berutang) atau `"receivable"` (orang lain berutang ke kita).
- Menambah jenis transaksi khusus atau flag aliran kas agar:
  - **Memberi Pinjaman / Talangan (receivable baru)**: Mengurangi saldo dompet asal (disbursement) tanpa masuk ke statistik `totalExpense` dan tanpa memotong budget kategori belanja.
  - **Menerima Pengembalian Piutang**: Menambah saldo dompet tujuan (collection) tanpa masuk ke statistik `totalIncome`, dan mengurangi sisa piutang.
- Di `DebtsPage`, pisahkan tab/section Utang Saya dan Piutang (Tagih Balik) beserta ringkasan Net Debt Position.

### B. Upgrade Pinjaman (Flexi Cash) & Early Payoff
- Menambah kolom opsional pada `debtAccounts` & `installments`:
  - `principalAmount` & `interestAmount` per cicilan (default `interestAmount = 0` untuk cicilan 0% / utang kantor).
  - Opsi Catat Pencairan ke Dompet saat membuat utang `loan` baru (misal Flexi Cash cair Rp8.600.000 masuk ke saldo Jenius, tanpa dihitung sebagai income gaji).
  - Menambah aksi **Pelunasan Dipercepat / Tutup Utang**: user bisa melunasi sisa saldo sekaligus dalam 1 transaksi settlement dan otomatis menutup jadwal cicilan mendatang.

### C. Dukungan Multi-CC & Konfigurasi Biaya Kartu
- Menghilangkan ketergantungan pada single `ccWallet` di `ledgerSnapshot.ts`, `dashboardQuery.ts`, `debtEngine.ts`, dan `ccBilling.ts`.
- Agregasi tagihan dan limit CC dihitung per `walletId` untuk semua dompet bertipe `credit_card`.
- Memindahkan biaya rutin kartu (misal Materai Rp10.000, Notifikasi Rp12.500) menjadi konfigurasi per dompet CC (kolom JSON/tabel `walletRecurringFees`) agar bisa diaktifkan, diubah nominalnya, atau dimatikan per kartu.

### D. Timeline Siklus Tagihan & Gajian
- Endpoint dashboard/debts mengembalikan daftar Milestone Tanggal Siklus (`cycleTimeline`) yang disusun dinamis dari:
  - `cutoffDay`, `statementDay`, & `paymentDay` tiap kartu kredit aktif.
  - `paymentDay` tiap akun utang/piutang aktif (misal tgl 23 Flexi Cash).
  - `gajianStartDay` (tgl 25 gajian & bayar kewajiban).
- Setiap node menampilkan tanggal, nama event, nominal estimasi/aktual, dan status (`done` | `due_today` | `upcoming` | `overdue`).

## 4. Kriteria Penerimaan (Acceptance Criteria)

- Mencatat piutang baru Rp500.000 dari BCA menurunkan saldo BCA Rp500.000, menambah total Piutang Rp500.000, dan tidak menambah `totalExpense` siklus berjalan.
- Menerima pembayaran piutang Rp500.000 ke GoPay menaikkan saldo GoPay Rp500.000, melunasi piutang, dan tidak menambah `totalIncome`.
- Mencatat pencairan Flexi Cash ke Jenius menaikkan saldo Jenius sekaligus utang Flexi Cash tanpa mengacaukan angka gaji/income.
- Pelunasan dipercepat melunasi seluruh cicilan upcoming tersisa dalam 1 aksi atomik.
- Timeline siklus tampil rapi di mobile (scroll/vertical stepper) dan desktop (horizontal stepper) dengan status akurat.
