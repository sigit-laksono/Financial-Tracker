# Financial Tracker

Aplikasi pelacak arus kas pribadi, siklus kartu kredit, anggaran, target tabungan, aset, serta utang/piutang berbasis **Bun**, **Hono**, **Drizzle ORM (PostgreSQL)**, **React 19**, dan **Tailwind CSS v4**.

---

## Fitur Utama

- **Ringkasan Siklus Ganda (`gajian` & `cc`)**: Pantau *Safe-to-Spend*, jatah belanja harian (*Daily Allowance*), arus kas bersih, serta pemisahan tagihan kartu kredit *Billed* dan *Unbilled*.
- **Dompet & Rekening**: Kelola rekening bank, e-wallet, uang tunai, dan kartu kredit (limit, *cutoff*, *statement*, jatuh tempo, biaya rutin kartu), transfer antar dompet dengan biaya admin atomik, serta rekonsiliasi saldo.
- **Transaksi & Split Struk**: Pencatatan cepat (*Quick Add*) untuk pengeluaran, pemasukan, transfer, dan pembayaran kewajiban, dukungan *split* transaksi multi-kategori, tagihan rutin berulang, serta ekspor **CSV** (dengan mitigasi *formula injection*) dan **JSON**.
- **Anggaran 50/30/20**: Alokasi *Needs / Wants / Savings* serta batas anggaran per kategori per siklus.
- **Target & Dana Darurat**: Pelacakan progres target tabungan dan estimasi ketahanan dana darurat (*runway*).
- **Aset & Net Worth**: Pencatatan aset investasi dan aset fisik untuk menghitung kekayaan bersih (*Net Worth*).
- **Kartu Kredit, Utang & Piutang**: Jadwal cicilan, *Split Pay* transaksi kartu kredit, potongan gaji otomatis (*payroll*), dan alokasi pelunasan.
- **Keamanan & Audit**: Kunci aplikasi menggunakan **PIN** (hash `bcrypt`), cookie sesi `HttpOnly` bertanda tangan HMAC-SHA256, *rate limiting* percobaan login/ubah PIN, pencabutan seluruh sesi aktif, dan pencatatan `audit_logs`.

---

## Tech Stack

- **Backend**: Bun, Hono, Drizzle ORM, `postgres` (PostgreSQL 16), Zod
- **Frontend**: React 19, Vite, Tailwind CSS v4, TanStack React Query, Recharts, `vite-plugin-pwa`
- **Tooling**: TypeScript, Biome

---

## Struktur Direktori

```text
.
├── app/
│   ├── client/          # Frontend React + Vite + Tailwind v4
│   ├── server/          # Backend API Hono + Drizzle ORM + tests
│   ├── shared/          # Skema Zod, tipe DTO, dan helper siklus tanggal
│   └── drizzle/         # File migrasi SQL PostgreSQL
├── deploy/              # Template Caddyfile, nginx, dan systemd service
├── docs/                # Dokumentasi desain (DESIGN.md) & spesifikasi teknis
├── scripts/             # Skrip backup PostgreSQL & migrasi ETL SQLite -> PostgreSQL
├── Dockerfile           # Multi-stage Docker build (Vite client + Bun server)
├── docker-compose.yml   # Stack app + PostgreSQL 16 + Caddy (opsional HTTPS)
└── .env.example         # Template environment variables untuk Docker Compose
```

---

## Menjalankan Secara Lokal (Development)

### Prasyarat

- [Bun](https://bun.sh/) v1.4+
- PostgreSQL 16+ (berjalan di lokal atau via Docker)

### Langkah Setup

1. Siapkan environment variable di folder `app/`:

   ```bash
   cd app
   cp .env.example .env
   ```

   Sesuaikan `DATABASE_URL` dan `SESSION_SECRET` di `app/.env`.

2. Install dependensi, jalankan migrasi database, lalu jalankan dev server:

   ```bash
   bun install
   bun run db:migrate
   bun run dev
   ```

   - Frontend dev server: `http://localhost:5173` (proxy `/api` ke `:3001`)
   - Backend API server: `http://localhost:3001`

3. Build & preview mode produksi:

   ```bash
   bun run build
   bun run start
   ```

### Perintah Kualitas & Database

Jalankan dari dalam direktori `app/`:

```bash
bun run typecheck   # Pemeriksaan TypeScript (server & client)
bun run lint        # Pemeriksaan Biome linter
bun test            # Unit & integration tests (PostgreSQL)
bun run db:generate # Generate migrasi Drizzle baru
bun run db:migrate  # Terapkan migrasi PostgreSQL
```

---

## Deployment Produksi (Docker + HTTPS)

1. Salin `.env.example` di root repository menjadi `.env`, lalu isi kredensial yang kuat:

   ```bash
   cp .env.example .env
   ```

   Pastikan nilai berikut wajib diganti sebelum deploy:
   - `POSTGRES_PASSWORD`: password database yang kuat
   - `SESSION_SECRET`: string acak minimal 32 karakter (contoh: `openssl rand -hex 32`)
   - `DOMAIN`: domain tujuan (jika menggunakan profil `https` dengan Caddy)

2. Jalankan dengan **Caddy automatic HTTPS**:

   ```bash
   docker compose --profile https up -d --build
   ```

   Atau tanpa Caddy (port `app` dan `db` terikat ke `127.0.0.1` secara default agar aman di balik reverse proxy eksternal):

   ```bash
   docker compose up -d --build
   ```

3. Cek kesehatan layanan:

   ```bash
   curl -fsS http://127.0.0.1:3001/api/health
   ```

---

## Catatan Keamanan

- **Jangan pernah commit file `.env`**, database lokal (`app/data/`), atau file dump SQL (`scripts/*.sql`) ke repository.
- Saat `NODE_ENV=production`, server **mewajibkan**:
  - `DATABASE_URL` terkonfigurasi secara eksplisit.
  - `SESSION_SECRET` minimal 32 karakter dan bukan nilai placeholder/default.
- Gunakan `TRUST_PROXY=true` hanya jika aplikasi berjalan di balik reverse proxy tepercaya (seperti Caddy atau Nginx pada folder `deploy/`) yang meneruskan header `X-Forwarded-Proto` dan `X-Real-IP`.

---

## Backup PostgreSQL

Gunakan `scripts/backup-postgres.sh` untuk membuat backup terkompresi (`pg_dump -Fc` + `gzip`) dengan retensi otomatis 14 hari:

```bash
DATABASE_URL="postgres://postgres:PASSWORD@127.0.0.1:5432/financial_tracker" \
BACKUP_DIR=/var/backups/financial-tracker \
./scripts/backup-postgres.sh
```
