# Task List Phase 4: Stabilisasi Core, Integritas Data & Keamanan Produksi

**Referensi:** [PRD.md](../PRD.md) | [DESIGN.md](../DESIGN.md) | [software-architect.md](../improve-analiysis/software-architect.md) | [senior-developer.md](../improve-analiysis/senior-developer.md)  
**Prasyarat:** Phase 3 selesai.  
**Status:** Selesai & Terverifikasi (`22 Nov 2026`)  
**Target Milestone:** Menutup seluruh temuan prioritas P0 (bug akuntansi/siklus, integritas mutasi DB, race condition SQLite, dan celah keamanan produksi) agar engine ledger serta REST API aman dan deterministik sebelum refactoring arsitektur maupun deploy VPS.

---

## 1. Perbaikan Domain, Siklus Tanggal & Integritas Ledger
- [x] Perbaiki `periodBounds` di `app/server/src/lib/dates.ts` untuk edge case `gajianStartDay === 1` dan `cardCutoffDay === 1` (hindari tumpang tindih tanggal `01` bulan berikutnya; gunakan hari terakhir bulan terkait untuk closing/end).
- [x] Buat helper validasi kalender `isValidIsoDate` (tolak tanggal overflow seperti `2026-02-31` dengan verifikasi `toISOString().slice(0, 10) === v`) dan terapkan seragam di `app/server/src/routes/transactions.ts`, `debts.ts`, dan `wallets.ts` (plus `yearMonthSchema` di `dashboard.ts`, `budgets.ts`, `export.ts`).
- [x] Perbaiki `ensureMonthlyBankFees` dan `buildDashboardData` di `app/server/src/lib/ledger.ts`:
  - [x] Pindahkan pemanggilan `ensureMonthlyBankFees` untuk `selectedPeriod` sebelum query `transactions` di `computeLedgerSnapshot` dan batasi agar hanya berjalan untuk siklus `<= currentCcCycle` sehingga `GET` periode masa depan tidak membuat transaksi biaya bank.
  - [x] Ganti deteksi duplikasi berbasis `merchant.includes(...)` menjadi `sourceRef` deterministik (`auto-fee-${cycleKey}-${fee.key}`) atau `source === "system" && merchant` exact match agar belanja manual bermuatan kata `"materai"`/`"notifikasi"` tidak memblokir biaya bank bulanan.
- [x] Perketat integritas pelunasan CC & cicilan di `app/server/src/lib/ledger.ts`:
  - [x] Cegah double-settlement pada `ccCycleKey` yang sudah berstatus lunas di `settleObligations` (`409 Conflict`) dan hitung pembayaran parsial (`customAmount`) secara akurat lewat `unpaidCcDailyForCycle`.
  - [x] Lindungi `unsettleInstallment` agar tidak menghapus transaksi `settlement` utama yang juga memayungi tagihan harian `ccCycleKey` saat membatalkan satu cicilan Split Pay (mengurangi nominal porsi cicilan, bukan menghapus pelunasan tagihan harian CC).
  - [x] Hilangkan hardcode `if (cycleKey <= "2026-10") return true;` di `isCycleSettled`; pindahkan penandaan siklus historis tersebut ke `appSettings.legacySettledBeforeCycle` (`0001_amazing_warbound.sql` & `migrate-legacy.ts`).
- [x] Perketat validasi `PATCH /api/transactions/:id` di `app/server/src/routes/transactions.ts`:
  - [x] Tolak `type === "income"` pada dompet bertipe `credit_card` (samakan dengan rule `POST`).
  - [x] Tolak perubahan `amount`, `walletId`, `type`, atau `transactionDate` pada transaksi yang sudah berstatus `isConvertedToInstallment === true` (`409`).
  - [x] Validasi eksistensi `category` terhadap tabel `categories` pada `POST` dan `PATCH`.
- [x] Amankan asumsi dompet CC (`POST /api/wallets` menolak pembuatan `credit_card` aktif kedua dengan `409`, `PATCH /api/wallets/:id` sinkron ke `appSettings`) dan tambahkan `isCurrentPeriod` di `buildDashboardData` untuk kejelasan konteks `Safe-to-Spend`.

## 2. Atomisitas Transaksi DB & Koneksi SQLite
- [x] Perkuat koneksi SQLite di `app/server/src/db/index.ts`:
  - [x] Tambahkan `PRAGMA busy_timeout = 5000;` dan `PRAGMA synchronous = NORMAL;`.
  - [x] Pisahkan factory `createDb(...)` dari inisialisasi singleton lazy (`getDb()`) agar impor modul di `bun test` (`:memory:`) tidak membuat file database fisik `./data/financial-tracker.db`.
- [x] Bungkus seluruh operasi multi-step yang rentan race condition ke dalam `db.transaction(...)`:
  - [x] `reconcileWalletBalance` di `app/server/src/lib/ledger.ts` (hitung saldo aktual dan insert `adjustment` secara atomik).
  - [x] `DELETE /api/transactions/:id` di `app/server/src/routes/transactions.ts` (cek `debtAccounts`, revert `installments`, dan hapus `transactions` secara atomik).
  - [x] Deduplikasi `sourceRef` pada `POST /api/transactions` menggunakan `onConflictDoNothing` + re-select agar request paralel dengan `sourceRef` sama tidak error `500`.
  - [x] `PATCH /api/debts/:id/close` dan `POST /api/auth/setup` (conditional update `WHERE pin_hash IS NULL`).

## 3. Keamanan, Error Handling & Kontrak HTTP API
- [x] Pengerasan autentikasi & session di `app/server/src/lib/auth.ts` dan `app/server/src/routes/auth.ts`:
  - [x] Wajibkan `process.env.SESSION_SECRET` non-default (>= 32 karakter) saat `NODE_ENV === "production"` (fail-fast saat startup).
  - [x] Tambahkan `sessionVersion` di `appSettings` dan payload token `ft_session` agar `POST /api/auth/change-pin` dan `POST /api/auth/logout-all` / `logout?all=true` merevokasi token lama.
  - [x] Terapkan rate limiting pada verifikasi `currentPin` di `POST /api/auth/change-pin` (namespace terpisah dari `login`) dan tambahkan pembersihan entry expired pada `LoginRateLimiter`.
  - [x] Batasi pembacaan `x-forwarded-for` / `x-real-ip` di `clientRateKey` (dan `x-forwarded-proto`) hanya saat `TRUST_PROXY=true`.
- [x] Tambahkan middleware `secureHeaders()` di `app/server/src/app.ts` serta perlindungan CSV Formula Injection di `escapeCsvCell` (`app/server/src/routes/export.ts`) untuk prefix `=`, `+`, `-`, `@`, `\t`, `\r` pada sel teks.
- [x] Perbaiki global error handling & routing di `app/server/src/app.ts` dan `app/server/src/index.ts`:
  - [x] Tambahkan `DomainError` (`errors.ts`), `app.onError`, dan `app.all("/api/*", 404)` JSON handler sebelum SPA fallback `serveStatic` agar `/api/*` yang tidak ada mengembalikan JSON `404`.
  - [x] Ubah resolusi path `./drizzle`, `./client/dist`, dan `./data` memakai `import.meta.dir` (`APP_ROOT`) agar server dan skrip DB dapat dijalankan dari directory mana pun.

## 4. Verifikasi Phase 4
- [x] Perluas `app/server/src/api.test.ts` dengan skenario edge-case & security baru:
  - [x] `GET /api/dashboard?cycle=cc&period=...` termasuk navigasi ke siklus lalu/depan tanpa menulis biaya bank masa depan.
  - [x] Validasi tanggal invalid (`2026-02-31`) dan batas periode saat `gajianStartDay = 1` / `cardCutoffDay = 1`.
  - [x] Proteksi double-settlement CC, partial settlement, dan `unsettle` pada pembayaran gabungan CC + Split Pay.
  - [x] Penolakan `PATCH /api/transactions/:id` untuk `income` pada CC dan transaksi Split Pay, serta `DELETE` rollback dan `sourceRef` idempoten paralel.
  - [x] `POST /api/auth/change-pin` (termasuk invalidasi sesi lama), `logout-all`, `getSessionSecret` production guard, sanitasi CSV formula injection, dan JSON `404` pada `/api/non-existent`.
- [x] Verifikasi `bun run typecheck`, `bun test` (`10 pass, 0 fail, 95 expect() calls`), `bun run build`, dan `bun run db:audit` (`AUDIT PASSED`) di `app/` seluruhnya lulus tanpa error.
