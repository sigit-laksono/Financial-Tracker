# PRD — Milestone 1: Perbaikan Akurasi Cashflow & Siklus Gajian

## 1. Latar Belakang & Masalah

Saat ini `dashboardQuery.ts` menghitung `safeToSpend = totalLiquidCash - remainingObligations` dan menampilkan saldo seluruh dompet non-CC sebagai kas yang siap dibelanjakan. Ada tiga bias utama dalam memantau apakah siklus gajian (tgl 25 – tgl 24) boros atau aman:

1. **Saldo tabungan/dana darurat ikut terhitung ke `totalLiquidCash`**, sehingga `safeToSpend` tampak besar meski cashflow siklus berjalan defisit.
2. **Belanja CC unbilled (terutama setelah tutup buku tgl 20) belum langsung mengunci kas** di siklus berjalan karena `unpaidCcCycles` hanya memasukkan tagihan yang `dueDate <= bounds.end`.
3. **Potongan gaji utang kantor (payroll) pada `ensurePayrollAutoPaid` masih terpisah dari pencatatan penerimaan gaji** (income tgl 25) dan masih bergantung pada angka statis `appSettings.payrollDeduction`.

## 2. Tujuan Milestone

1. **Memisahkan Dompet Harian (spending) vs Tabungan/Dana Darurat (savings)** agar angka kas siap pakai akurat.
2. **Menghadirkan metrik Sisa Jatah Siklus Ini, Cycle Pacing** (% waktu siklus vs % belanja variabel terpakai), dan **Jatah Aman Harian (Daily Burn Rate)**.
3. **Menutup ilusi saldo aman dari kartu kredit lewat CC Payment Reserve** (belanja CC langsung mencadangkan kas bayar tagihan).
4. **Menyediakan alur 1-Klik Terima Gaji** yang otomatis menghitung `Gaji Kotor - Cicilan Payroll Jatuh Tempo = Gaji Bersih` dan melunasi cicilan kantor periode terkait.

## 3. Ruang Lingkup Fungsional

### A. Peran Dompet (`walletRole`)
- Menambah kolom `role` pada tabel `wallets` (`"spending"` | `"savings"` | `"credit_card"`, default `"spending"` untuk bank/ewallet/cash dan `"credit_card"` untuk CC).
- `totalSpendableCash` hanya menjumlahkan dompet aktif dengan `role === "spending"`.
- `totalSavingsCash` menjumlahkan dompet dengan `role === "savings"`.
- Total kekayaan kas (`totalLiquidCash`) tetap tersedia sebagai informasi sekunder.

### B. CC Payment Reserve
- Setiap transaksi expense di dompet `credit_card` (yang belum lunas dan tidak dikonversi menjadi cicilan) dihitung sebagai Cadangan Bayar CC (`ccReservedCash`), baik yang sudah tercetak statement maupun yang masih unbilled.
- `safeToSpend` memakai `totalSpendableCash - unpaidInstallmentsSum - unpaidCcTotalAllCycles`, sehingga belanja CC hari ini langsung menurunkan kas bebas pakai.

### C. Cycle Pacing & Evaluasi "Boros atau Tidak"
- Mengelompokkan pengeluaran siklus gajian menjadi:
  - **Wajib / Tetap (mandatory)**: kategori dengan `categories.isMandatory = true` + pembayaran tagihan/cicilan.
  - **Variabel / Gaya Hidup (discretionary)**: kategori non-wajib (Jajan, Makanan & Minuman, Belanja, Hiburan, Perjalanan, dll).
- Menghitung untuk siklus berjalan:
  - `daysElapsed`, `daysTotal`, `daysRemaining`, dan `timeProgressPercent`.
  - `cycleAllowance` (pemasukan siklus + saldo awal belanja yang dialokasikan - kewajiban tetap siklus).
  - `cycleRemaining` dan `dailyAllowance` (`Math.max(0, Math.floor(cycleRemaining / daysRemaining))`).
  - `pacingStatus`: `"hemat"` | `"sesuai_jalur"` | `"agak_boros"` | `"overpace"` berdasarkan selisih % pemakaian vs % hari berjalan.
  - Perbandingan Siklus Ini vs Siklus Sebelumnya pada jumlah hari berjalan yang sama (`dayN`).

### D. 1-Klik Terima Gaji & Sinkronisasi Payroll
- Menambahkan endpoint untuk memproses gajian siklus tertentu (`POST /api/ledger/receive-salary`):
  - Mengambil `grossSalary` dari `appSettings` (bisa di-override saat input, misal ada lembur/bonus).
  - Mengambil semua `installments` berjenis `payroll` dengan status `"upcoming"` pada periode terkait.
  - Menghitung `netSalary = grossSalary - totalPayrollDue`.
  - Dalam 1 transaksi DB: membuat transaksi income sebesar `netSalary` ke dompet tujuan (default BNI) + menandai cicilan payroll menjadi `"paid"` dengan `settlementTransactionId` / catatan slip gaji.
- `ensurePayrollAutoPaid` tetap dipertahankan sebagai fallback jika user tidak menekan tombol terima gaji, namun tidak memotong dobel jika sudah diproses lewat endpoint terima gaji.

## 4. Kriteria Penerimaan (Acceptance Criteria)

- Mengubah dompet BCA/Jenius menjadi `savings` langsung mengeluarkan saldonya dari `safeToSpend` tanpa menghapusnya dari total kas/net worth.
- Mencatat pengeluaran Rp100.000 di CC Jenius (bahkan pada tgl 22 saat unbilled) langsung menurunkan `safeToSpend` sebesar Rp100.000.
- Halaman `OverviewPage` menampilkan status pacing siklus (Hemat / Sesuai Jalur / Mulai Boros), sisa jatah harian dalam Rupiah, dan perbandingan dengan siklus lalu di hari ke-N yang sama.
- Aksi "Terima Gaji" sukses membuat transaksi masuk `netSalary` dan menandai cicilan utang kantor periode tersebut lunas secara atomik.
- Seluruh unit/integration test, `bun run typecheck`, dan `bun run lint` lolos.
