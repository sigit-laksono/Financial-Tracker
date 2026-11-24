# PRD — Milestone 13: Integritas Kode, Transaksi Atomik & Stabilitas Cache

## 1. Latar Belakang & Masalah

Berdasarkan hasil audit mendalam pada `docs/0.draft/code-review.md`, sistem memiliki fondasi teknis yang solid (Bun, Hono, Drizzle SQLite, React 19, TanStack Query), namun ditemukan sejumlah celah kritis (**P0 dan P1**) yang dapat merusak integritas pembukuan, inkonsistensi cache, dan regresi multi-kartu kredit:

1. **Mutasi Non-Atomik pada Penerimaan Gaji (CR-01 - P0):**
   Proses `receiveSalaryForPeriod` (`salaryService.ts`) mencatat pemasukan gaji dan memperbarui status cicilan payroll secara terpisah tanpa pembungkus transaksi database (`db.transaction`). Jika koneksi terputus di tengah jalan, status cicilan tidak terbayar sementara gaji sudah tercatat, dan user tidak bisa mengulanginya karena terhadang validasi "Gaji sudah dicatat".
2. **Stale Read Permanen pada Halaman Budgeting (CR-02 - P0):**
   `BudgetPage.tsx` menggunakan query key `["budget-summary"]`, sementara seluruh mutasi transaksi (`QuickAddSheet`, edit, delete) meng-invalidate query key `["budgets"]`. Akibatnya, pengeluaran baru tidak langsung ter-update di halaman Budgeting.
3. **Regresi Multi-Kartu Kredit pada Pengaturan Global (CR-03 - P1):**
   `PATCH /api/settings` memperbarui seluruh row kartu kredit dengan limit dan tanggal cutoff yang sama secara membabi buta. Jika user memiliki 2 kartu kredit (misal Jenius Limit Rp20jt Cutoff tgl 20, BCA Limit Rp10jt Cutoff tgl 10), pengaturan BCA akan menimpa kartu Jenius.
4. **Pendeteksian Transaksi Unbilled Multi-CC Tidak Lengkap (CR-04 - P1):**
   Pengecekan transaksi *unbilled* di `server/src/routes/transactions.ts` hanya mencari kartu kredit pertama (`LIMIT 1`), sehingga transaksi kartu kredit kedua tidak ditandai sebagai unbilled.
5. **Hapus Penerimaan Piutang Menyisakan Cicilan Gantung (CR-05 - P1):**
   Menghapus transaksi bertipe penerimaan cicilan piutang hanya menghapus record transaksi tanpa mengembalikan status cicilan piutang menjadi `pending`.
6. **In-Memory Row Scanning pada Saldo Dompet (CR-06 - P1):**
   `computeWalletBalance` di `cashLedger.ts` memuat seluruh record transaksi ke array JavaScript in-memory alih-alih memanfaatkan fungsi agregasi native SQL (`SUM`).
7. **Setor Goal Tabungan Tidak Menambah Saldo Dompet (CR-07 - P1):**
   Endpoint `POST /api/goals/:id/contribute` mencatat mutasi pengeluaran dari dompet sumber, namun tidak menambahkan saldo pada dompet target tabungan tujuan goal.
8. **Concurrency Error pada Audit Log di Blok Transaksi (CR-09 - P1):**
   Di `server/src/routes/debts.ts:171`, fungsi `recordAuditLog` dipanggil menggunakan instance `db` utama alih-alih `tx` di dalam blok transaksi SQLite.

---

## 2. Tujuan Milestone

1. **Menjamin Atomisitas Data Akuntansi Finansial**:
   Seluruh operasi multi-tabel (gaji + potong utang, pelunasan utang + mutasi kas, setor goal) 100% berjalan dalam transaksi atomik SQLite (`db.transaction`).
2. **Sinkronisasi Cache Frontend-Backend Real-Time**:
   Menyelaraskan seluruh Query Key TanStack Query antara `BudgetPage`, `OverviewPage`, dan modal mutasi (`QuickAddSheet`, `ReceiveSalaryModal`, dll.) sehingga UI selalu mutakhir tanpa refresh manual.
3. **Dukungan Multi-Kartu Kredit yang Benar & Aman**:
   Pemisahan konfigurasi kartu kredit per-kartu dan deteksi transaksi unbilled untuk seluruh kartu kredit yang aktif.
4. **Optimasi Performa Kueri Database**:
   Mengganti pemindaian transaksi in-memory pada perhitungan saldo dompet dengan query SQL `COALESCE(SUM(...), 0)`.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Backend Services & Routes
- **`app/server/src/lib/salaryService.ts`**:
  - Bungkus `receiveSalaryForPeriod` dalam `await db.transaction(async (tx) => { ... })`.
  - Catat alokasi pelunasan payroll ke `settlementAllocations` agar pelacakan settlement konsisten.
- **`app/server/src/routes/settings.ts`**:
  - Modifikasi endpoint pengaturan agar tidak melakukan `UPDATE wallets SET ... WHERE type = 'credit_card'` secara global tanpa id spesifik. Konfigurasi kartu kredit dipindahkan ke manajemen per-dompet (`PATCH /api/wallets/:id`).
- **`app/server/src/routes/transactions.ts`**:
  - Perbaiki kueri unbilled kartu kredit agar mencocokkan `walletId` dari kartu kredit yang bersangkutan.
  - Perbaiki penghapusan transaksi penerimaan piutang: kembalikan status cicilan (`installments.status = 'pending'`) dan hapus alokasi terkait.
- **`app/server/src/lib/cashLedger.ts`**:
  - Refaktor `computeWalletBalance` menggunakan SQL query agregasi native.
- **`app/server/src/routes/goals.ts`**:
  - Pastikan setoran goal (`contribute`) menambahkan saldo ke dompet target tabungan tujuan goal (jika ada target wallet) secara atomik.
- **`app/server/src/routes/debts.ts`**:
  - Lewatkan `tx` ke dalam `recordAuditLog(tx, ...)` di dalam blok transaksi database.

### B. Frontend Cache Invalidation (`app/client/src/`)
- Standardisasi konstanta Query Keys di `app/client/src/lib/queryKeys.ts`:
  - `budgetKeys.summary(period)` $\rightarrow$ `["budget-summary", period]`
  - `budgetKeys.all` $\rightarrow$ `["budgets"]`
- Pastikan seluruh mutasi transaksi di `QuickAddSheet.tsx`, `TransactionsPage.tsx`, dan `App.tsx` meng-invalidate kedua query key tersebut.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [x] Penerimaan gaji berjalan 100% atomik: jika terjadi kegagalan saat update cicilan payroll, record transaksi gaji di-rollback tanpa sisa.
- [x] Transaksi pengeluaran baru di `QuickAddSheet` langsung memperbarui persentase dan sisa saldo pada `BudgetPage` tanpa perlu reload browser.
- [x] Pengaturan limit/cutoff pada kartu kredit A tidak menimpa kartu kredit B.
- [x] Transaksi unbilled pada kartu kredit kedua terdeteksi dengan tepat di filter transaksi unbilled.
- [x] Menghapus transaksi cicilan piutang mengembalikan status cicilan piutang menjadi `pending`.
- [x] Perhitungan saldo dompet menggunakan SQL agregasi native dan lolos uji benchmark performa.
- [x] Seluruh automated test suite (`bun test`) lulus 100% (minimal 43 passing tests — tercapai 45 tests).
