# Product Requirements Document (PRD): Financial Tracker

**Tanggal:** 22 November 2026  
**Status:** Draft Final untuk Review (Antislop `during` aktif)  
**Target Environment:** Development lokal Windows (Node v24 / Bun 1.4), deploy ke VPS Linux pada fase rilis.  
**Referensi Desain:** [DESIGN.md](./DESIGN.md)

---

## 1. Latar Belakang & Tujuan Produk

**Financial Tracker** adalah penggabungan dua aplikasi sebelumnya dari Meta Muse Space, yaitu [`money-management`](../money-management/README.md) dan [`debt-management`](../debt-management/README.md), menjadi satu aplikasi **Web Mobile-First** yang terpadu, akurat secara akuntansi kas dan kartu kredit, serta siap di-host mandiri di VPS.

### Masalah pada Dua Aplikasi Sebelumnya
1. **Duplikasi data Kartu Kredit (CC Jenius):** Belanja CC dicatat di `card_transactions` (Debt Management) lalu harus disinkronkan manual ke `expenses` (Money Management) dengan `sourceRef` `debt-cc-<id>`.
2. **Alur pelunasan terputus:** Membayar cicilan atau tagihan CC harus ditandai manual di dua tempat terpisah (`installments` di Debt Management dan `isCcSettlement` di Money Management).
3. **Tidak ada Transfer & Saldo per Dompet:** Top up GoPay/DANA atau pindah dana antar rekening (`BNI -> BCA`) terpaksa dicatat sebagai pengeluaran kategori `Makanan & Minuman`, dan selisih saldo bank terpaksa dicatat sebagai pengeluaran rekonsiliasi buatan.
4. **Tidak ada Budgeting & Split Pay dinamis:** Belum ada batas anggaran kategori bulanan dan belum ada fitur mengubah transaksi CC menjadi cicilan (Split Pay).

### Tujuan Utama
- **Single Source of Truth:** 1x catat transaksi CC Jenius langsung memperbarui pengeluaran kategori, tagihan siklus CC, dan sisa limit CC.
- **Akurasi Multi-Dompet:** Melacak saldo riil per rekening/e-wallet (`BNI`, `BCA`, `BTPN`, `GoPay`, `DANA`, `Tunai`) plus kartu kredit (`CC Jenius`), lengkap dengan fitur Transfer dan Rekonsiliasi Saldo.
- **Safe-to-Spend Clarity:** Menampilkan sisa kas likuid yang benar-benar aman dipakai setelah dikurangi kewajiban cicilan dan tagihan CC periode berjalan.
- **IDR Only:** Seluruh nominal disimpan dalam bilangan bulat Rupiah penuh (`integer`, tanpa sen atau multi-currency).

---

## 2. Arsitektur & Tech Stack

| Layer | Pilihan Teknologi | Catatan |
| --- | --- | --- |
| **Frontend** | React 19 + Vite + TypeScript + Tailwind CSS v4 + Recharts | Mobile-first responsive web app untuk mobile, tablet, dan desktop |
| **Backend API** | Hono on Bun (`Bun 1.4.4`) + Zod | Menggantikan `@hatch/space-sdk`, REST API type-safe |
| **Database** | SQLite + Drizzle ORM (`bun:sqlite`) | Tanpa kompilasi native addon di Windows, 1 file DB mudah di-backup |
| **Keamanan** | Single-owner PIN / Password Lock | Hash via `Bun.password`, HTTP-only signed session cookie |

---

## 3. Aturan Bisnis & Siklus Keuangan

Semua perhitungan tanggal menggunakan zona waktu **`Asia/Jakarta` (WIB)**.

### 3.1 Dua Siklus Waktu
1. **Siklus Gajian (`gajian`), Default 25 s/d 24:**
   - Periode `YYYY-MM` dimulai tanggal `25` bulan `YYYY-MM` hingga tanggal `24` bulan berikutnya (contoh: `2026-10` = `25 Okt 2026 - 24 Nov 2026`).
   - Dipakai untuk cashflow pemasukan, pengeluaran harian, dan budgeting bulanan.
2. **Siklus Kartu Kredit Jenius (`cc`), 20 s/d 19:**
   - Tutup buku tanggal `19`, tanggal cetak statement `21`, tanggal jatuh tempo bayar `25`.
   - Siklus `YYYY-MM` mencakup transaksi tanggal `20` bulan sebelumnya s/d tanggal `19` bulan `YYYY-MM` (contoh: siklus `2026-11` = `20 Okt 2026 - 19 Nov 2026`).

### 3.2 Jembatan Billed vs Unbilled CC
- Pada tampilan siklus gajian (`25 Okt - 24 Nov`), belanja `CC Jenius` yang terjadi tanggal `20-24 Nov` (setelah tutup buku `19 Nov`) tetap dihitung sebagai pengeluaran/komitmen bulan ini, namun diberi status **Unbilled** karena baru akan ditagihkan pada statement CC siklus berikutnya (`2026-12`).

### 3.3 Otomatisasi Ledger
- **Auto Bank Fees CC:** Setiap kali siklus CC dibuka/dimuat, sistem memastikan biaya bank statement (`Materai` Rp10.000 dan `Notifikasi` Rp12.500) tercatat idempoten pada tanggal `19` siklus tersebut.
- **Auto-Settle Potongan Gaji (`payroll`):** Akun utang berjenis `payroll` (contoh: *Utang kantor* Rp1.500.000/bulan) otomatis menandai cicilannya sebagai `paid` ketika `dueDate <= hari ini` (WIB). Transaksi ini **tidak** memotong saldo dompet karena gaji yang diterima (`netSalary`) sudah merupakan gaji bersih setelah potongan.

### 3.4 Rumus Metrik Utama
- **Saldo Dompet (Non-CC):** `openingBalance + total(income) + total(transfer_in) + total(adjustment) - total(expense) - total(transfer_out) - total(settlement)`
- **Total Kas Likuid:** Jumlah saldo seluruh dompet aktif bertipe `bank`, `ewallet`, dan `cash`.
- **Surplus Cashflow Periode:** `total(income) - total(expense periode, termasuk belanja CC yang belum dikonversi ke cicilan, tidak termasuk transfer/settlement/adjustment)`.
- **Kewajiban Tersisa Periode Ini:** `(Tagihan CC siklus berjalan yang belum dilunasi) + (Cicilan non-payroll status upcoming pada periode berjalan)`.
- **Safe-to-Spend:** `Total Kas Likuid - Kewajiban Tersisa Periode Ini`.
- **Limit CC Terpakai:** `(Belanja CC belum lunas/belum tutup siklus) + (Sisa pokok seluruh akun card_installment aktif)`.

---

## 4. Desain Skema Database (SQLite + Drizzle)

### 4.1 `wallets`
Menyimpan dompet kas, rekening bank, e-wallet, dan kartu kredit.
- `id` (PK), `key` (unique slug), `name` (`BNI`, `BCA`, `BTPN`, `GoPay`, `DANA`, `Tunai`, `CC Jenius`)
- `type` (`"bank" | "ewallet" | "cash" | "credit_card"`)
- `openingBalance` (integer IDR, default `0`)
- `creditLimit` (integer nullable, untuk `credit_card`, default `20000000`)
- `cutoffDay`, `statementDay`, `paymentDay` (integer nullable, khusus `credit_card`)
- `color` (hex), `sortOrder` (integer), `isActive` (boolean), `createdAt`

### 4.2 `categories`
Kategori pemasukan dan pengeluaran yang dapat dikelola user.
- `id` (PK), `name` (unique per type), `type` (`"expense" | "income"`)
- `isMandatory` (boolean, contoh: `hutang`, `keluarga`)
- `color` (hex), `sortOrder` (integer), `isArchived` (boolean)

### 4.3 `transactions`
Tabel tunggal untuk seluruh pergerakan uang dan transaksi kartu kredit.
- `id` (PK)
- `type` (`"expense" | "income" | "transfer" | "settlement" | "adjustment"`)
- `merchant` (text: nama merchant, judul transfer, atau keterangan penyesuaian)
- `amount` (integer IDR penuh: positif untuk transaksi normal, bertanda +/- untuk `adjustment`)
- `transactionDate` (text `YYYY-MM-DD`)
- `category` (text)
- `walletId` (FK ke `wallets.id`: sumber dana / dompet utama)
- `toWalletId` (FK nullable ke `wallets.id`: khusus `transfer`)
- `note` (text nullable)
- `ccCycleKey` (text nullable `YYYY-MM`: terisi otomatis jika `wallet.type === "credit_card"`)
- `isConvertedToInstallment` (boolean, default `false`: `true` jika dipecah ke Split Pay)
- `convertedAccountId` (FK nullable ke `debt_accounts.id`)
- `installmentId` (FK nullable ke `installments.id`: terisi untuk `settlement` cicilan)
- `source` (`"manual" | "whatsapp" | "import" | "system"`, default `"manual"`)
- `sourceRef` (text nullable, unique index untuk deduplikasi)
- `createdAt`, `updatedAt`

### 4.4 `debt_accounts`
Portofolio akun utang dan cicilan.
- `id` (PK), `key` (unique), `name`, `lender`
- `kind` (`"loan" | "card_installment" | "payroll"`)
- `walletId` (FK nullable ke `wallets.id`, contoh `CC Jenius` untuk `card_installment`)
- `initialBalance` (integer)
- `paymentDay` (integer nullable), `paymentMethod` (text), `color` (hex)
- `sourceTransactionId` (FK nullable ke `transactions.id`, jika berasal dari konversi Split Pay)
- `closedAt` (timestamp nullable), `createdAt`

### 4.5 `installments`
Jadwal cicilan per periode dari `debt_accounts`.
- `id` (PK), `accountId` (FK ke `debt_accounts.id`)
- `period` (`YYYY-MM`), `dueDate` (`YYYY-MM-DD`)
- `plannedAmount` (integer), `actualAmount` (integer nullable)
- `status` (`"upcoming" | "paid"`, default `"upcoming"`)
- `paidAt` (timestamp nullable)
- `settlementTransactionId` (FK nullable ke `transactions.id`)

### 4.6 `budgets`
Batas anggaran pengeluaran per kategori untuk siklus gajian.
- `id` (PK)
- `category` (text)
- `period` (text: `"default"` sebagai template berulang tiap siklus, atau `"YYYY-MM"` untuk override siklus tertentu)
- `limitAmount` (integer)
- `createdAt`, `updatedAt`

### 4.7 `app_settings`
Konfigurasi global pemilik tunggal.
- `id` (PK = `1`)
- `grossSalary` (integer, default `10481625`)
- `netSalary` (integer, default `8981625`)
- `payrollDeduction` (integer, default `1500000`)
- `gajianStartDay` (integer, default `25`)
- `cardCutoffDay` (integer, default `20`)
- `statementDay` (integer, default `21`)
- `cardPaymentDay` (integer, default `25`)
- `cardLimit` (integer, default `20000000`)
- `pinHash` (text nullable: jika kosong, lock nonaktif; diset saat setup awal atau di Pengaturan)
- `updatedAt`

---

## 5. Fitur Inti & User Flows

### 5.1 Keamanan Akses (PIN / Password Sederhana)
- Saat pertama kali dibuka (atau ketika `pinHash` aktif), user disambut layar **Unlock** berdesain minimalis.
- Jika belum diset, aplikasi menawarkan pembuatan PIN/Password opsional saat onboarding dan bisa diubah/dinonaktifkan dari Pengaturan.
- Sesi login disimpan dalam HTTP-only cookie (`SameSite=Lax`) sehingga aman saat nanti di-deploy ke VPS di balik HTTPS.

### 5.2 Tab 1: Ringkasan (Command Center)
- **Toggle Siklus & Periode:** Switch cepat `Gajian (25-24)` vs `CC (20-19)` dan tombol pindah periode.
- **Hero Card "Safe-to-Spend":**
  - Angka utama besar (`tabular-nums`): **Sisa Uang Aman Dipakai**.
  - Sub-baris transparan: `Kas Likuid RpX - Kewajiban Tersisa RpY`.
- **Tagihan Terdekat:** Menampilkan cicilan/tagihan non-payroll terdekat yang belum lunas (mis. Flexi Cash tgl 23, CC Jenius tgl 25) dengan tombol cepat **Bayar Sekarang**.
- **Dompet Strip:** Scroll horizontal kartu ringkas tiap dompet (`BNI`, `BCA`, `GoPay`, `Tunai`, dll) beserta saldo real-time.
- **Ringkasan Siklus & Budget Alert:** Pemasukan, Pengeluaran, Surplus, serta kategori yang pemakaian budget-nya sudah >= 80%.

### 5.3 Tab 2: Transaksi & Budget
- **Filter Lengkap:** Filter berdasarkan Minggu (`Minggu 1..5` / `Semua`), Dompet, Tipe (`Semua` / `Pengeluaran` / `Pemasukan` / `Transfer`), Kategori, serta pencarian nama merchant/catatan.
- **Toggle Sembunyikan Gajian (`hidePayday`):** Memudahkan membaca grafik tren pengeluaran harian tanpa lonjakan bar gaji di tanggal 25.
- **Grafik Harian (Recharts) & Breakdown Kategori:** Bar chart pemasukan vs pengeluaran harian + daftar kategori yang terhubung langsung dengan **Progress Bar Budgeting** (termasuk estimasi kuota harian tersisa).

### 5.4 Tab 3: Kartu Kredit & Utang
- **Panel CC Jenius:**
  - Gauge/progress pemakaian limit (`Terpakai / Rp20.000.000`).
  - Rincian tagihan siklus aktif (belanja harian + biaya bank otomatis + cicilan Split Pay jatuh tempo siklus tersebut).
  - Status *Unbilled* (transaksi CC setelah tgl 19).
  - Tombol **"Bayar Tagihan CC"** -> memilih dompet pembayar (mis. BNI), menandai komponen tagihan lunas, dan otomatis mencatat mutasi `settlement`.
  - Daftar transaksi CC dengan aksi **"Ubah ke Cicilan (Split Pay)"** di menu detail transaksi.
- **Portofolio Utang & Jadwal Pembayaran:**
  - Progress pelunasan total utang (`Initial`, `Terbayar`, `Sisa`).
  - Daftar akun utang aktif (dengan tombol **Tambah Utang** dan **Tutup Akun** jika sisa Rp0) + bagian tersembunyi untuk **Akun Ditutup** agar histori tetap utuh.
  - Jadwal cicilan dikelompokkan per bulan dengan badge jelas: *Auto Potong Gaji* (`payroll`) vs *Bayar Manual* (`loan` / `card_installment`).

### 5.5 Tab 4: Pengaturan & Manajemen Data
- **Dompet & Rekonsiliasi:** Tambah/edit dompet, atur saldo awal, dan tombol **"Sesuaikan Saldo"** (masukkan saldo aktual bank -> sistem menghitung selisih & membuat record `adjustment`).
- **Budget & Kategori:** Atur template budget bulanan per kategori dan kelola daftar kategori.
- **Aturan Gaji & Siklus:** Edit gaji kotor, potongan gaji, gaji bersih, tanggal mulai gajian, cutoff CC, statement, bayar CC, dan limit CC.
- **Tampilan, Keamanan & Export:** Switch tema **Terang / Gelap / Sistem**, ubah PIN/Password, export data JSON & CSV per periode atau full backup.

### 5.6 Quick-Add Bottom Sheet (Tombol `+` Tengah)
Form cepat dengan 4 mode tab di bagian atas:
1. **Pengeluaran**
2. **Pemasukan**
3. **Transfer** (Dompet Asal -> Dompet Tujuan + opsional *Biaya Admin* langsung dalam 1 input)
4. **Bayar Tagihan** (Pilih cicilan atau tagihan CC yang ingin dibayar -> pilih dompet pembayar)

---

## 6. Design System & Standar Kualitas (`dens-ui` + `antislop`)

Detail lengkap token warna terverifikasi WCAG AA, tipografi, radius, ikon custom, breakpoint responsif, state UI, aksesibilitas keyboard, dan Delivery Gate tercantum di [DESIGN.md](./DESIGN.md).

---

## 7. Rencana Migrasi Data Eksisting (`data/app.db`)

Script migrasi satu kali (`migrate-legacy.ts`) akan membaca langsung dari [`debt-management/data/app.db`](../debt-management/data/app.db) dan [`money-management/data/app.db`](../money-management/data/app.db):

1. **Seed Wallets & Settings:**
   - Buat dompet default: `BNI`, `BCA`, `BTPN`, `GoPay`, `DANA`, `Tunai` (opening balance awal `0`), dan `CC Jenius` (`creditLimit = 20000000`, `cutoffDay = 20`, `statementDay = 21`, `paymentDay = 25`).
   - Salin konfigurasi `settings` dari `debt-management`.
2. **Migrasi Utang & Cicilan:**
   - Salin seluruh `debt_accounts` (6 akun beserta `closedAt`) dan `installments` (47 cicilan beserta status `paid`, `actualAmount`, `paidAt`) apa adanya. **Jangan** menjalankan ulang seed awal agar koreksi jadwal Laptop 12x & Flexi Cash Konsolidasi tetap utuh.
3. **Migrasi & Deduplikasi Transaksi:**
   - Salin seluruh transaksi dari `money-management.expenses` (siklus `2026-09` & `2026-10`). Baris dengan `isCcSettlement = true` dimapping menjadi `type = "settlement"`.
   - Untuk `debt-management.card_transactions`: cek apakah `debt-cc-<id>` sudah ada pada `sourceRef` di transaksi hasil salinan `money-management`. Jika sudah ada, **skip** (hindari duplikasi); jika belum ada (seperti siklus `2026-10` dan `Biaya Bank` siklus `2026-12`), insert ke `transactions` pada dompet `CC Jenius` dengan `sourceRef = "debt-cc-<id>"`.
4. **Post-Migration Setup (oleh User di UI):**
   - Buka menu **Pengaturan -> Dompet**, lalu input saldo riil saat ini untuk `BNI`, `BCA`, `BTPN`, `GoPay`, `DANA`, dan `Tunai` lewat fitur **Set Saldo Awal / Rekonsiliasi Saldo**.

---

## 8. Roadmap Eksekusi

1. **Phase 1: Fondasi & Migrasi Data** ([task-phase-1.md](./task-list/task-phase-1.md))
2. **Phase 2: Backend API & Core Engine** ([task-phase-2.md](./task-list/task-phase-2.md))
3. **Phase 3: Frontend Mobile-First & Design System `dens-ui`** ([task-phase-3.md](./task-list/task-phase-3.md))
4. **Phase 4: Stabilisasi Core, Integritas Data & Keamanan Produksi** ([task-phase-4.md](./task-list/task-phase-4.md))
5. **Phase 5: Modularisasi Arsitektur, UX Parity & Aksesibilitas** ([task-phase-5.md](./task-list/task-phase-5.md))
6. **Phase 6: Evolusi Skema Skala Tahun, Observability & Deployment VPS** ([task-phase-6.md](./task-list/task-phase-6.md))
