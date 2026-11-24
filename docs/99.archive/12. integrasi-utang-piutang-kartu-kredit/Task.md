# Task List — Milestone 12: Penyelarasan Engine Utang-Piutang, Kartu Kredit & Desain Sistem Budggt

> **Referensi Spesifikasi:** `docs/12. integrasi-utang-piutang-kartu-kredit/PRD.md`.

---

### 1. Reskin & Redesain Antarmuka Halaman Utang (`DebtsPage.tsx`)

- [x] Perbarui komponen utama `app/client/src/pages/DebtsPage.tsx`:
  - Gunakan Hero Card gelap `#121514` dengan ringkasan 4 metrik (Total Sisa Utang, Total Piutang Teman, Beban Cicilan Bulan Ini, Limit CC Terpakai) mendukung Privacy Mask.
  - Buat 3 Tab Navigasi Bersih: **Utang Saya (Payables)**, **Piutang Teman (Receivables)**, **Kartu Kredit**, dan **Semua Portofolio**.
  - Terapkan gaya kartu rounded modern dengan aksen warna status (hijau/lime untuk aman/lunas, oranye/merah untuk jatuh tempo dekat).

---

### 2. Tab Kartu Kredit & Proteksi Arus Kas

- [x] Redesain kartu kartu kredit:
  - Tampilkan visual batas limit vs pemakaian (bar progress limit terpakai).
  - Tampilkan tanggal cut-off, tanggal cetak tagihan, dan tanggal jatuh tempo.
  - Tampilkan badge status keselarasan dengan tanggal gajian (*"Aman: Jatuh tempo setelah gajian"*).
- [x] Sediakan tombol cepat *Bayar Tagihan Kartu Kredit*.
- [x] Tampilkan tabel transaksi siklus dengan tombol *Split Pay* untuk konversi ke cicilan.

---

### 3. Modal Pelunasan Cepat & Potong Saldo Dompet

- [x] Perbarui/buat komponen pelunasan cepat (`ModalSheet` di `DebtsPage.tsx` & `QuickAddSheet.tsx`):
  - Form pencatatan angsuran atau pelunasan pinjaman.
  - Pilihan dompet sumber dana untuk pembayaran dengan saldo real-time.
  - Validasi saldo dompet mencukupi sebelum submit (menampilkan peringatan jika saldo defisit).
  - Setelah sukses: otomatis mengurangi pokok utang, mencatat mutasi di transaksi, dan memperbarui saldo dompet.
- [x] Hubungkan simulasi pelunasan dipercepat (*early payoff calculator*) pada kartu pinjaman berbunga dengan info penghematan bunga.

---

### 4. Sinkronisasi dengan Dashboard & Modul Aset

- [x] Verifikasi bahwa tagihan yang dibayar langsung memperbarui:
  - Widget Timeline Siklus di Dashboard.
  - Total Liabilitas dan nilai Kekayaan Bersih (Net Worth) di Halaman Aset (`queryKey: ["net-worth-summary"]`).
  - Saldo dompet di Halaman Dompet (`queryKey: ["wallets"]`).
  - Mutasi transaksi di Halaman Transaksi (`queryKey: ["transactions"]`).

---

### 5. Pengujian & Verifikasi Komprehensif

- [x] Jalankan typecheck: `cd app; bun run typecheck` (0 errors)
- [x] Jalankan linter: `cd app; bun run lint` (0 errors)
- [x] Jalankan unit & integration test suite lengkap: `cd app; bun test` (39/39 passed, 100%)
- [x] Uji fungsionalitas di browser (`http://localhost:5173`) melalui Browser Subagent dengan screenshot tersimpan.
