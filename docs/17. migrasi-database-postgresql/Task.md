# Task List — Milestone 17: Migrasi Database ke PostgreSQL

> **Referensi Spesifikasi:** `docs/17. migrasi-database-postgresql/PRD.md`

---

### 1. Persiapan Dependensi & Konfigurasi Drizzle

- [x] Pasang driver PostgreSQL berkinerja tinggi untuk runtime Bun:
  ```bash
  cd app && bun add postgres
  ```
- [x] Perbarui `app/drizzle.config.ts`:
  - [x] Ganti `dialect: "sqlite"` menjadi `dialect: "postgresql"`.
  - [x] Arahkan skema ke `server/src/db/schema.ts`.
  - [x] Arahkan output migrasi ke `server/src/db/drizzle-pg/` atau perbarui folder migrasi.
  - [x] Konfigurasi parameter `dbCredentials: { url: process.env.DATABASE_URL }`.
- [x] Perbarui file environment `.env.example`:
  - [x] Tambahkan template `DATABASE_URL=postgres://postgres:postgres@localhost:5432/financial_tracker`.

---

### 2. Konversi Skema Tabel Drizzle (SQLite $\rightarrow$ PostgreSQL)

- [x] Ubah import di `app/server/src/db/schema.ts` dari `drizzle-orm/sqlite-core` ke `drizzle-orm/pg-core`:
  - [x] Ganti `sqliteTable` $\rightarrow$ `pgTable`.
  - [x] Ganti auto-increment primary key `integer({ autoIncrement: true })` $\rightarrow$ `serial("id").primaryKey()`.
  - [x] Ganti `integer({ mode: "boolean" })` $\rightarrow$ native `boolean()`.
  - [x] Tentukan tipe data teks tanggal (`varchar(10)` untuk format `YYYY-MM-DD`).
  - [x] Tentukan tipe data timestamp dengan timezone untuk audit logs dan timestamps.
- [x] Konversi ke-14 skema tabel:
  - [x] `wallets`
  - [x] `categories`
  - [x] `debtAccounts`
  - [x] `installments`
  - [x] `transactions` (indeks `ccCycleKey`, `transactionDate`, `walletId`)
  - [x] `settlementAllocations`
  - [x] `budgets`
  - [x] `goals`
  - [x] `assets`
  - [x] `auditLogs`
  - [x] `walletRecurringFees`
  - [x] `transactionSplits`
  - [x] `recurringRules`
  - [x] `appSettings`
- [x] Jalankan generator migrasi Drizzle untuk membuat file SQL PostgreSQL:
  ```bash
  bun --bun drizzle-kit generate
  ```

---

### 3. Refaktor Database Client & Asynchronous Transaction Layer

- [x] Refaktor `app/server/src/db/index.ts`:
  - [x] Inisialisasi koneksi `postgres(databaseUrl, { max: 10, idle_timeout: 20 })`.
  - [x] Inisialisasi Drizzle dengan `drizzle(client, { schema })`.
  - [x] Buat fungsi healthcheck `SELECT 1` untuk readiness probe.
- [x] Refaktor Query & Transaction Layer agar sepenuhnya asinkron (`Promise`-based):
  - [x] Hapus pemanggilan `.all()` dan `.get()` di seluruh route dan library (gunakan `await db.select()...`).
  - [x] Ubah transaksi sinkron `db.transaction((tx) => ...)` menjadi `await db.transaction(async (tx) => ...)` pada:
    - [x] `app/server/src/lib/cashLedger.ts`
    - [x] `app/server/src/lib/debtEngine.ts`
    - [x] `app/server/src/lib/salaryService.ts`
    - [x] `app/server/src/routes/transactions.ts`
    - [x] `app/server/src/routes/installments.ts`
    - [x] `app/server/src/routes/categories.ts`
    - [x] `app/server/src/routes/auth.ts`
  - [x] Perbarui `app/server/src/index.ts` untuk menjalankan auto-migrate Drizzle PostgreSQL saat startup.

---

### 4. Pembuatan Skrip ETL Migrasi Data (SQLite $\rightarrow$ PostgreSQL)

- [x] Buat file skrip `scripts/migrate-sqlite-to-postgres.ts`:
  - [x] Buka koneksi ke file sumber SQLite `financial-tracker.db` (`bun:sqlite`).
  - [x] Buka koneksi ke target PostgreSQL (`DATABASE_URL`).
  - [x] Implementasikan alur transfer data berurutan sesuai dependensi Foreign Key:
    1. `app_settings`
    2. `categories`
    3. `wallets`
    4. `debt_accounts`
    5. `installments`
    6. `recurring_rules`
    7. `wallet_recurring_fees`
    8. `transactions`
    9. `transaction_splits`
    10. `settlement_allocations`
    11. `budgets`
    12. `goals`
    13. `assets`
    14. `audit_logs`
  - [x] Lakukan sinkronisasi sequence PostgreSQL untuk setiap tabel auto-increment:
    ```sql
    SELECT setval(pg_get_serial_sequence('wallets', 'id'), COALESCE(MAX(id), 1)) FROM wallets;
    SELECT setval(pg_get_serial_sequence('transactions', 'id'), COALESCE(MAX(id), 1)) FROM transactions;
    -- dst untuk seluruh tabel
    ```
  - [x] Tambahkan validasi rekonsiliasi otomatis:
    - [x] Cocokkan total count baris per tabel antara SQLite dan PostgreSQL.
    - [x] Cocokkan `SUM(balance)` dompet dan `SUM(amount)` transaksi sebelum vs sesudah migrasi.

---

### 5. Konfigurasi Docker & Infrastruktur VPS

- [x] Perbarui `docker-compose.yml`:
  - [x] Tambahkan service database `db`:
    ```yaml
    db:
      image: postgres:16-alpine
      container_name: financial-tracker-db
      restart: unless-stopped
      environment:
        POSTGRES_USER: ${POSTGRES_USER:-ft_user}
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
        POSTGRES_DB: ${POSTGRES_DB:-financial_tracker}
      volumes:
        - pg_data:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-ft_user}"]
        interval: 10s
        timeout: 5s
        retries: 5
    ```
  - [x] Tambahkan volume `pg_data:` pada bagian `volumes:`.
  - [x] Hubungkan service `app` ke service `db` dengan `depends_on: { db: { condition: service_healthy } }`.
  - [x] Ubah environment `DATABASE_URL` pada service `app` menjadi URL PostgreSQL internal Docker.
- [x] Perbarui `Dockerfile` runner:
  - [x] Hapus dependensi package `sqlite3` dari apt-get runner (digantikan native network driver).
- [x] Buat skrip backup harian PostgreSQL `scripts/backup-postgres.sh` menggunakan `pg_dump`:
  - [x] Gantikan `scripts/backup-sqlite.sh` dengan `pg_dump -Fc` dan kompresi gzip.

---

### 6. Pengujian, Rekonsiliasi & Verifikasi Menyeluruh

- [x] Sesuaikan environment pengujian di `server/src/api.test.ts` dan folder `__tests__/` untuk berjalan di database PostgreSQL test.
- [x] Jalankan automated test suite:
  ```bash
  cd app && bun test
  ```
  - [x] Pastikan seluruh 45+ tes lulus 100%.
- [x] Jalankan pengujian tipe data & linting:
  ```bash
  cd app && bun run typecheck
  cd app && bun run lint
  ```
- [x] Uji coba eksekusi skrip ETL dengan database dummy lokal dan verifikasi kesesuaian data di UI.
- [x] Jalankan benchmark 5.000 transaksi untuk memastikan latensi kueri dashboard tetap di bawah target 50ms.
