# PRD — Milestone 12: Penyelarasan Engine Utang-Piutang, Kartu Kredit & Desain Sistem Budggt

## 1. Latar Belakang & Masalah

Modul **Utang, Piutang, dan Kartu Kredit** adalah keunggulan utama (*competitive advantage / proprietary engine*) aplikasi kita yang tidak dimiliki oleh Budggt:

1. **Budggt Tidak Memiliki Pelacakan Utang & Kartu Kredit Komprehensif:**
   Budggt hanya mencatat pemasukan dan pengeluaran sederhana. Pengguna Indonesia yang mengelola kartu kredit (dengan tanggal cut-off, cetak tagihan, dan jatuh tempo vs tanggal gajian), cicilan barang (0% atau berbunga), serta pinjaman/piutang teman membutuhkan kalkulator finansial terintegrasi.
2. **Kebutuhan Harmonisasi Desain Antarmuka dengan Tema Budggt:**
   Halaman `DebtsPage.tsx` sebelumnya masih menggunakan gaya visual lama. Perlu di-reskin mengadopsi palet modern: kartu kontras tinggi, aksen Neon Lime (`#ccff00`), kartu sudut membulat, dan dukungan penuh sensor privasi (`isMasked`).
3. **Penyempurnaan Alur Pelunasan 1-Klik (*One-Click Settlement*):**
   Saat pengguna membayar tagihan kartu kredit atau mencicil pinjaman, harus ada integrasi 1-klik yang langsung memotong saldo dompet yang dipilih, mencatat transaksi pembayaran kewajiban, memperbarui sisa utang, dan mengupdate metrik Net Worth secara serentak.

---

## 2. Tujuan Milestone

1. **Penyelarasan Visual Halaman Utang & Piutang (`DebtsPage.tsx`):**
   - Mengadopsi desain Budggt: kartu rounded modern, badge status tagihan kontras, dan hero card ringkasan liabilitas.
   - 3 Tab Navigasi Bersih:
     - **Utang Saya (Payables)**: Pinjaman bank, cicilan motor/laptop, pinjaman kerabat.
     - **Piutang Teman (Receivables)**: Uang yang dipinjamkan ke rekan/keluarga, pelacakan pengembalian parsial.
     - **Kartu Kredit**: Multi kartu kredit, limit, pemakaian, dan siklus tagihan aman gajian.
2. **Pelunasan Dipercepat (*Early Payoff*) & Pembayaran Angsuran Terintegrasi:**
   - Tombol *Bayar Cicilan / Lunasi*: membuka form cepat, memilih dompet bayar, otomatis mengurangi saldo dompet dan pokok utang.
   - Simulasi penghematan bunga jika melunasi pinjaman berbunga lebih awal.
3. **Sinkronisasi Otomatis Arus Kas & Net Worth:**
   - Tagihan yang jatuh tempo otomatis masuk ke widget Timeline Siklus di Dashboard.
   - Pembayaran cicilan langsung terefleksikan pada penambahan Kekayaan Bersih (Net Worth).
4. **Proteksi & Keamanan Kas Teruji:**
   - 100% dari 34+ automated tests engine utang-piutang tetap lulus tanpa regresi logika kalkulasi.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Backend & Engine Utang (`debtEngine.ts`, `debtTimeline.ts`)
- Mempertahankan fungsi inti:
  - `calculateInstallment()`: perhitungan angsuran anuitas, flat, dan 0%.
  - `simulateEarlyPayoff()`: simulasi penalti/penghematan pelunasan awal.
  - `buildDebtTimeline()`: timeline jatuh tempo terhadap tanggal gajian.
  - `detectCashflowRisk()`: proteksi jatuh tempo kartu kredit sebelum gajian.
- Tambahkan integrasi mutasi transaksi otomatis saat pelunasan terjadi:
  - Menyimpan transaksi bertipe `settlement` / `expense` berelasi dengan `debtId`.

### B. Komponen UI Frontend
- **`DebtsPage.tsx`**:
  - Hero Card Liabilitas: Total Sisa Utang, Total Piutang Aktif, dan Beban Cicilan Bulan Ini.
  - 3 Tab Bersih: Utang, Piutang, Kartu Kredit.
  - Kartu Utang & Cicilan: info bunga, sisa tenor (misal: *Bulan 5 dari 12*), jadwal jatuh tempo, dan tombol *Bayar Angsuran*.
  - Kartu Kartu Kredit: visual kartu dengan progress bar limit terpakai, tanggal cut-off, jatuh tempo, dan status aman gajian.
- **`PaymentModal.tsx`**:
  - Modal pembayaran tagihan cepat dengan pilihan dompet sumber dana.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [x] Halaman Utang & Piutang memiliki tampilan konsisten dengan desain sistem Budggt (Neon Lime `#ccff00`, Dark Hero `#121514`, Privacy Mask).
- [x] Tab Utang Saya, Piutang Teman, dan Kartu Kredit menyajikan data terisolasi secara rapi dan mudah dibaca.
- [x] Tombol Bayar Angsuran / Pelunasan berhasil memotong saldo dompet yang dipilih dan memperbarui sisa pokok utang.
- [x] Analisis aman arus kas gajian vs tanggal jatuh tempo kartu kredit tetap berfungsi akurat.
- [x] Seluruh test engine utang (`debtEngine.test.ts`, `debtTimeline.test.ts`, dll.) 100% lulus.
- [x] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus tanpa error.
