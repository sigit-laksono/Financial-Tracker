# PRD — Milestone 14: Restrukturisasi Hero Beranda, Ergonomi Mobile & Desain Konsisten

## 1. Latar Belakang & Masalah

Berdasarkan audit antarmuka pada `docs/0.draft/ux-review.md` dan panduan `docs/DESIGN.md`, aplikasi memiliki gaya visual dens-ui yang rapi, namun memiliki 4 masalah mendasar yang menurunkan kenyamanan dan kegunaan di perangkat seluler:

1. **Misorientasi Hero Beranda (`OverviewPage.tsx`):**
   Saat ini, `OverviewPage.tsx` merender kartu **Total Net Worth** di posisi paling atas. Pengguna harian yang membuka aplikasi di kasir atau sebelum memesan makanan butuh jawaban cepat: *"Berapa uang yang aman saya belanjakan hari ini tanpa mengorbankan cicilan dan tagihan akhir bulan?"*. Melihat angka Net Worth (yang mencakup aset tetap/emas/investasi) justru membingungkan dan memberikan rasa aman semu (*false sense of liquidity*). Komponen `DailyHeroCard` sudah tersedia namun belum dipasang.
2. **Pelanggaran Standar Ukuran Tap Target Mobile (< 44px):**
   Banyak kontrol tombol interaktif, ikon aksi cepat (inline-edit, hapus transaksi, tombol "Cocokkan Saldo" di kartu dompet) memiliki tinggi fisik `32px`–`36px`. Hal ini menyebabkan tingginya risiko salah sentuh (*fat-finger error*) pada layar smartphone 360–390px.
3. **Kebocoran Token Warna & Hardcoded Hex (Merusak Dark Mode):**
   Ditemukan penggunaan styling hex mentah Tailwind (seperti `bg-[#00797a]`, `emerald-500`, `amber-500`, `rose-500`) di 5 komponen utama. Ini mem-bypass CSS variables (`theme.css`) dan menyebabkan kontras teks tidak terbaca saat pengguna mengaktifkan mode gelap (*Dark Mode*).
4. **Friksi Navigasi Menu Mobile (2-Tap Navigation Friction):**
   Tab-tab utama seperti *Budget*, *Target*, *Aset*, dan *Kartu & Utang* tersembunyi di balik tombol "Menu" (Bottom Sheet Drawer), sehingga pengguna harus melakukan 2 kali tap setiap kali berpindah konteks.

---

## 2. Tujuan Milestone

1. **Menempatkan Hero Card yang Relevan untuk Kebutuhan Harian**:
   Memasang `DailyHeroCard` (Safe-to-Spend, jatah belanja harian, pacing indicator siklus) sebagai kartu hero teratas di `OverviewPage`, dan memposisikan Net Worth sebagai ringkasan sekunder yang ringkas.
2. **Ergonomi Mobile 100% Patuh Standar Minimum 44px**:
   Memastikan seluruh kontrol interaktif (tombol, input, filter pills, ikon aksi) memiliki area sentuh minimum `44x44px` (WCAG 2.5.5).
3. **Penyelarasan Sistem Warna dens-ui & Dukungan Dark Mode Penuh**:
   Mengganti seluruh warna hardcoded dengan CSS variables resmi (`--hero`, `--primary`, `--highlight`, `--surface`, `--control-border`, `--muted-foreground`), menjamin rasio kontras non-teks $\ge 3:1$ dan teks $\ge 4.5:1$.
4. **Penyempurnaan Navigasi Cepat Mobile**:
   Menyediakan bar navigasi cepat horizontal atau shortcut teratas agar pengguna dapat berpindah antar-fitur utama dalam 1 tap.

---

## 3. Ruang Lingkup Spesifikasi Teknis

### A. Restrukturisasi `OverviewPage.tsx`
- Pasang `DailyHeroCard` di posisi hero paling atas.
- Tampilkan metrik utama:
  - **Uang Aman Belanja Hari Ini (Daily Allowance)**.
  - **Total Sisa Safe-to-Spend Siklus Ini**.
  - **Indikator Kecepatan Belanja (Pacing: Sehat / Boros)**.
  - Pengeluaran hari ini dan sisa hari menuju gajian.
- Pindahkan kartu ringkasan Net Worth ke bagian bawah setelah dompet likuid, sebagai ringkasan kekayaan bersih kompak dengan tautan langsung ke tab Aset.

### B. Standardisasi Ergonomi & Tap Targets
- Modifikasi `app/client/src/components/UI.tsx`:
  - Pastikan tombol varian `sm` memiliki wrapper atau `min-h-[44px]` dan `min-w-[44px]`.
- Modifikasi kartu dompet di `OverviewPage.tsx`:
  - Tingkatkan tinggi tombol "Cocokkan Saldo" menjadi minimal `44px`.
- Modifikasi baris transaksi di `TransactionsPage.tsx`:
  - Perbesar padding dan area sentuh tombol menu aksi/hapus menjadi `44x44px`.

### C. Refaktor Token Warna & Dark Mode
- Audit dan bersihkan file-file berikut dari Tailwind inline hex:
  - `app/client/src/pages/OverviewPage.tsx`
  - `app/client/src/components/BudggtHeroCard.tsx`
  - `app/client/src/components/CashflowSparkline.tsx`
  - `app/client/src/components/CalendarActivityGrid.tsx`
  - `app/client/src/components/NetWorthHeroCard.tsx`
- Gunakan token semantik:
  - Background hero: `var(--hero)`
  - Aksi utama & surplus: `var(--primary)`
  - Peringatan jatuh tempo: `var(--highlight)`
  - Defisit/overbudget: `var(--destructive)`

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [x] `OverviewPage` menampilkan `DailyHeroCard` (Safe-to-Spend & Daily Allowance) di bagian teratas layar.
- [x] Kartu Net Worth tampil sebagai ringkasan kompak di bawah atau mengarah langsung ke tab Aset.
- [x] Seluruh tombol dan kontrol interaktif di aplikasi memiliki area sentuh $\ge 44\text{px} \times 44\text{px}$.
- [x] Tampilan Dark Mode tidak memiliki teks yang tenggelam/tidak terbaca akibat hex mentah.
- [x] Pengguna mobile dapat berpindah ke tab Budget, Utang, dan Transaksi dengan 1 tap.
- [x] `bun run typecheck`, `bun run lint`, dan `bun test` 100% lulus.
