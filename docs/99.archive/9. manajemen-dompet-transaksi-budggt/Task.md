# Task List — Milestone 9: Manajemen Dompet Terkelompok & Modal Transaksi Cepat Ala Budggt

> **Referensi Spesifikasi:** `docs/9. manajemen-dompet-transaksi-budggt/PRD.md`.

---

### 1. Skema Database & DTO Dompet Indonesia

- [x] Modifikasi `app/server/src/db/schema.ts`:
  - Tambahkan kolom `account_group` pada tabel `wallets` (`"cash" | "bank" | "ewallet" | "credit" | "other"`).
  - Tambahkan kolom `provider` pada tabel `wallets` (`"bca" | "mandiri" | "bni" | "bri" | "jago" | "seabank" | "blu" | "gopay" | "ovo" | "dana" | "shopeepay" | "cash" | "other"`).
- [x] Perbarui `app/shared/src/types.ts` dan `app/shared/src/dtos.ts`:
  - Export type `AccountGroup` dan `WalletProvider`.
  - Tambahkan properti `adminFee?: number` pada DTO transaksi transfer.
- [x] Buat dan terapkan migrasi database via Drizzle untuk skema `wallets`.

---

### 2. Komponen Visual & Identitas Brand Provider

- [x] Buat `app/client/src/components/BankBadge.tsx`:
  - Sediakan styling brand colors dan SVG/label badge untuk bank (BCA, Mandiri, BNI, BRI, Jago, SeaBank, Blu) dan e-wallet (GoPay, OVO, DANA, ShopeePay, Kas).
- [x] Uji responsivitas dan keterbacaan kontras (*contrast AA*) pada mode terang dan mode gelap.

---

### 3. Redesain Halaman Dompet & Rekonsiliasi Saldo

- [x] Perbarui `app/client/src/pages/WalletsPage.tsx`:
  - Kelompokkan dompet berdasarkan grup: **Rekening Bank**, **E-Wallet**, **Kas Tunai**, dan **Kredit / Paylater**.
  - Tampilkan ringkasan total saldo likuid di bagian paling atas.
  - Tambahkan kartu dompet dengan `BankBadge`, saldo terformat (mendukung privacy mask `isMasked`), dan persentase dari total kekayaan likuid.
- [x] Buat modal/dialog **Sesuaikan Saldo (Reconciliation)**:
  - Input saldo fisik aktual saat ini.
  - Tampilkan kalkulasi selisih (+/-) secara otomatis.
  - Simpan sebagai transaksi penyesuaian (*adjustment*) ke server tanpa memengaruhi pengeluaran 50/30/20.

---

### 4. Redesain Modal Transaksi Cepat (Quick Add) Ala Budggt

- [x] Redesain `app/client/src/components/QuickAddSheet.tsx`:
  - Implementasikan 4 tab: **Pengeluaran**, **Pemasukan**, **Transfer**, **Bayar Kewajiban**.
  - Sediakan shortcut tanggal cepat (*Hari Ini*, *Kemarin*, *Pilih Tanggal*).
  - Di tab Pengeluaran: tampilkan pilihan kategori dengan badge bucket 50/30/20 (*Kebutuhan* / *Keinginan*).
  - Di tab Transfer: tambahkan input opsional **Biaya Admin** yang otomatis mendebit saldo rekening asal.
  - Di tab Bayar Kewajiban: sediakan dropdown tagihan CC atau cicilan aktif dengan nominal pelunasan cepat.
- [x] Integrasikan submit transaksi dengan auto-refresh dashboard query dan state dompet.

---

### 5. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck`
- [x] Jalankan linter: `cd app; bun run lint`
- [x] Jalankan unit & integration tests: `cd app; bun test`
- [x] Uji interaktif form transaksi & pengelompokan dompet di browser (`http://localhost:5173`).
