# Task List — Milestone 5: Penyederhanaan Bahasa Finansial, HelpTooltip & Restrukturisasi Kartu-Utang

> **Referensi Desain & Audit:** `docs/DESIGN.md`, `docs/0.draft/ux-researcher.md`, `docs/0.draft/ux-architect.md`.

---

### 1. Komponen Baru `HelpTooltip.tsx`

- [x] Buat file `app/client/src/components/HelpTooltip.tsx`:
  - Menggunakan dialog/popover accessible dengan `role="tooltip"` atau popover native.
  - Ikon trigger tombol `(?)` dengan touch target minimal 44px (menggunakan padding transparan) dan label ARIA `"Penjelasan istilah"`.
  - Mendukung pembukaan lewat sentuhan/tap di mobile dan hover/focus di desktop.
  - Dilengkapi fitur *light dismiss* (menutup otomatis saat klik di luar atau menekan tombol `Escape`).
  - Tambahkan unit test untuk memastikan aksesibilitas keyboard dan render popover.

---

### 2. Standarisasi Teks Antarmuka (Zero-Jargon Policy)

- [x] Perbarui teks di `app/client/src/pages/OverviewPage.tsx`:
  - Ubah label kartu utama: *"Sisa Jatah Siklus"* / *"Safe-to-Spend"* $\rightarrow$ **"Sisa Uang Bebas Belanja"** + `HelpTooltip`.
  - Ubah badge pacing:
    - `"overpace"` $\rightarrow$ **"Belanja Terlalu Cepat"** (ubah tone ke Warm Amber `#b45309`, bukan merah kriminal).
    - `"agak_boros"` $\rightarrow$ **"Mulai Mendekati Batas"**.
  - Ubah label CC: *"Unbilled CC"* $\rightarrow$ **"Belanja Berjalan (Belum Ditagih)"**.
  - Ubah tombol: *"Cocokkan Saldo"* $\rightarrow$ **"Cocokkan Saldo Dompet"**.
- [x] Perbarui teks di `app/client/src/components/QuickAddSheet.tsx`:
  - Tab `"settle"`: ubah dari label kaku menjadi **"Bayar Tagihan"**.
- [x] Perbarui teks di `app/client/src/pages/TransactionsPage.tsx`:
  - Badge `"settlement"` $\rightarrow$ **"Pembayaran Tagihan"**.
  - Badge `"unbilled"` $\rightarrow$ **"Belum Ditagih"**.

---

### 3. Restrukturisasi `DebtsPage.tsx` (Segmented Tabs)

- [x] Tambahkan local state tab pilihan pada `DebtsPage.tsx`:
  ```typescript
  type DebtTab = "credit_card" | "payables" | "receivables";
  const [debtTab, setDebtTab] = useState<DebtTab>("credit_card");
  ```
- [x] Buat Segmented Control di bawah Ringkasan Posisi Bersih:
  - Tab 1: **Kartu Kredit** (dengan badge jumlah kartu aktif).
  - Tab 2: **Cicilan & Utang Saya** (dengan badge jumlah pinjaman aktif).
  - Tab 3: **Piutang Teman** (dengan badge jumlah talangan aktif).
- [x] Rapikan Tab **Kartu Kredit**:
  - Tampilkan kartu limit pemakaian dan simulator bunga minimum payment.
  - Tambahkan `HelpTooltip` pada istilah *"Masa Bebas Bunga"* dan *"Tanggal Tutup Buku"*.
  - Sediakan tombol cepat *"Bayar Tagihan CC"*.
- [x] Rapikan Tab **Cicilan & Utang Saya**:
  - Ganti istilah *"Amortisasi"* menjadi **"Jadwal Angsuran Bulanan"**.
  - Bungkus tabel rincian angsuran ke dalam akordeon `<details className="group">` agar terlipat rapi secara default.
  - Tampilkan kartu progres: *"Tersisa X dari Y bulan angsuran"*.
- [x] Rapikan Tab **Piutang Teman**:
  - Daftar pinjaman ke pihak lain / talangan kantor.
  - Tombol aksi cepat *"Catat Pengembalian Saldo"*.

---

### 4. Penyempurnaan Modal Cocokkan Saldo (`ReconcileModal.tsx`)

- [x] Ubah judul modal menjadi **"Cocokkan Saldo Dompet"**.
- [x] Tampilkan informasi saldo sistem vs saldo m-banking dalam bentuk kartu komparasi visual yang bersih.
- [x] Tampilkan selisih dengan teks netral dan ramah tanpa nuansa menyalahkan pengguna:
  - *"Terdapat selisih Rp... antara catatan aplikasi dan m-banking kamu."*
- [x] Sediakan tombol aksi 1-klik:
  - *"Sesuaikan Otomatis"* $\rightarrow$ otomatis membuat transaksi penyesuaian saldo agar angka langsung sinkron tanpa repot.

---

### 5. Pengujian & Verifikasi

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
- [x] Verifikasi manual tampilan di browser:
  - Buka halaman `Kartu & Utang`: pastikan 3 tab berfungsi mulus dan tabel jadwal angsuran dapat dibuka-tutup.
  - Uji popover `HelpTooltip` di mobile dan desktop.
  - Uji modal cocokkan saldo dompet.
