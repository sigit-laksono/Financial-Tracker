# Task List — Milestone 15: Penyederhanaan Bahasa Finansial, Alur Usability & Onboarding

> **Referensi Spesifikasi:** `docs/15. kemudahan-alur-usability-dan-onboarding/PRD.md` dan `docs/0.draft/usability-analysis.md`.

---

### 1. Penyelarasan Bahasa & Kamus Istilah Finansial

- [x] Audit dan perbarui teks pada komponen-komponen utama:
  - [x] `DailyHeroCard.tsx` & `OverviewPage.tsx`: Ganti "Safe-to-Spend" menjadi "Uang Aman Belanja" dan "Daily Allowance" menjadi "Jatah Belanja Hari Ini".
  - [x] `WalletsPage.tsx`: Ganti "Reconcile" menjadi "Cocokkan Saldo Dompet".
  - [x] `DebtsPage.tsx`: Ganti "Unbilled" menjadi "Tagihan Berjalan (Belum Dicetak)" dan "Billed" menjadi "Tagihan Siap Bayar".
  - [x] `GoalsPage.tsx`: Ganti "Emergency Fund Runway" menjadi "Daya Tahan Dana Darurat (x Bulan)".
  - [x] `SplitPayModal.tsx`: Ganti istilah teknis menjadi "Ubah Jadi Cicilan".
- [x] Tambahkan `HelpTooltip` di samping istilah-istilah di atas untuk memberikan penjelasan singkat bila ikon tanda tanya disentuh.

---

### 2. Peningkatan Efisiensi Quick-Add Form (2-Tap Flow)

- [x] Modifikasi `app/client/src/components/QuickAddSheet.tsx`:
  - [x] Tambahkan tombol chip nominal cepat (`+Rp10.000`, `+Rp25.000`, `+Rp50.000`, `+Rp100.000`).
  - [x] Implementasikan penyimpanan dompet terakhir di `localStorage` (`lastUsedWalletId`) agar user tidak perlu memilih dompet berulang-ulang.
  - [x] Tambahkan pemetaan kategori otomatis berdasarkan riwayat merchant (auto-select category).
  - [x] Auto-focus ke input nominal saat bottom sheet terbuka.

---

### 3. Pembuatan Komponen First-Run Onboarding Wizard

- [x] Buat komponen `app/client/src/components/OnboardingModal.tsx`:
  - [x] Step 1: Input tanggal gajian bulanan (default tgl 25) & nama rekening utama (misal: BCA).
  - [x] Step 2: Input saldo awal rekening operasional & limit kartu kredit (opsional).
  - [x] Step 3: Alokasi budget kasar (Kebutuhan pokok, Hiburan, Tabungan).
  - [x] Simpan status `hasCompletedOnboarding` di database/pengaturan.
- [x] Pasang `OnboardingModal` di `app/client/src/App.tsx` agar memicu secara otomatis jika pengguna belum pernah mencatat transaksi atau setup awal.

---

### 4. Peningkatan Empty State & Aksi Kontekstual

- [x] Modifikasi `app/client/src/components/UI.tsx` (`StateView`):
  - [x] Tambahkan slot opsional `actionButton` pada `StateView`.
- [x] Perbarui empty state di:
  - [x] `TransactionsPage.tsx`: tombol aksi "Catat Transaksi Pertama".
  - [x] `DebtsPage.tsx`: ilustrasi mini & tombol "Catat Utang / Kartu Kredit".
  - [x] `AssetsPage.tsx`: tombol "Mulai Catat Aset Investasi".
  - [x] `BudgetPage.tsx`: tombol "Gunakan Template Budget 50/30/20".

---

### 5. Pengujian & Verifikasi

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors).
- [x] Jalankan linter: `cd app; bun run lint` (0 errors).
- [x] Jalankan test suite: `cd app; bun test` (semua lulus).
- [x] Uji skenario pengguna baru di browser (buka private window / reset DB) dan verifikasi alur onboarding berjalan mulus dalam <60 detik.
