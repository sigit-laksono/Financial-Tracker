# PRD — Milestone 17: Migrasi Database ke PostgreSQL (Scalable Relational Architecture)

## 1. Latar Belakang & Motivasi

Aplikasi Financial Tracker saat ini menggunakan **SQLite WAL (`bun:sqlite`)** yang berjalan secara embedded di dalam kontainer server. Meskipun SQLite sangat cepat, zero-config, dan andal untuk penggunaan personal single-node, arsitektur ini memiliki batasan struktural jika aplikasi ingin ditingkatkan skalanya (*scaled up*):

1. **Konkurensi Tulis Terbatas (*Single-Writer Lock*):**
   SQLite menerapkan *database-level locking* untuk operasi tulis. Jika di masa depan ada multi-user, background workers (misal otomatisasi sync mutasi bank, scheduler, ekspor report berkala), antrean penulisan bisa memicu `SQLITE_BUSY` error.
2. **Kopling Erat dengan File System Kontainer (*Storage Coupling*):**
   Database SQLite berbentuk satu file (`financial-tracker.db`). Ini menyulitkan horizontal scaling (multi-container replika) karena kontainer tidak bisa berbagi satu file SQLite secara terdistribusi tanpa risiko korupsi WAL.
3. **Kesiapan Cloud-Native & Managed Database:**
   Dengan beralih ke **PostgreSQL**, aplikasi siap dideploy menggunakan database terpisah (*Dedicated Database Server*) baik secara on-premise (Docker), VPS mandiri, maupun cloud managed database (seperti Supabase, Neon, AWS RDS, atau DigitalOcean Managed DB).
4. **Pencegahan Hutang Teknis (*Eliminating Technical Debt Early*):**
   Semakin banyak fitur dan relasi tabel dibuat, semakin mahal biaya migrasi di kemudian hari. Merancang arsitektur PostgreSQL sekarang akan mengunci standar enterprise sejak dini.

---

## 2. Analisis Kesenjangan Teknis: SQLite vs PostgreSQL (Drizzle ORM)

Migrasi dari `drizzle-orm/bun-sqlite` ke `drizzle-orm/postgres-js` melibatkan beberapa perbedaan fundamental:

| Aspek Arsitektur | SQLite WAL Saat Ini (`bun:sqlite`) | PostgreSQL Target (`postgres` + `drizzle-orm/postgres-js`) |
| :--- | :--- | :--- |
| **Driver Engine** | Embedded C-binding `bun:sqlite` | TCP Network Driver `postgres` (porsager) / `bun:sql` |
| **Drizzle Dialect** | `drizzle-orm/bun-sqlite` (`sqliteTable`) | `drizzle-orm/postgres-js` (`pgTable`) |
| **Eksekusi Kueri** | Sinkron & Tersedia `.all()` / `.get()` | Murni **Asinkron (Promise)** $\rightarrow$ `await db.select().from(...)` |
| **Transaksi Atomik** | `db.transaction((tx) => ...)` (Sinkron) | `await db.transaction(async (tx) => ...)` (Asinkron) |
| **Tipe Data Boolean** | `integer({ mode: "boolean" })` (0 / 1) | Native `boolean("...")` (`true` / `false`) |
| **Primary Key ID** | `integer().primaryKey({ autoIncrement: true })` | `serial("id").primaryKey()` atau `integer().generatedAlwaysAsIdentity()` |
| **Sequence Auto-inc** | Otomatis diatur SQLite sqlite_sequence | PostgreSQL Sequences (memerlukan `setval` setelah impor ETL) |
| **Date & Timestamps** | ISO-8601 string (`text`) | `varchar(10)` untuk tanggal kalender (`YYYY-MM-DD`) dan `timestamp with time zone` untuk audit |
| **Koneksi & Pooling** | PRAGMA busy_timeout, wal_checkpoint | Connection Pool (`max: 10`, `idle_timeout`, SSL mode) |

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Dependensi & Driver Database
- Pasang driver PostgreSQL berkinerja tinggi untuk Bun:
  ```bash
  bun add postgres
  ```
- Konfigurasi `drizzle.config.ts`:
  - Ubah `dialect: "sqlite"` menjadi `dialect: "postgresql"`.
  - Arahkan ke environment variable `DATABASE_URL` (format: `postgres://user:password@host:port/dbname`).

### B. Konversi 14 Skema Tabel (`app/server/src/db/schema.ts`)
Konversi seluruh tabel dari `sqliteTable` menjadi `pgTable`:
1. `wallets` (id, key, name, type, role, opening_balance, credit_limit, cutoff_day, payment_day, dll.)
2. `categories` (id, name, type, icon, color, is_mandatory, is_system)
3. `debt_accounts` (id, name, lender, kind, direction, initial_balance, remaining_balance, dll.)
4. `installments` (id, account_id, period, due_date, planned_amount, status, dll.)
5. `transactions` (id, type, merchant, amount, transaction_date, category_id, wallet_id, cc_cycle_key, dll.)
6. `settlement_allocations` (id, source_transaction_id, target_installment_id, allocated_amount)
7. `budgets` (id, period, category_id, limit_amount)
8. `goals` (id, name, target_amount, current_amount, target_date, target_wallet_id, dll.)
9. `assets` (id, name, type, value, purchase_date, purchase_price, wallet_id, dll.)
10. `audit_logs` (id, entity, entity_id, action, before_snapshot, after_snapshot, created_at)
11. `wallet_recurring_fees` (id, wallet_id, name, amount, day_of_month, category)
12. `transaction_splits` (id, transaction_id, category_id, amount, note)
13. `recurring_rules` (id, merchant, amount, category_id, wallet_id, due_day, is_active)
14. `app_settings` (id, gajian_start_day, card_cutoff_day, card_payment_day, pin_hash, session_secret)

### C. Refaktor Query Layer & Transaksi Asinkron
- Ganti panggilan `.all()` dan `.get()` menjadi sintaks standar Drizzle PostgreSQL:
  - `.all()` $\rightarrow$ `await db.select()...`
  - `.get()` $\rightarrow$ `(await db.select()...limit(1))[0]`
- Ubah seluruh pemanggilan `db.transaction((tx) => ...)` menjadi:
  ```ts
  await db.transaction(async (tx) => {
    // async queries inside transaction
  });
  ```
- File utama yang terdampak refaktor async:
  - `app/server/src/lib/cashLedger.ts`
  - `app/server/src/lib/debtEngine.ts`
  - `app/server/src/lib/salaryService.ts`
  - `app/server/src/routes/transactions.ts`
  - `app/server/src/routes/installments.ts`

### D. Skrip Migrasi Data (ETL: SQLite $\rightarrow$ PostgreSQL)
Buat skrip migrasi mandiri `scripts/migrate-sqlite-to-postgres.ts`:
1. Membaca seluruh data yang ada di `financial-tracker.db`.
2. Melakukan transformasi tipe data (0/1 menjadi boolean, string ISO ke timestamp jika diperlukan).
3. Melakukan insert batch secara sekuensial menghormati relasi Foreign Key (Categories & Wallets lebih dulu, baru Transactions & Splits).
4. Menjalankan query PostgreSQL sequence sync untuk setiap tabel:
   ```sql
   SELECT setval(pg_get_serial_sequence('transactions', 'id'), COALESCE(MAX(id), 1)) FROM transactions;
   ```
5. Melakukan verifikasi rekonsiliasi total saldo dan jumlah transaksi sebelum vs sesudah migrasi.

### E. Infrastruktur Docker Compose
- Perbarui `docker-compose.yml`:
  - Tambahkan service `db` (`image: postgres:16-alpine`):
    - Volume `pg_data:/var/lib/postgresql/data`
    - Healthcheck `pg_isready -U ${POSTGRES_USER}`
    - Port internal `5432`
  - Perbarui service `app`:
    - `depends_on: { db: { condition: service_healthy } }`
    - Environment `DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`
- Sediakan opsi dual-run atau migrasi sekali jalan via container script.

---

## 4. Rencana Pengujian & Validasi

1. **Integrasi Test Suite:**
   - Menjalankan seluruh test suite (`server/src/api.test.ts` dan seluruh file di `__tests__/`) menggunakan database PostgreSQL pengujian (baik lokal container maupun test schema terisolasi).
2. **Benchmark 5.000 Transaksi:**
   - Memastikan endpoint `/api/dashboard` dan `/api/debts` tetap merespons di bawah 50ms pada dataset 5.000+ baris transaksi.
3. **Verifikasi Integritas Foreign Key:**
   - Memastikan relasi CASCADE, RESTRICT, dan CHECK constraints berfungsi persis seperti di SQLite.

---

## 5. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Driver PostgreSQL (`postgres`) dan skema `pgTable` terpasang tanpa dependensi ke SQLite di runtime production.
- [ ] Drizzle migration (`drizzle-kit generate` & `migrate`) berjalan sukses di PostgreSQL 16.
- [ ] Skrip ETL `scripts/migrate-sqlite-to-postgres.ts` berhasil memindahkan 100% data riil tanpa selisih Rp 1 pun pada saldo dompet, limit kartu kredit, dan riwayat transaksi.
- [ ] Seluruh endpoint API (`/api/dashboard`, `/api/transactions`, `/api/wallets`, `/api/debts`, `/api/auth`) berfungsi 100% normal.
- [ ] Konfigurasi `docker-compose.yml` menyertakan service PostgreSQL dengan volume persisten dan healthcheck readiness.
- [ ] Seluruh automated test suite (`bun test`) lulus 100% (45+ tests pass).
- [ ] Pemeriksaan `bun run typecheck` dan `bun run lint` bersih dengan 0 error.
