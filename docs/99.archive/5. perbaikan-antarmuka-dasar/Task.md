# Task List — Milestone 4: Perbaikan Kritis Antarmuka, Presets Kontekstual & Aksesibilitas Mobile

> **Referensi Desain & Audit:** `docs/DESIGN.md`, `docs/0.draft/ui-designer.md`, `docs/0.draft/frontend-developer.md`.

---

### 1. Token Desain, Aksesibilitas & Tipografi

- [x] Perbarui token warna dan kontras di `app/client/src/styles/theme.css`:
  - Tambahkan token `--highlight-text: #b45309` (light) dan `--highlight-text: #ffaa33` (dark).
  - Pastikan seluruh teks dengan warna highlight menggunakan `var(--highlight-text)` untuk memenuhi rasio kontras WCAG AA $\ge$ 4.5:1.
  - Terapkan OpenType Figtree `tabular-nums lining-nums` pada utility font angka nominal.
- [x] Tambahkan utility class `.safe-bottom-pad` di `theme.css` untuk menangani home-bar iPhone (`env(safe-area-inset-bottom)`).
- [x] Audit dan pastikan seluruh tombol di `app/client/src/components/UI.tsx` memiliki `min-h-[44px]` dan `min-w-[44px]` untuk touch target mobile standar.

---

### 2. Formatter & Helper Baru

- [x] Buat helper ejaan angka Rupiah `spellOutRupiah(amount: number): string` di `app/client/src/lib/format.ts`:
  - Mampu mengeja angka 0 s/d ratusan juta (misal: 50.000 $\rightarrow$ "Lima puluh ribu rupiah").
  - Tambahkan unit test di `app/client/src/lib/format.test.ts`.
- [x] Perbarui `formatRupiah` di `app/client/src/lib/format.ts`:
  - Mendukung parameter atau penanganan tanda minus Unicode tipografis `\u2212` (`−`).
  - Tambahkan non-breaking space `\u00A0` antara `Rp` dan angka nominal.
- [x] Perbarui `INITIAL_TRANSACTION_FILTERS` di `app/client/src/lib/filters.ts`:
  - Ubah nilai default `weekChoice` dari `"auto"` menjadi `"all"`.

---

### 3. Komponen `QuickAddSheet.tsx`

- [x] Refaktor rendering template cepat (`presets.frequentTemplates`):
  - Berikan filter kondisional: hanya render template merchant pengeluaran jika `mode === "expense"`.
  - Pada mode `income`, tampilkan chip pemasukan sering (atau sembunyikan jika kosong).
  - Pada mode `transfer` dan `settle`, sembunyikan baris template merchant agar tidak membingungkan pengguna.
- [x] Ganti tombol penambah nominal menjadi **Zero-CLS Grid 5 Kolom**:
  - Terapkan layout `grid grid-cols-5 gap-1.5`.
  - 4 tombol stepper: `+10rb`, `+25rb`, `+50rb`, `+100rb`.
  - 1 tombol `Reset` statis di kolom ke-5 dengan kondisi `disabled={!amountInput}`.
- [x] Integrasikan `spellOutRupiah` tepat di bawah field input nominal sebagai teks bantu konfirmasi nominal.
- [x] Tambahkan scroll handler pada input nominal dan merchant:
  - Event `onFocus` memanggil `scrollIntoView({ behavior: 'smooth', block: 'center' })` setelah jeda 150ms agar input tidak terhalang virtual keyboard HP.
- [x] Tambahkan micro-feedback visual saat transaksi berhasil disimpan:
  - State tombol berubah sesaat menjadi `✓ Tersimpan!` sebelum sheet menutup.

---

### 4. Halaman Ringkasan (`OverviewPage.tsx`)

- [x] Perbaiki container nominal negatif pada Hero Card *Safe-to-Spend*:
  - Tambahkan kelas `whitespace-nowrap` dan `word-break: keep-all`.
  - Gunakan skala font responsif: `text-[clamp(22px,5.2vw,40px)]`.
  - Gunakan karakter minus tipografis `−` sehingga tanda minus tidak pernah terpisah baris.
- [x] Sempurnakan badge status pacing:
  - Jika `safeToSpend < 0`, tampilkan badge `🚨 Jatah Defisit` dengan jatah harian `Rp 0 / hari`.
  - Pastikan teks status menggunakan kontras tinggi yang mudah dibaca.
- [x] Pastikan tombol aksi inline ("Cocokkan Saldo", "Bayar Tagihan", "Kelola CC") memiliki touch target minimal 44px di mobile.

---

### 5. Halaman Transaksi (`TransactionsPage.tsx`)

- [x] Perbarui inisialisasi filter transaksi:
  - Pastikan halaman pertama kali dibuka langsung menampilkan tab **"Semua Minggu"** (`weekChoice: "all"`).
- [x] Perbarui tab strip navigasi mingguan:
  - Hitung jumlah transaksi per minggu dari data periode aktif:
    `Semua (N)`, `Mg 1 (N)`, `Mg 2 (N)`, `Mg 3 (N)`, `Mg 4 (N)`, `Mg 5 (N)`.
  - Berikan dot aksen hijau/teal untuk menandai minggu berjalan *(Berjalan)*.
- [x] Tambahkan *Contextual Empty State*:
  - Jika minggu yang dipilih tidak memiliki transaksi, tampilkan pesan ramah dan tombol 1-klik: *"Tampilkan Semua Transaksi Siklus Ini"*.
- [x] Jadikan bar pencarian transaksi dan filter chip `sticky top-0 z-20` pada tampilan mobile agar mudah diakses saat scroll.

---

### 6. Pengujian & Verifikasi

- [x] Jalankan linter dan typecheck:
  ```bash
  cd app
  bun run lint
  bun run typecheck
  ```
- [x] Jalankan unit test frontend & backend:
  ```bash
  cd app
  bun test
  ```
- [x] Verifikasi manual lewat browser di resolusi 360px (mobile) dan 1280px (desktop):
  - Uji tanda minus pada Safe to Spend tidak wrap.
  - Uji tombol tab Quick Add (Keluar $\rightarrow$ Masuk $\rightarrow$ Transfer $\rightarrow$ Bayar) tidak memunculkan template salah.
  - Uji default filter transaksi menampilkan seluruh transaksi siklus.
