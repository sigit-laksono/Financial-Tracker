# Task List Phase 6: Evolusi Skema Skala Tahun, Observability & Deployment VPS

**Referensi:** [PRD.md](../PRD.md) | [DESIGN.md](../DESIGN.md) | [software-architect.md](../improve-analiysis/software-architect.md) | [senior-developer.md](../improve-analiysis/senior-developer.md)  
**Prasyarat:** Phase 5 selesai.  
**Status:** Implementasi & Verifikasi Lokal Selesai (Menunggu Go-Live VPS Target)  
**Target Milestone:** Memastikan kesiapan jangka panjang untuk data ribuan transaksi lintas tahun (evolusi skema relasional + query agregasi SQL), observability operasional, backup otomatis SQLite WAL, dan go-live di VPS Linux via HTTPS.

---

## 1. Evolusi Skema Database & Integritas Referensial (`0003_condemned_nightmare.sql`)
- [x] Desain dan generate migrasi SQLite baru di `app/server/src/db/schema.ts` & `app/drizzle/`:
  - [x] Tambahkan tabel `settlement_allocations` (`settlement_transaction_id`, `target_type`, `installment_id`, `cc_wallet_id`, `cc_cycle_key`, `allocated_amount`) untuk mendukung many-to-many settlement, pembayaran parsial CC, multi-CC, dan `unsettle` aman.
  - [x] Tambahkan `transfer_group_id` pada `transactions` untuk mengikat pasangan transfer dan biaya admin secara atomik saat edit/hapus.
  - [x] Tambahkan relasi `category_id` FK ke `categories.id` (dengan backfill data eksisting agar rename kategori tidak memutus histori transaksi dan budget).
  - [x] Tambahkan SQLite `CHECK` constraints (`amount` valid, `to_wallet_id IS NULL OR to_wallet_id != wallet_id`) serta composite indexes (`transactions(wallet_id, transaction_date)`, `transactions(type, transaction_date)`, `transactions(to_wallet_id)`, `transactions(converted_account_id)`, `installments(settlement_transaction_id)`).
  - [x] Tambahkan tabel `audit_logs` (`entity_type`, `entity_id`, `action`, `before_json`, `after_json`, `created_at`) untuk mencatat mutasi sensitif (edit/hapus transaksi, rekonsiliasi saldo, unsettle cicilan, perubahan settings/PIN).
- [x] Buat & uji script backfill/migrasi data terhadap database lokal eksisting agar total saldo dompet, kewajiban, dan histori cicilan sebelum & sesudah migrasi tetap 100% identik (`bun run db:audit` -> `AUDIT PASSED`).

## 2. Skalabilitas Query Ledger & Pagination
- [x] Refaktor query laporan di `app/server/src/lib/` agar tidak melakukan full-table scan in-memory pada setiap request:
  - [x] Hitung saldo dompet all-time dan agregasi periode menggunakan SQLite aggregate queries (`SUM(CASE WHEN ...)` + filter `BETWEEN` memanfaatkan composite index).
  - [x] Tambahkan pagination / cursor berbasis tanggal (`GET /api/transactions`) dan UI `TransactionsPage.tsx` (`"Muat Lebih Banyak"`) agar tetap ringan saat histori mencapai 10.000+ baris.
- [x] Lakukan benchmark query dan pengukuran ukuran payload/latensi endpoint `/api/dashboard` dan `/api/debts` menggunakan dataset sintetis ribuan transaksi (5.000 transaksi: `buildDashboardData` + `buildDebtsData` selesai dalam `33.27ms`).

## 3. Observability & Readiness
- [x] Tambahkan structured JSON request logging di `app/server/src/app.ts` (`requestId`, `method`, `path`, `status`, `durationMs`, header `X-Request-Id`) tanpa mencatat payload sensitif (PIN/token).
- [x] Tingkatkan `GET /api/health` dengan readiness check database (`SELECT 1` pada SQLite, `200`/`503`) dan metadata versi build.

## 4. Packaging, Backup Otomatis & Go-Live VPS Linux
- [x] Tambahkan graceful shutdown (`SIGINT` / `SIGTERM`) di `app/server/src/index.ts` untuk menghentikan HTTP server, menjalankan `PRAGMA wal_checkpoint(TRUNCATE)`, dan menutup koneksi SQLite (`sqlite.close()`).
- [x] Tambahkan script `"start": "bun run server/src/index.ts"` di `app/package.json` serta dokumentasi `README.md` di root repository untuk panduan dev, migrasi, dan deploy.
- [x] Siapkan artifak deployment VPS Linux & verifikasi Docker Desktop build + container smoke test lokal (`Dockerfile`, `docker-compose.yml`, `.dockerignore`, `deploy/financial-tracker.service`, `deploy/Caddyfile`, `deploy/nginx.conf.example`):
  - [x] `Dockerfile` multi-stage (build Vite frontend + runtime Bun minimal) & `docker-compose.yml` dengan persistent volume `/app/data`, plus template service `systemd`.
  - [x] Konfigurasi reverse proxy `deploy/Caddyfile` / `deploy/nginx.conf.example` untuk terminasi HTTPS otomatis (cookie `Secure`) dan forwarding `TRUST_PROXY=true`.
- [x] Siapkan script cron backup otomatis SQLite WAL menggunakan `sqlite3 ... ".backup ..."` (`scripts/backup-sqlite.sh` & `scripts/restore-sqlite.sh`) beserta rotasi retensi harian/mingguan, telah diuji eksekusinya di container Docker (`PRAGMA integrity_check`).
- [ ] Jalankan smoke test deployment end-to-end di VPS target (HTTPS aktif, cookie `HttpOnly; Secure`, login PIN, catat transaksi, backup & uji restore DB) dan arsipkan catatan rilis.
