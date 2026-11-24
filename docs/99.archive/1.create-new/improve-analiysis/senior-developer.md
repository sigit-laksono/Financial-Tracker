# Analisis & Code Review Senior Developer: Financial Tracker

**Tanggal Audit:** 22 November 2026  
**Cakupan Audit:** `docs/PRD.md`, `docs/DESIGN.md`, `docs/task-list/task-phase-1.md` s/d `task-phase-3.md`, serta seluruh source code di `app/` (`package.json`, `vite.config.ts`, `drizzle/`, `shared/src/`, `server/src/`, `client/src/`).  
**Ringkasan Kondisi Saat Ini:** Fondasi arsitektur (`Hono` + `Bun` + `Drizzle SQLite` + `React 19` + `Tailwind v4`) sudah rapi, clean, dan fungsional untuk alur inti. Namun ditemukan beberapa **bug akuntansi & integritas data**, **edge case validasi tanggal/transaksi**, **celah keamanan konfigurasi produksi**, **ketidaksesuaian sinkronisasi state & UX di frontend**, serta **gap type-safety & test coverage** yang perlu diselesaikan sebelum rilis VPS.

---

### Ringkasan Poin Utama Analisis
1. **Correctness & Accounting Integrity (P0):**
   - `buildDashboardData` memanggil `ensureMonthlyBankFees` setelah `computeLedgerSnapshot` saat `cycle === "cc"`, menyebabkan biaya bank periode non-aktif baru muncul pada request berikutnya dan berpotensi menulis record biaya bank masa depan dari HTTP `GET`.
   - `settleObligations` belum mencegah double-settlement pada `ccCycleKey` yang sama dan `isCycleSettled` menganggap semua transaksi `ccCycleKey` berstatus lunas penuh begitu ada satu baris `settlement` (termasuk jika bayar sebagian/custom), plus hardcode `cycleKey <= "2026-10"` di engine inti.
   - `unsettleInstallment` dengan `removeSettlementTx = true` bisa ikut menghapus transaksi `settlement` yang menempel pada tagihan harian CC jika suatu cicilan Split Pay dibatalkan lunasnya.
   - `PATCH /api/transactions/:id` belum menolak `income` ke dompet `credit_card` dan belum memblokir edit pada transaksi yang sudah berstatus `isConvertedToInstallment = true`.
   - `periodBounds` mengalami bug off-by-one jika `gajianStartDay === 1` atau `cardCutoffDay === 1`, dan `dateSchema` menggunakan `new Date(...)` yang meloloskan tanggal tidak valid kalender seperti `2026-02-31`.
2. **Keamanan & Production Readiness (P0/P1):**
   - `getSessionSecret()` memakai fallback hardcoded string bila `SESSION_SECRET` tidak diset; `export.ts` (`escapeCsvCell`) rentan CSV/Formula Injection; `index.ts` mengembalikan `index.html` status 200 untuk route `/api/*` yang tidak ditemukan saat `client/dist` ada.
   - `app/server/src/db/index.ts` menjalankan `createDb()` di top-level import sehingga membuat file DB fisik meski hanya menjalankan `bun test` (`:memory:`).
3. **Frontend, UX & Accessibility (P1):**
   - `ModalSheet` belum memiliki focus trap sesuai `DESIGN.md` dan re-runs `useEffect([open, onClose])` akibat inline `onClose` di `App.tsx`; tap target tombol inline (`Ubah Limit`, `Kelola CC`, `Lihat Semua`) masih di bawah `44px`.
   - `SettingsPage` menampilkan efektif budget periode berjalan di bagian "Template Budget Bulanan", sehingga menghapus item override bisa menyesatkan (sedangkan `api.getBudgets` sendiri tidak pernah dipakai).
   - Transaksi tipe `transfer`, `settlement`, dan `adjustment` tidak memiliki tombol hapus di UI; `TransactionsPage` selalu me-reset filter saat pindah tab, `hidePayday` hardcoded ke `-25`, dan tidak ada navigator periode di tab Transaksi.
   - `vite-plugin-pwa` terpasang di `app/package.json` namun belum dikonfigurasi di `app/vite.config.ts` / `app/client/index.html`.
4. **Testing, Type-Safety & DX (P1/P2):**
   - DTO di `app/client/src/lib/api.ts` terpisah dari backend (`app/shared/src/types.ts` hanya berisi konstanta enum); tidak ada ESLint/Biome, tidak ada script `start` produksi, dan `api.test.ts` belum menguji `cycle=cc`, validasi edge case `PATCH`/`DELETE`, double-settle, maupun test frontend.

---

## 1. Temuan Code Review & Technical Debt

### 1.1 Backend (`app/server/src/`)

1. **Side-effect Write pada Endpoint `GET` & Stale Read di `buildDashboardData`**
   - **Lokasi:** [`app/server/src/lib/ledger.ts`](../../app/server/src/lib/ledger.ts#L149-L155) (`computeLedgerSnapshot`) dan [`ledger.ts`](../../app/server/src/lib/ledger.ts#L294-L308) (`buildDashboardData`).
   - **Temuan:**
     - `computeLedgerSnapshot` memanggil `ensureMonthlyBankFees` hanya untuk `currentCcCycle` dan `shiftMonth(currentCcCycle, -1)`, serta `ensurePayrollAutoPaid`.
     - Ketika `buildDashboardData` dipanggil dengan `cycle === "cc"`, ia memanggil `await ensureMonthlyBankFees(db, selectedPeriod)` **setelah** `computeLedgerSnapshot(db, today)` selesai membaca tabel `transactions`. Akibatnya, jika user membuka siklus CC di luar 2 siklus terakhir, biaya bank (`Materai` Rp10.000 & `Notifikasi` Rp12.500) baru saja di-insert ke DB tetapi **tidak ikut terhitung dalam response pertama**.
     - Lebih jauh, user dapat menekan tombol navigasi periode berikutnya (`>`) ke bulan-bulan masa depan (mis. `2027-06`), sehingga `GET /api/dashboard?cycle=cc&period=2027-06` akan membuat record transaksi biaya bank di masa depan secara permanen hanya dari aktivitas melihat halaman.

2. **Duplikasi Logika Resolusi Budget antara Ledger & Route**
   - **Lokasi:** [`resolveBudgetsForPeriod`](../../app/server/src/lib/ledger.ts#L558-L603) dan [`createBudgetRoutes`](../../app/server/src/routes/budgets.ts#L18-L78) (`GET /api/budgets`).
   - **Temuan:** Logika penggabungan template `"default"` vs override `"YYYY-MM"`, akumulasi `spentByCategory`, kalkulasi `percentUsed`, dan penentuan `status` (`"ok" | "warning" | "over"`) ditulis ulang di dua file. Bahkan format field responsenya sedikit berbeda (`period` di `resolveBudgetsForPeriod` vs `effectivePeriod` di `GET /api/budgets`).

3. **Side-Effect Koneksi Database saat Import Modul (`db/index.ts`)**
   - **Lokasi:** [`app/server/src/db/index.ts`](../../app/server/src/db/index.ts#L23) (`export const { db, sqlite } = createDb();`).
   - **Temuan:** `createDb()` langsung dieksekusi di level modul. Ketika `api.test.ts` mengimpor `createDb` untuk membuat database `:memory:`, modul `db/index.ts` tetap langsung membuat direktori dan file fisik `./data/financial-tracker.db` di disk.

4. **Asumsi Single Credit Card Wallet yang Rapuh**
   - **Lokasi:** [`app/server/src/routes/wallets.ts`](../../app/server/src/routes/wallets.ts#L55-L90), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L56-L61), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L175), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L829-L834).
   - **Temuan:** Engine ledger menggunakan `.find((w) => w.type === "credit_card")` dan `.limit(1)`, dan `PATCH /api/settings` meng-update seluruh row `WHERE type = 'credit_card'`. Namun endpoint `POST /api/wallets` tetap mengizinkan pembuatan dompet `type: "credit_card"` baru tanpa batasan. Jika ada dua dompet `credit_card`, tagihan dan auto-fee hanya akan masuk ke salah satu secara non-deterministik.

5. **Tidak Ada Global Error Handler, SPA Fallback Menelan `/api/*` 404, & Ketergantungan `process.cwd()`**
   - **Lokasi:** [`app/server/src/app.ts`](../../app/server/src/app.ts#L14-L37) dan [`app/server/src/index.ts`](../../app/server/src/index.ts#L9-L19).
   - **Temuan:**
     - `createApp` tidak mendefinisikan `app.onError` maupun `app.notFound` untuk `/api/*`. Error runtime tak terduga akan mengembalikan text `"Internal Server Error"`, bukan JSON `{ error: string }`.
     - Pada mode produksi (`existsSync(distDir)`), `app.get("*", serveStatic({ path: "./client/dist/index.html" }))` menangkap route `/api/*` yang tidak valid dengan HTTP `200` berisi HTML SPA alih-alih JSON `404`.
     - Path `./drizzle`, `./client/dist`, dan `./data/financial-tracker.db` memakai `resolve(process.cwd(), ...)`, sehingga server gagal menemukan migrasi/aset statis jika dijalankan dari root repository (di luar folder `app/`).

6. **Celah Keamanan & Production Hardening**
   - **Lokasi:** [`app/server/src/lib/auth.ts`](../../app/server/src/lib/auth.ts#L13-L46), [`auth.ts`](../../app/server/src/lib/auth.ts#L144-L150), [`app/server/src/routes/auth.ts`](../../app/server/src/routes/auth.ts#L99-L139), dan [`app/server/src/routes/export.ts`](../../app/server/src/routes/export.ts#L6-L12).
   - **Temuan:**
     - `getSessionSecret()` jatuh ke secret statis `"dev-local-financial-tracker-secret-key"` jika `SESSION_SECRET` tidak diset — berbahaya bila ter-deploy ke VPS tanpa konfigurasi env.
     - `LoginRateLimiter` menyimpan IP di `Map` tanpa mekanisme pembersihan entry yang sudah expired, dan `clientRateKey` langsung memercayai header `x-forwarded-for` / `x-real-ip` yang bisa di-spoof jika app terekspos langsung tanpa trusted proxy.
     - `POST /api/auth/change-pin` tidak menerapkan rate limiting saat memverifikasi `currentPin`.
     - `escapeCsvCell` di `export.ts` hanya melakukan quoting untuk `,`, `"`, `\n`, tetapi tidak menetralkan karakter pemicu formula spreadsheet (`=`, `+`, `-`, `@`, `\t`, `\r`) — rentan terhadap CSV Formula Injection saat file dibuka di Excel/Google Sheets.

---

### 1.2 Database Schema & Queries (`app/server/src/db/`)

1. **Full-Table Scan Berulang Tanpa Agregasi SQL & Tanpa Pagination**
   - **Lokasi:** [`computeLedgerSnapshot`](../../app/server/src/lib/ledger.ts#L156-L170).
   - **Temuan:** Setiap request ke `/api/dashboard`, `/api/wallets`, `/api/debts`, `/api/budgets`, `/api/export`, dan `/api/wallets/:id/reconcile` memuat **seluruh** isi tabel `transactions`, `installments`, `wallets`, `debt_accounts`, `categories`, dan `budgets` ke memori JS lalu melakukan loop berulang. Selain itu, saat `App.tsx` pertama kali dibuka, `dashboardQuery` (`GET /api/dashboard`) dan `debtsQuery` (`GET /api/debts`) berjalan paralel — memicu `computeLedgerSnapshot` **2 kali bersamaan**.
   - **Dampak:** Ketika histori transaksi bertumbuh ke ribuan baris, latensi & konsumsi memori meningkat linear di setiap request.

2. **Relasi `category` Berbasis String Bebas & Missing Indexes**
   - **Lokasi:** [`app/server/src/db/schema.ts`](../../app/server/src/db/schema.ts#L28-L124) dan [`app/server/src/routes/categories.ts`](../../app/server/src/routes/categories.ts#L64-L84).
   - **Temuan:**
     - `transactions.category` dan `budgets.category` menyimpan `text` nama kategori, bukan foreign key `categoryId`. Ketika user me-rename kategori melalui `PATCH /api/categories/:id`, transaksi lama dan budget terkait menjadi terputus (orphan string), dan `PATCH /api/categories/:id` tidak mengecek konflik nama unik sebelum update.
     - Pada `schema.ts`, kolom `installments.settlementTransactionId`, `transactions.convertedAccountId`, dan `transactions.toWalletId` belum di-index meski dipakai untuk query lookup/filter (`eq(installments.settlementTransactionId, id)` di `transactions.ts` baris 210 dan `ledger.ts` baris 947).
     - Penamaan default kategori di [`seed.ts`](../../app/server/src/db/seed.ts#L42-L43) tidak konsisten: `"keluarga"` dan `"hutang"` huruf kecil semua sementara 28 kategori lain Title Case.

---

### 1.3 Shared Layer & Type-Safety (`app/shared/` & `app/client/src/lib/api.ts`)

1. **Contract Drift antara Backend & Frontend**
   - **Lokasi:** [`app/shared/src/types.ts`](../../app/shared/src/types.ts#L1-L26) dan [`app/client/src/lib/api.ts`](../../app/client/src/lib/api.ts#L35-L236).
   - **Temuan:** `shared/src/types.ts` hanya mengekspor konstanta enum union (`WALLET_TYPES`, `TRANSACTION_TYPES`, dll.). Seluruh tipe payload dan response DTO (`DashboardDto`, `DebtsDto`, `WalletDto`, `TransactionDto`, `BudgetItemDto`) ditulis ulang secara manual di `client/src/lib/api.ts` tanpa di-share atau diinfer oleh backend. Akibatnya `bun run typecheck` tidak mampu mendeteksi perubahan nama/bentuk field antara backend dan frontend. Contoh: `api.ts` mendefinisikan return `settleInstallments` tanpa field `settlementTransactionId` yang sebenarnya dikirim oleh `ledger.ts` baris 913.

---

### 1.4 Frontend (`app/client/src/`)

1. **Sinkronisasi State & Reset Data Saat Navigasi Tab**
   - **Lokasi:** [`app/client/src/App.tsx`](../../app/client/src/App.tsx#L373-L429), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L39-L57), [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx#L384-L412), [`QuickAddSheet.tsx`](../../app/client/src/components/QuickAddSheet.tsx#L73-L113).
   - **Temuan:**
     - Halaman di-mount/unmount secara kondisional berdasarkan `tab`. Akibatnya seluruh filter di `TransactionsPage` (`weekChoice`, `walletFilter`, `typeFilter`, `categoryFilter`, `search`, `hidePayday`) hilang setiap kali berpindah tab.
     - `SettingsPage` menampilkan `data.budgets` (yang berisi efektif budget **periode aktif saat ini**, termasuk override `"YYYY-MM"`) di bawah judul *"Template Budget Bulanan (Siklus Gajian)"*. Jika periode aktif memiliki override, tombol hapus akan menghapus override periode tersebut alih-alih template default, sedangkan endpoint `GET /api/budgets` (`api.getBudgets`) yang menyediakan `templateId` & `templateLimit` justru tidak pernah dipakai.
     - `QuickAddSheet.tsx` memiliki `useEffect` dengan dependency list tidak lengkap (membaca `cashWallets`, `activeWallets`, `incomeCategories`, `expenseCategories`, `upcomingInstallments`, `unpaidCcCycles` tanpa masuk dependencies), dan saat mengedit transaksi yang kategorinya sudah diarsipkan (`isArchived = true`), kategori tersebut hilang dari `<select id="tx-category">`.

2. **Logika Bisnis Terduplikasi & Hardcoded di Client**
   - **Lokasi:** [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L109) dan [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L269), serta [`app/client/src/lib/format.ts`](../../app/client/src/lib/format.ts#L56-L84).
   - **Temuan:**
     - `const isPayday = key.endsWith("-25");` dan label `"Sembunyikan Gajian (tgl 25)"` di-hardcode ke tanggal `25`, mengabaikan `data.settings.gajianStartDay` yang bisa diubah di Pengaturan.
     - Fungsi `jakartaToday` dan `shiftMonth` diduplikasi di `server/src/lib/dates.ts` dan `client/src/lib/format.ts`.

---

## 2. Correctness & Edge Cases

### 2.1 Validasi Input & Date/Timezone Handling

1. **Bug Validasi Tanggal Kalender (`2026-02-31` Lolos Validasi)**
   - **Lokasi:** [`app/server/src/routes/transactions.ts`](../../app/server/src/routes/transactions.ts#L13-L16), [`debts.ts`](../../app/server/src/routes/debts.ts#L20), [`wallets.ts`](../../app/server/src/routes/wallets.ts#L33).
   - **Temuan:** `dateSchema` mengecek `!Number.isNaN(new Date(`${v}T00:00:00Z`).valueOf())`. Di JavaScript/V8, `new Date("2026-02-31T00:00:00Z")` otomatis overflow ke `"2026-03-03"` sehingga **tidak** bernilai `NaN`. Tanggal invalid tersebut akan tersimpan mentah sebagai string `"2026-02-31"` di SQLite. Sementara `debts.ts` dan `wallets.ts` bahkan hanya memakai regex `/^\d{4}-\d{2}-\d{2}$/` tanpa pengecekan tanggal valid sama sekali.

2. **Bug Off-by-One di `periodBounds` saat `gajianStartDay === 1` atau `cardCutoffDay === 1`**
   - **Lokasi:** [`app/server/src/lib/dates.ts`](../../app/server/src/lib/dates.ts#L63-L86) dan [`app/server/src/routes/settings.ts`](../../app/server/src/routes/settings.ts#L12-L13).
   - **Temuan:**
     - `settings.ts` mengizinkan `gajianStartDay` dan `cardCutoffDay` bernilai `1..28`.
     - Jika `gajianStartDay = 1`, baris 84 menghitung `new Date(Date.UTC(year, month, Math.max(1, 1 - 1)))` -> tanggal `1` bulan berikutnya (`2026-11-01`), sehingga periode `2026-10` menjadi `2026-10-01` s/d `2026-11-01` (**tumpang tindih** tanggal `1` dengan periode `2026-11`!).
     - Jika `cardCutoffDay = 1`, `closingDay` di `periodBounds` dan `ensureMonthlyBankFees` menjadi `1` bulan `YYYY-MM`, padahal `ccCycleForDate("2026-11-01", 1)` sudah memetakan tanggal `1` ke siklus `2026-12`.

3. **Celah Validasi `PATCH /api/transactions/:id`**
   - **Lokasi:** [`app/server/src/routes/transactions.ts`](../../app/server/src/routes/transactions.ts#L129-L173).
   - **Temuan:**
     - Tidak memblokir `type === "income"` ke dompet `credit_card` (validasi ini hanya ada di `POST /api/transactions` baris 86–88).
     - Mengizinkan edit nominal, tanggal, tipe, atau `walletId` untuk transaksi yang sudah berstatus `isConvertedToInstallment = true`, yang akan merusak konsistensi akun `debt_accounts` Split Pay terkait.
     - Tidak memvalidasi apakah `category` ada di tabel `categories` (baik di `POST` maupun `PATCH`).

---

### 2.2 Kalkulasi Saldo, Transaksi, CC, Budget & Transfer

1. **Double-Settlement CC & Partial Payment Tidak Terlacak**
   - **Lokasi:** [`computeLedgerSnapshot`](../../app/server/src/lib/ledger.ts#L176-L181), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L223-L226), dan [`settleObligations`](../../app/server/src/lib/ledger.ts#L800-L916).
   - **Temuan:**
     - `settleObligations` tidak memeriksa apakah `ccCycleKey` sudah lunas sebelumnya. Memanggil `POST /api/installments/settle` dua kali untuk `ccCycleKey` yang sama akan membuat 2 transaksi `settlement` dan memotong saldo dompet pembayar dua kali.
     - `isCycleSettled` menganggap seluruh tagihan harian siklus CC lunas hanya dari keberadaan satu transaksi `settlement` dengan `ccCycleKey` tersebut — mengabaikan kemungkinan nominal `customAmount` yang berbeda (bayar minimum/sebagian) maupun adanya transaksi CC baru yang menyusul dicatat/diedit ke siklus tersebut setelah pelunasan.
     - **Hardcode tanggal migrasi di engine inti:** `if (cycleKey <= "2026-10") return true;` (`ledger.ts` baris 224) membuat fresh-install atau skenario historis pada siklus `<= 2026-10` selalu dianggap lunas tanpa transaksi pelunasan.

2. **Inkonsistensi `unsettleInstallment` pada Pembayaran Gabungan CC + Split Pay**
   - **Lokasi:** [`unsettleInstallment`](../../app/server/src/lib/ledger.ts#L918-L956) dan [`DebtsPage.tsx`](../../app/client/src/pages/DebtsPage.tsx#L45-L47).
   - **Temuan:** Ketika tagihan CC dibayar lewat `openPayCcCycle` (`ccCycleKey` + 1 atau lebih `installmentIds` Split Pay), seluruh komponen terikat ke satu `settlementTransactionId`. Jika user kemudian menekan tombol *"Batal Lunas"* pada salah satu cicilan Split Pay di `DebtsPage` (`unsettleInstallment(id, true)`), dan tidak ada cicilan lain yang terhubung ke ID transaksi settlement itu, `unsettleInstallment` **menghapus transaksi `settlement` utama** — sehingga tagihan belanja harian CC pada siklus tersebut ikut berubah menjadi belum lunas secara diam-diam.

3. **Keterkaitan `ensureMonthlyBankFees` dengan Nama Merchant**
   - **Lokasi:** [`ensureMonthlyBankFees`](../../app/server/src/lib/ledger.ts#L75-L94).
   - **Temuan:** Pengecekan eksistensi memakai `r.merchant.trim().toLowerCase().includes(fee.match)`. Jika user mencatat pengeluaran CC manual seperti `"Beli Materai 10rb"`, biaya bank `Materai` bulan tersebut akan di-skip. Selain itu, `insertedCount += 1` tetap dihitung meskipun `onConflictDoNothing()` men-skip insert saat terjadi conflict `sourceRef`.

4. **Semantik `Safe-to-Spend` Saat Melihat Periode Historis/Masa Depan**
   - **Lokasi:** [`buildDashboardData`](../../app/server/src/lib/ledger.ts#L417-L441) dan [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx#L103-L158).
   - **Temuan:** `totalLiquidCash` dihitung dari **saldo riil saat ini** (all-time), sedangkan `remainingObligations` difilter dengan `dueDate <= bounds.end` dari `selectedPeriod` yang sedang dilihat. Jika user berpindah ke periode lalu (`2026-09`) atau masa depan (`2027-01`), angka *Safe-to-Spend* mencampurkan kas hari ini dengan batas kewajiban periode lain, sementara kartu yang sama menampilkan `totalIncome`, `totalExpense`, dan `surplus` khusus periode tersebut.

---

### 2.3 Race Conditions & Atomisitas Transaksi DB

1. **Race Condition di `reconcileWalletBalance` (`POST /api/wallets/:id/reconcile`)**
   - **Lokasi:** [`reconcileWalletBalance`](../../app/server/src/lib/ledger.ts#L765-L798).
   - **Temuan:** Membaca saldo via `computeLedgerSnapshot` lalu `INSERT` transaksi `adjustment` tidak dibungkus `db.transaction(...)` (dan di frontend `ReconcileModal` jika terjadi retry/double submit bisa memicu 2 request berdekatan). Dua request paralel akan menghasilkan dua adjustment dengan delta penuh, membuat saldo meleset 2x.

2. **Non-Atomik pada `DELETE /api/transactions/:id` & `POST /api/auth/setup`**
   - **Lokasi:** [`app/server/src/routes/transactions.ts`](../../app/server/src/routes/transactions.ts#L175-L215) dan [`auth.ts`](../../app/server/src/routes/auth.ts#L40-L60).
   - **Temuan:**
     - `DELETE /api/transactions/:id` melakukan cek `debtAccounts`, revert `installments`, dan `delete` `transactions` secara terpisah tanpa `db.transaction(...)`.
     - `POST /api/auth/setup` mengecek `if (settings.pinHash)` lalu melakukan `UPDATE` tanpa conditional `WHERE pin_hash IS NULL`, sehingga secara teoretis dua request paralel saat setup awal dapat saling menimpa.

3. **Race Condition `Toast` Timer di Client**
   - **Lokasi:** [`app/client/src/App.tsx`](../../app/client/src/App.tsx#L74-L77).
   - **Temuan:** `window.setTimeout(() => setToast(""), 2800)` dipanggil tanpa menyimpan ref/membersihkan timer sebelumnya. Dua toast yang muncul berdekatan akan membuat toast kedua terhapus lebih cepat oleh timer pertama.

---

## 3. Frontend & UI/UX Engineering

### 3.1 Komponen React & Flow UX

1. **Tidak Ada Cara Menghapus Transaksi `transfer`, `settlement`, atau `adjustment` di UI**
   - **Lokasi:** [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L426) (`isEditable = tx.type === "expense" || tx.type === "income"`).
   - **Temuan:** Backend `DELETE /api/transactions/:id` mendukung penghapusan transaksi `transfer`, `settlement` (beserta rollback status cicilan), dan `adjustment`. Namun di UI, tombol aksi hanya muncul jika `isEditable` true. Jika user salah input transfer atau salah rekonsiliasi saldo, tidak ada tombol untuk menghapus atau membatalkannya dari aplikasi.

2. **Ketidaksinkronan Filter vs Visualisasi di `TransactionsPage`**
   - **Lokasi:** [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L100-L118), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L246-L250), dan [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L305-L397).
   - **Temuan:**
     - Grafik harian dan Breakdown Kategori Budget hanya merespons `activeWeek`, **mengabaikan** filter `walletFilter`, `typeFilter`, `categoryFilter`, dan `search`.
     - Dropdown `Kategori` (`#flt-cat`) hanya diisi dari `data.categoryTotals` (hanya kategori pengeluaran yang punya transaksi di periode itu), sehingga user tidak dapat memfilter kategori pemasukan (mis. `Gaji`, `Bonus`) maupun `Transfer` / `Penyesuaian Saldo`.
     - `TransactionsPage` tidak memiliki kontrol navigator periode (`< Periode >`); user harus kembali ke tab `Ringkasan` untuk mengganti bulan.
     - Tooltip chart di baris 286 menampilkan ``labelFormatter={(label) => `Tanggal ${label}`}`` yang hanya mencetak angka hari (`"Tanggal 05"`) tanpa bulan/tahun.

3. **Silent Validation Failure & Missing Error Handling di Form**
   - **Lokasi:** [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx#L151-L157), [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx#L329), [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx#L417), [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx#L466), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L58-L67), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L380-L386), [`AddDebtModal.tsx`](../../app/client/src/components/AddDebtModal.tsx#L9-L65).
   - **Temuan:**
     - Submit dompet baru tanpa nama, budget dengan nilai kosong/0, atau kategori baru tanpa nama di `SettingsPage` tidak menampilkan pesan validasi apa pun (silent no-op).
     - `budgetMutation` di `TransactionsPage` dan `deleteBudgetMutation` di `SettingsPage` tidak memiliki handler `onError` sehingga kegagalan API tidak memberi umpan balik ke user.
     - `AddDebtModal` tidak me-reset state form (`lender`, `kind`, `count`, `firstDueDate`, `paymentMethod`, `error`) saat ditutup dan dibuka ulang; dan `ReconcileModal` memakai `parsePositiveInt` sehingga tidak bisa memasukkan saldo negatif jika terjadi overdraft.

---

### 3.2 Styling, CSS & Responsivitas

1. **Konflik Override Class pada Hero Button di `OverviewPage`**
   - **Lokasi:** [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx#L128-L135) dan [`UI.tsx`](../../app/client/src/components/UI.tsx#L6-L32).
   - **Temuan:** Tombol `"Sesuaikan Saldo Awal"` memakai `Button variant="secondary"` (yang menerapkan `bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface)]`) sekaligus menimpanya dengan `bg-transparent text-[var(--hero-foreground)]`. Mengandalkan urutan CSS utility Tailwind v4 untuk menimpa warna antar-token rawan menghasilkan kontras teks buruk saat hover (di light mode `--surface` sangat terang dengan teks putih `--hero-foreground`). Lebih aman membuat variant khusus (mis. `hero-outline`) atau class eksplisit tanpa `variant="secondary"`.

2. **Label `h1` pada `OverviewPage` & Kontrol Angka Input**
   - **Lokasi:** [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx#L112) dan [`SplitPayModal.tsx`](../../app/client/src/components/SplitPayModal.tsx#L114-L128).
   - **Temuan:**
     - Di `OverviewPage`, tag `<h1>` dipasang langsung pada angka nominal `Rp...` bukan pada konteks judul halaman/ringkasan.
     - Input `type="number"` seperti `#sp-count` dan `#debt-count` mengizinkan karakter `e`, `.`, `-` diketik di browser desktop sebelum validasi JS menangkapnya.

---

### 3.3 Accessibility (WCAG 2.1 AA)

1. **Focus Trap Belum Terimplementasi & Focus Jump Bug di `ModalSheet`**
   - **Lokasi:** [`ModalSheet`](../../app/client/src/components/UI.tsx#L110-L196) dan [`App.tsx`](../../app/client/src/App.tsx#L495-L534).
   - **Temuan:**
     - Walaupun `docs/DESIGN.md` mensyaratkan focus trap pada bottom sheet dan dialog, `ModalSheet` hanya menangani tombol `Escape` dan restore focus. Penekanan `Tab` / `Shift+Tab` dapat memindahkan fokus ke elemen navigasi di belakang backdrop.
     - `useEffect` di `ModalSheet` bergantung pada `[open, onClose]`. Karena `App.tsx` mengirim inline function baru untuk `onClose` di setiap render, setiap kali `App` re-render saat modal terbuka (mis. refetch query atau toast timeout), cleanup `useEffect` mengembalikan fokus ke `triggerRef` lalu memindahkan fokus paksa kembali ke elemen pertama modal!

2. **Tap Target `< 44px` pada Beberapa Tombol Aksi Sekunder**
   - **Lokasi:** [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx#L247-L253) (`Kelola CC`), [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx#L304-L310) (`Lihat Semua`), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L343-L365) (`Ubah Limit`, `Atur Batas Budget`).
   - **Temuan:** Tombol-tombol `<button>` inline tersebut tidak memiliki `min-h-[44px]`, sehingga ukuran klik/sentuh vertikalnya hanya sekitar `16–20px` (melanggar standar tap target minimum `44 x 44 px` di `DESIGN.md`).

3. **WAI-ARIA Tab Pattern Tidak Lengkap di `QuickAddSheet`**
   - **Lokasi:** [`QuickAddSheet.tsx`](../../app/client/src/components/QuickAddSheet.tsx#L239-L285).
   - **Temuan:** Menggunakan `role="tablist"` dan `role="tab"`, namun belum memiliki navigasi keyboard `ArrowLeft`/`ArrowRight` serta atribut `aria-controls` / `role="tabpanel"`.

---

### 3.4 Client-Side Caching, PWA & Bundle/Rendering Performance

1. **PWA Belum Dikonfigurasi Meskipun Dependensi Sudah Terpasang**
   - **Lokasi:** [`app/package.json`](../../app/package.json#L39), [`app/vite.config.ts`](../../app/vite.config.ts#L1-L22), [`app/client/index.html`](../../app/client/index.html#L1-L30).
   - **Temuan:** `vite-plugin-pwa` ada di `devDependencies`, namun belum diaktifkan di `vite.config.ts`, dan `index.html` belum memiliki `<link rel="manifest">`, icon PWA (`192x192`, `512x512`, `apple-touch-icon`), maupun caching offline untuk font Google Fonts.

2. **Eager Bundling `Recharts` & Tidak Ada `ErrorBoundary`**
   - **Lokasi:** [`app/client/src/App.tsx`](../../app/client/src/App.tsx#L28-L31) dan [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L3-L11).
   - **Temuan:**
     - Keempat halaman (`OverviewPage`, `TransactionsPage`, `DebtsPage`, `SettingsPage`) di-import secara statis di `App.tsx`. Akibatnya bundle `recharts` ikut dimuat saat membuka LockScreen atau tab Ringkasan.
     - Belum ada React `ErrorBoundary` di `main.tsx` / `App.tsx` untuk menangkap runtime error render dan menyediakan tombol pemulihan (reload/retry).

3. **Loading/Empty/Error States di `TransactionsPage` & `App.tsx`**
   - **Lokasi:** [`App.tsx`](../../app/client/src/App.tsx#L350-L370) dan [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx#L401-L416).
   - **Temuan:** Loading dan Error state di `App.tsx` memblokir seluruh halaman jika salah satu dari `dashboardQuery` atau `debtsQuery` gagal. Sebagai contoh, jika hanya `GET /api/debts` bermasalah, tab `Ringkasan` dan `Transaksi` ikut tertutup layar error.

---

## 4. Testing, Tooling & Developer Experience

### 4.1 Audit Test Coverage (`app/server/src/api.test.ts`)

File [`app/server/src/api.test.ts`](../../app/server/src/api.test.ts) sudah memakai fondasi yang tepat (SQLite `:memory:` per test, migrasi Drizzle asli, dan test end-to-end via `app.request`). Namun cakupannya baru meliputi 4 kelompok test (5 `it(...)`) dan **belum menguji banyak jalur kritis**:

- **Belum ada test Frontend sama sekali:** Tidak ada unit test untuk [`app/client/src/lib/format.ts`](../../app/client/src/lib/format.ts) (`buildWeekSlices`, `currentPeriodForCycle`, `formatCompactRupiah`) maupun component/E2E test UI.
- **Skenario Backend yang Belum Teruji di `api.test.ts`:**
  1. `GET /api/dashboard?cycle=cc&period=...` (cabang `cycle === "cc"` termasuk navigasi ke siklus CC lama/baru dan sinkronisasi biaya bank).
  2. Validasi tanggal kalender invalid (seperti `2026-02-31`) dan boundary `gajianStartDay = 1` / `cardCutoffDay = 1`.
  3. Double-settlement pada `ccCycleKey` yang sama & partial/custom settlement CC.
  4. `PATCH /api/transactions/:id` (khususnya proteksi terhadap `income` ke `credit_card`, dan edit transaksi yang sudah di-Split Pay).
  5. `DELETE /api/transactions/:id` pada transaksi `settlement` (verifikasi rollback installment) dan penolakan `409` pada transaksi Split Pay.
  6. Deduplikasi `sourceRef` pada `POST /api/transactions` (`duplicate: true`).
  7. `POST /api/auth/change-pin` & `POST /api/auth/logout`.
  8. CRUD `wallets`, `categories` (termasuk conflict 409 case-insensitive), `settings` (sinkronisasi ke wallet CC), dan `export?format=json`.

### 4.2 Tooling, Scripts & Developer Experience

- **Linting & Formatting:** `app/package.json` belum memiliki `eslint`, `biome`, atau `prettier`. Bug seperti `useEffect` missing dependencies di `QuickAddSheet.tsx` dan inconsistent naming di seed dapat dicegah sejak dini dengan Biome/ESLint.
- **Production Scripts & Env:** `app/package.json` belum memiliki script `"start": "bun run server/src/index.ts"` untuk deployment VPS, dan belum ada validasi `SESSION_SECRET` pada mode produksi (`NODE_ENV === "production"`).
- **Root Workspace Discoverability:** Tidak ada `README.md` atau `package.json` di root repo untuk mengarahkan developer masuk ke `app/` saat menjalankan perintah.

---

## 5. Actionable Refactoring & Implementation Backlog

### Prioritas P0 (Wajib Sebelum Deploy VPS / Penggunaan Harian Intensif)

1. **Perbaiki Sinkronisasi `ensureMonthlyBankFees` & Hindari Side-Effect Write pada `GET` Masa Depan**
   - **Target:** [`app/server/src/lib/ledger.ts`](../../app/server/src/lib/ledger.ts#L55-L96), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L294-L308).
   - **Implementasi:**
     - Pindahkan logika auto-fee untuk `selectedPeriod` **sebelum** `computeLedgerSnapshot` (atau buat `ensureMonthlyBankFees` hanya berjalan untuk siklus yang sudah masuk tanggal statement/cutoff `<= today`, jangan pernah membuat biaya bank untuk siklus masa depan).
     - Ganti pengecekan duplikasi di `ensureMonthlyBankFees` dari `merchant.includes(fee.match)` menjadi pengecekan `sourceRef` (`auto-fee-${cycleKey}-${fee.key}`) atau gabungan `source === "system" && merchant === fee.merchant`.

2. **Perketat Integritas `settleObligations`, `unsettleInstallment`, & Hapus Hardcode `"2026-10"`**
   - **Target:** [`app/server/src/lib/ledger.ts`](../../app/server/src/lib/ledger.ts#L223-L226), [`ledger.ts`](../../app/server/src/lib/ledger.ts#L800-L956).
   - **Implementasi:**
     - Tolak `settleObligations` dengan HTTP `400`/`409` jika `ccCycleKey` sudah lunas (kecuali mode eksplisit top-up cicilan terpisah), atau simpan status pelunasan/pembayaran parsial per siklus CC secara eksplisit (mis. membandingkan `SUM(settlement.amount)` untuk `ccCycleKey` terhadap tagihan siklus atau mencegah double-submit).
     - Pada `unsettleInstallment`: jika `settlementTransactionId` terhubung ke transaksi `settlement` yang memiliki `ccCycleKey` (artinya pelunasan gabungan tagihan harian CC + cicilan Split Pay), **jangan** langsung menghapus transaksi `settlement` tanpa mengonfirmasi/memisahkan porsi cicilan vs tagihan harian CC.
     - Ganti kondisi `if (cycleKey <= "2026-10") return true;` dengan penandaan eksplisit di DB (mis. `app_settings.legacySettledBeforeCycle` atau record settlement historis saat `migrate-legacy.ts`) agar fresh install tidak terpengaruh.

3. **Validasi Ketat `PATCH /api/transactions/:id` & Kalender Tanggal + Bug `day = 1` di `dates.ts`**
   - **Target:** [`app/server/src/routes/transactions.ts`](../../app/server/src/routes/transactions.ts#L13-L16), [`transactions.ts`](../../app/server/src/routes/transactions.ts#L129-L173), [`app/server/src/lib/dates.ts`](../../app/server/src/lib/dates.ts#L63-L86).
   - **Implementasi:**
     - Buat helper `isValidIsoDate(v: string): boolean` yang mem-parse `YYYY-MM-DD` dan memverifikasi `d.toISOString().slice(0, 10) === v` (menolak `2026-02-31`), lalu pakai bersama di `transactions.ts`, `debts.ts`, dan `wallets.ts`.
     - Pada `PATCH /api/transactions/:id`: tolak jika `existing.isConvertedToInstallment === true` (untuk perubahan `amount`, `walletId`, `type`, `transactionDate`) dan terapkan pengecekan `wallet.type === "credit_card" && nextType === "income" -> 400`.
     - Perbaiki `periodBounds`: saat `gajianStartDay === 1`, `end` adalah hari terakhir bulan tersebut (`new Date(Date.UTC(year, month, 0))`). Saat `cardCutoffDay === 1`, `closingDay` adalah hari terakhir bulan sebelumnya (`new Date(Date.UTC(year, month - 1, 0))`) dan `start` mundur sesuai siklus.

4. **Bungkus Operasi Multi-Step ke `db.transaction` & Amankan Production Auth/Server**
   - **Target:** [`ledger.ts`](../../app/server/src/lib/ledger.ts#L765-L798) (`reconcileWalletBalance`), [`transactions.ts`](../../app/server/src/routes/transactions.ts#L175-L215) (`DELETE`), [`auth.ts`](../../app/server/src/lib/auth.ts#L44-L46), [`export.ts`](../../app/server/src/routes/export.ts#L6-L12), [`index.ts`](../../app/server/src/index.ts#L15-L19), [`app.ts`](../../app/server/src/app.ts).
   - **Implementasi:**
     - Bungkus `reconcileWalletBalance` dan `DELETE /api/transactions/:id` dalam `db.transaction(...)` (jalankan kalkulasi saldo di dalam transaksi SQLite agar atomik).
     - Wajibkan `process.env.SESSION_SECRET` (>= 32 karakter, bukan placeholder default) ketika `NODE_ENV === "production"`.
     - Tambahkan prefix `'` pada `escapeCsvCell` bila string teks diawali `=`, `+`, `-`, `@`, `\t`, atau `\r` (kecuali kolom angka murni seperti `amount` negatif pada `adjustment`).
     - Tambahkan `app.notFound` JSON `404` khusus `/api/*` sebelum SPA fallback `serveStatic`, tambahkan `app.onError` global JSON handler, dan resolusi path memakai `import.meta.dir` bukan `process.cwd()`.

---

### Prioritas P1 (Peningkatan Kualitas, UX & Reliabilitas)

5. **Sharing Kontrak DTO di `app/shared/src/` & Hilangkan Duplikasi Helper**
   - **Target:** [`app/shared/src/types.ts`](../../app/shared/src/types.ts), [`app/client/src/lib/api.ts`](../../app/client/src/lib/api.ts), [`app/server/src/routes/budgets.ts`](../../app/server/src/routes/budgets.ts), [`app/server/src/lib/ledger.ts`](../../app/server/src/lib/ledger.ts).
   - **Implementasi:**
     - Pindahkan seluruh DTO interface/type (`DashboardDto`, `DebtsDto`, `WalletDto`, `TransactionDto`, `BudgetItemDto`, `SettingsDto`) dan helper tanggal/period pure (`jakartaToday`, `shiftMonth`, `periodBounds`, `periodForDate`) ke `app/shared/src/` agar dipakai langsung oleh backend maupun frontend.
     - Satukan `resolveBudgetsForPeriod` antara `ledger.ts` dan `routes/budgets.ts`.

6. **Perbaiki UX Manajemen Transaksi, Budget di Settings, & Konsistensi Filter**
   - **Target:** [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx), [`SettingsPage.tsx`](../../app/client/src/pages/SettingsPage.tsx), [`QuickAddSheet.tsx`](../../app/client/src/components/QuickAddSheet.tsx), [`App.tsx`](../../app/client/src/App.tsx).
   - **Implementasi:**
     - Izinkan aksi **Hapus** (dengan konfirmasi 2 langkah di detail/row atau modal) untuk transaksi `transfer`, `settlement`, dan `adjustment`.
     - Di `SettingsPage`, muat template budget `"default"` menggunakan `api.getBudgets` atau field khusus dari API agar tombol hapus tidak menghapus override siklus aktif secara keliru; tambahkan pesan validasi inline pada semua form (dompet, kategori, budget).
     - Di `TransactionsPage`: simpan state filter di `App.tsx` (atau URL query params) agar tidak hilang saat pindah tab; tambahkan navigator periode di `TransactionsPage`; ganti `key.endsWith("-25")` dan label `tgl 25` memakai `data.settings.gajianStartDay`; isi filter kategori dari `data.categories` (dikelompokkan expense/income) atau sertakan kategori non-expense.
     - Di `QuickAddSheet`: pertahankan kategori lama transaksi saat edit meskipun kategori tersebut sudah di-archive, dan lengkapi dependency array `useEffect` (atau pecah form state menjadi komponen key-reset saat `editingTx?.id` / `open` berubah).

7. **Perbaiki Aksesibilitas (`ModalSheet` Focus Trap, Tap Target >= 44px, & Toast Timer)**
   - **Target:** [`UI.tsx`](../../app/client/src/components/UI.tsx#L110-L196), [`App.tsx`](../../app/client/src/App.tsx#L74-L77), [`OverviewPage.tsx`](../../app/client/src/pages/OverviewPage.tsx), [`TransactionsPage.tsx`](../../app/client/src/pages/TransactionsPage.tsx).
   - **Implementasi:**
     - Stabilkan `onClose` di `ModalSheet` menggunakan `useRef` agar `useEffect` tidak ter-trigger ulang saat parent re-render, dan tambahkan keyboard `Tab`/`Shift+Tab` focus trap di dalam `panelRef.current`.
     - Naikkan ukuran tap target tombol `Kelola CC`, `Lihat Semua`, `Ubah Limit`, dan `Atur Batas Budget` ke `min-h-[44px] inline-flex items-center`.
     - Simpan timer ID di `useRef` pada `showToast` (`clearTimeout` sebelum `setTimeout` baru), dan ganti hero button di `OverviewPage` agar tidak bertabrakan dengan style `variant="secondary"`.

8. **Perluas Test Suite (`api.test.ts` + Unit Test Client)**
   - **Target:** [`app/server/src/api.test.ts`](../../app/server/src/api.test.ts), [`app/server/src/db/index.ts`](../../app/server/src/db/index.ts).
   - **Implementasi:**
     - Pisahkan factory `createDb` dengan instance singleton aplikasi agar import saat `bun test` tidak menciptakan file DB fisik.
     - Tambahkan test untuk: `GET /api/dashboard?cycle=cc`, validasi tanggal `2026-02-31`, `periodBounds` hari `1`, double-settle CC, `PATCH` transaksi CC Split Pay & `income` ke CC, `DELETE` settlement rollback, `sourceRef` deduplication, `change-pin`, serta unit test `format.ts` (`buildWeekSlices`, `currentPeriodForCycle`).

---

### Prioritas P2 (Optimasi Performa, PWA & DX)

9. **Aktifkan `vite-plugin-pwa`, Code Splitting & `ErrorBoundary`**
   - **Target:** [`app/vite.config.ts`](../../app/vite.config.ts), [`app/client/index.html`](../../app/client/index.html), [`app/client/src/App.tsx`](../../app/client/src/App.tsx), [`app/client/src/main.tsx`](../../app/client/src/main.tsx).
   - **Implementasi:**
     - Konfigurasikan `VitePWA` di `vite.config.ts` dengan web manifest (ikon `192x192`, `512x512`, `theme_color: "#00797a"`) serta strategi `NetworkFirst` untuk `/api/*` dan `CacheFirst` untuk aset statis/font.
     - Gunakan `React.lazy` + `Suspense` untuk `TransactionsPage` (memisahkan bundle `recharts`), `DebtsPage`, dan `SettingsPage` agar load awal di mobile cepat.
     - Bungkus `<App />` dengan React `ErrorBoundary` yang menampilkan UI fallback konsisten dengan `StateView`.

10. **Optimasi Query Ledger & Tooling DX (`Biome`, `start` script, Indexes)**
    - **Target:** [`app/package.json`](../../app/package.json), [`app/server/src/db/schema.ts`](../../app/server/src/db/schema.ts), [`app/server/src/lib/ledger.ts`](../../app/server/src/lib/ledger.ts).
    - **Implementasi:**
      - Tambahkan index pada `installments.settlementTransactionId`, `transactions.toWalletId`, dan `transactions.convertedAccountId`, serta pertimbangkan agregasi SQL untuk saldo dompet all-time alih-alih memuat seluruh histori transaksi di setiap request.
      - Tambahkan `start` script di `app/package.json`, pasang **Biome** (lint + format) dengan aturan `react-hooks/exhaustive-deps` & `noUnusedVariables`, dan pisahkan/cache pemanggilan `computeLedgerSnapshot` agar `dashboard` dan `debts` tidak mengulang query identik saat mount bersamaan.
