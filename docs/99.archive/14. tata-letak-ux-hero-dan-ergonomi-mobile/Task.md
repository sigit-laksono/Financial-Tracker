# Task List — Milestone 14: Restrukturisasi Hero Beranda, Ergonomi Mobile & Desain Konsisten

> **Referensi Spesifikasi:** `docs/14. tata-letak-ux-hero-dan-ergonomi-mobile/PRD.md` dan `docs/0.draft/ux-review.md`.

---

### 1. Restrukturisasi Hero OverviewPage

- [x] Modifikasi `app/client/src/pages/OverviewPage.tsx`:
  - [x] Pasang `DailyHeroCard` pada baris pertama konten setelah navigasi periode.
  - [x] Hubungkan props `DailyHeroCard` dengan data `dashboard.safeToSpend`, `dashboard.dailyAllowance`, pengeluaran hari ini, dan indikator status *pacing*.
  - [x] Geser `NetWorthHeroCard` ke bawah bagian dompet sebagai kartu ringkasan kekayaan bersih kompak dengan tombol shortcut ke tab "Aset & Net Worth".

---

### 2. Standar Ukuran Tap Target Mobile (>= 44px)

- [x] Perbarui `app/client/src/components/UI.tsx`:
  - [x] Tambahkan class `min-h-[44px]` dan `min-w-[44px]` pada `Button` (termasuk varian `size="sm"` dan tombol ikon).
- [x] Perbarui kartu dompet di `app/client/src/pages/OverviewPage.tsx`:
  - [x] Ubah tombol "Cocokkan Saldo" dari `min-h-[36px]` menjadi `min-h-[44px]`.
- [x] Perbarui `app/client/src/pages/TransactionsPage.tsx`:
  - [x] Pastikan ikon filter, tombol navigasi periode, dan tombol hapus transaksi memiliki tap area minimum `44px`.
- [x] Perbarui modal-modal aksi (`QuickAddSheet.tsx`, `ReceiveSalaryModal.tsx`, `AddDebtModal.tsx`):
  - [x] Pastikan seluruh tombol opsi dan tab di dalam modal memenuhi standar sentuh mobile.

---

### 3. Pembersihan Kebocoran Token Warna & Dark Mode (WCAG AA)

- [x] Audit dan refaktor `app/client/src/pages/OverviewPage.tsx`:
  - [x] Ganti `bg-[#00797a]` dan inline hex dengan token CSS variables (`var(--primary)`, `var(--surface)`, dll.).
- [x] Audit dan refaktor `app/client/src/components/BudggtHeroCard.tsx`:
  - [x] Sesuaikan warna teks dan background kartu hero agar mematuhi `--hero` dan `--hero-foreground`.
- [x] Audit dan refaktor `app/client/src/components/CashflowSparkline.tsx` & `CalendarActivityGrid.tsx`:
  - [x] Gunakan variabel tema dinamis untuk stroke dan titik koordinat SVG agar kontras di Dark Mode.
- [x] Uji verifikasi kontras WCAG AA pada light mode dan dark mode.

---

### 4. Navigasi Cepat Mobile (Quick Navigation Rail)

- [x] Modifikasi bar navigasi bawah di `app/client/src/App.tsx`:
  - [x] Tambahkan shortcut tab langsung atau floating action button (+) yang selalu menempel di area jempol bawah.
  - [x] Sederhanakan alur akses ke tab Budget dan Utang tanpa wajib melewati modal sheet "Menu".

---

### 5. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors).
- [x] Jalankan linter: `cd app; bun run lint` (0 errors).
- [x] Jalankan test suite: `cd app; bun test` (semua lulus).
- [x] Verifikasi visual di browser pada viewport ponsel (375x667 dan 390x844) dalam tema terang dan gelap.
