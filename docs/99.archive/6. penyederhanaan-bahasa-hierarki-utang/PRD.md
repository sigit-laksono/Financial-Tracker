# PRD — Milestone 5: Penyederhanaan Bahasa Finansial, HelpTooltip & Restrukturisasi Kartu-Utang

## 1. Latar Belakang & Masalah

Hasil evaluasi heuristik dan riset perilaku pengguna (*UX Researcher Report*) menunjukkan bahwa kendala psikologis terbesar bagi pengguna awam di Indonesia dalam mencatat keuangan bukanlah kekurangan fitur, melainkan **kepadatan informasi (*cockpit effect*)** dan **istilah perbankan/akuntansi yang membingungkan**:

1. **Jargon Perbankan yang Mengintimidasi Pengguna Awam:**
   Pengguna bingung membedakan istilah teknis seperti:
   - *Safe to Spend* (sering disangka saldo bank keseluruhan).
   - *Unbilled CC* vs *Billed CC* (sulit memahami mana transaksi berjalan bebas bunga dan mana tagihan wajib bayar).
   - *Grace Period* (tidak dipahami sebagai masa bebas bunga).
   - *Amortisasi* (istilah baku yang terdengar rumit untuk jadwal cicilan bulanan).
   - *Settlement* (istilah teknis untuk pembayaran tagihan atau pelunasan cicilan).
   - *Pacing Status: overpace* (terasa seperti vonis alarm kesalahan daripada panduan).
2. **Kepadatan Kognitif Ekstrem di Halaman Kartu & Utang (`DebtsPage`):**
   Seluruh fitur (Net Debt, Kartu Kredit, Simulator Bunga CC, Daftar Pinjaman, Jadwal Amortisasi Panjang, Early Payoff) ditumpuk dalam satu halaman panjang vertikal tanpa hierarki segmentasi. Pengguna kesulitan menemukan informasi yang paling mendesak: *"Berapa yang harus saya bayar bulan ini?"*.
3. **Efek Burung Unta (*Ostrich Effect*) Saat Defisit:**
   Penggunaan warna merah menyala dan kata-kata kaku seperti "Melebihi Jalur" saat sisa jatah menipis memicu kecemasan finansial (*financial anxiety*), menyebabkan pengguna enggan membuka aplikasi kembali.
4. **Alur Rekonsiliasi Saldo Terasa Menghakimi:**
   Ketika saldo bank riil berbeda dengan saldo di aplikasi, pengguna merasa bersalah dan terbebani harus mencari struk lama satu per satu.

---

## 2. Tujuan Milestone

1. **Menerapkan Kebijakan Nol-Jargon (*Zero-Jargon Policy*):** Mengganti seluruh istilah teknis asing dengan bahasa Indonesia sehari-hari yang ramah, jelas, dan membumi di seluruh halaman aplikasi.
2. **Menyediakan Edukasi Finansial Kontekstual (*HelpTooltip*):** Menyediakan ikon tanya `(?)` interaktif di samping istilah penting yang menampilkan popover penjelasan singkat saat disentuh/diklik.
3. **Merestrukturisasi Halaman Kartu & Utang dengan 3-Tab Segmented Controls:**
   Membagi halaman menjadi 3 tab terfokus (`[ Kartu Kredit ]` | `[ Cicilan & Utang ]` | `[ Piutang Teman ]`) dengan detail matematis disembunyikan dalam akordeon lipat (*Progressive Disclosure*).
4. **Menciptakan Rasa Aman Finansial (*Psychological Safety*):** Mengubah nada peringatan defisit menjadi nada solutif (Warm Amber) dan menghadirkan alur *"Cocokkan Saldo Dompet Tanpa Rasa Bersalah"*.

---

## 3. Ruang Lingkup Fungsional & Solusi Desain

### A. Kebijakan Nol-Jargon (Kamus Bahasa Awam)

Terapkan standardisasi teks antarmuka di seluruh komponen:

| Istilah Lama (Jargon) | Istilah Baru (Ramah Awam) | Lokasi Komponen |
|---|---|---|
| *Safe to Spend* | **Sisa Uang Bebas Belanja** *(atau Uang Aman)* | `OverviewPage.tsx` |
| *Pacing Status: overpace* | **Belanja Terlalu Cepat** *(Warm Amber)* | `OverviewPage.tsx` |
| *Pacing Status: agak_boros* | **Mulai Mendekati Batas** | `OverviewPage.tsx` |
| *Unbilled CC* | **Belanja Berjalan (Belum Ditagih)** | `OverviewPage.tsx`, `DebtsPage.tsx` |
| *Billed CC* | **Tagihan Resmi Bulan Ini** | `OverviewPage.tsx`, `DebtsPage.tsx` |
| *Grace Period* | **Masa Bebas Bunga** | `DebtsPage.tsx` |
| *Amortisasi* | **Jadwal Angsuran Bulanan** | `DebtsPage.tsx` |
| *Settlement* | **Catat Bayar Tagihan / Cicilan** | `QuickAddSheet.tsx`, `TransactionsPage.tsx` |
| *Rekonsiliasi Saldo* | **Cocokkan Saldo Dompet** | `OverviewPage.tsx`, `ReconcileModal.tsx` |
| *Receivable* | **Uang Ditalangi / Piutang Teman** | `DebtsPage.tsx`, `AddDebtModal.tsx` |

### B. Micro-Component `HelpTooltip.tsx`
- Buat komponen popover independen yang aksesibel untuk keyboard dan touch screen di mobile:
  - Trigger berupa tombol bulat ikon `(?)` kecil dengan label ARIA.
  - Saat di-tap di mobile: muncul popover bubble dengan tombol tutup dan auto-dismiss saat area luar diklik.
  - Contoh isi tooltip:
    - *Masa Bebas Bunga:* "Periode belanja menggunakan kartu kredit tanpa dikenakan bunga sepeser pun, selama tagihan dibayar lunas sebelum tanggal jatuh tempo."
    - *Belanja Berjalan:* "Transaksi kartu kredit yang dilakukan setelah tanggal tutup buku (tgl 20). Baru akan ditagihkan pada bulan berikutnya."
    - *Sisa Uang Bebas Belanja:* "Uang kas harian yang benar-benar aman dipakai jajan, setelah disisihkan untuk cadangan tagihan kartu kredit dan cicilan wajib."

### C. Restrukturisasi `DebtsPage.tsx` (3 Segmented Tabs)
- Lapisan Atas (Hero): Tetap menampilkan **Ringkasan Posisi Bersih (*Net Debt*)** dan timeline tagihan siklus berjalan.
- Lapisan Tengah: Segmented control 3 tab:
  1. **Tab 1: Kartu Kredit (`credit_card`)**
     - Meter limit terpakai vs sisa limit.
     - Pemisahan tegas: *Tagihan Resmi Jatuh Tempo Tgl 25* (Wajib Bayar) vs *Belanja Berjalan Bebas Bunga* (Belum Ditagih).
     - Simulator perbandingan bayar penuh (*Bebas Bunga*) vs bayar minimum (*Kena Bunga*).
  2. **Tab 2: Cicilan & Utang Saya (`payables`)**
     - Kartu pinjaman aktif (Flexi Cash, Utang Kantor, Split Pay CC).
     - Progress bar pelunasan: *"Tersisa 4 dari 12 bulan"*.
     - Tombol akordeon lipat: *"Lihat Jadwal Angsuran"* (Jadwal amortisasi disembunyikan secara default).
     - Tombol *"Simulasi Lunasi Lebih Cepat"*.
  3. **Tab 3: Uang Ditalangi / Piutang (`receivables`)**
     - Daftar talangan ke teman / kantor yang menunggu reimbursement.
     - Tombol cepat: *"Terima Pengembalian"*.

### D. Psychological Safety & Cocokkan Saldo Tanpa Rasa Bersalah (`ReconcileModal.tsx`)
- Status pengeluaran cepat (*overpace*) menggunakan warna **Warm Amber** (`#b45309`), bukan merah alarm, dengan pesan edukatif: *"Pengeluaran agak cepat. Jatah jajan harian disesuaikan menjadi Rp.../hari agar cukup hingga gajian"*.
- Modal Cocokkan Saldo disederhanakan:
  - Judul: *"Cocokkan Saldo Dompet"*.
  - Input: Saldo riil saat ini di m-banking.
  - Tampilkan selisih dengan netral: *"Ada selisih Rp25.000 (aplikasi lebih tinggi)"*.
  - Opsi instan 1-klik: *"Sesuaikan Langsung (Catat sebagai Penyesuaian Saldo)"* tanpa menyalahkan pengguna.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Seluruh istilah asing (*Grace Period, Amortisasi, Unbilled, Settlement, Safe to Spend*) telah digantikan dengan padanan bahasa Indonesia ramah awam di seluruh halaman.
- [ ] Mengetuk ikon `(?)` pada kartu tagihan CC dan uang bebas belanja memunculkan popover penjelasan singkat yang mudah dipahami orang awam.
- [ ] Halaman `DebtsPage` terbagi menjadi 3 tab terpisah yang bersih; tabel amortisasi panjang tidak memadati halaman utama dan dapat dibuka-tutup lewat akordeon.
- [ ] Saat kas belanja menipis, aplikasi tidak menampilkan teks bernada menghakimi dan status berwarna Warm Amber yang solutif.
- [ ] Alur penyesuaian saldo di `ReconcileModal` dapat diselesaikan dalam 2 langkah cepat tanpa rasa intimidasi.
