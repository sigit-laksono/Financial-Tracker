# Design Direction: Financial Tracker

**Status:** Active Direction (Mode: `antislop during`)  
**Referensi Utama:** [dens-ui](https://dendense.github.io/dens-ui/)  
**Design Read:** Reading this as: personal mobile-first PWA cashflow, credit card, and debt ledger for a single owner in Indonesia, in a Swiss-inspired tactile ops style (dens-ui Mars Green and crisp white/charcoal surfaces), dial **ENERGY 1 / RHYTHM 2 / MOTION 1**.

---

## 1. Three Dials & Liveliness Levers

| Dial | Level | Alasan (R-31) |
| --- | --- | --- |
| **ENERGY** | **1 (Calm)** | Aplikasi keuangan harian dibuka berkali-kali dalam sehari. Tampilan tenang, kontras jelas, dan bebas efek berlebihan agar angka Rupiah cepat terbaca tanpa lelah. |
| **RHYTHM** | **2 (Balanced)** | Struktur grid konsisten dengan variasi hirarki di tiap halaman: hero *Safe-to-Spend* berlatar gelap/tegas, strip dompet geser horizontal, lalu daftar transaksi padat per tanggal. |
| **MOTION** | **1 (Hover/State)** | Transisi cepat pada buka/tutup bottom sheet, toggle siklus, dan progress bar. Tidak ada animasi loop terus-menerus atau efek bounce dekoratif (patuh `prefers-reduced-motion`). |

### Levers yang Dipakai
- **One focal point per screen:**
  - *Ringkasan:* Kartu *Safe-to-Spend* menjadi fokus utama di bagian atas.
  - *Transaksi & Budget:* Grafik tren harian atau daftar kategori budget menjadi fokus sebelum mutasi detail.
  - *Kartu & Utang:* Meter pemakaian limit CC Jenius & tagihan siklus berjalan.
  - *Pengaturan:* Daftar dompet beserta tombol rekonsiliasi saldo.
- **One deliberate accent:** **Mars Green** (`#00797a` light, `#19a3a4` dark) hanya dipakai untuk aksi primer, tab aktif, dan indikator sehat. **Hermes Orange** (`#ff8a00` / `#ff9a1f`) dipakai khusus untuk hal yang butuh perhatian segera (jatuh tempo dekat, budget >= 80%, transaksi CC unbilled).
- **Identity motif:** Kartu hero berlatar `#0f1716` (light) / `#161918` (dark) dengan tipografi angka monospace `tabular-nums` dan hairline border beraksen green-tinted gray.

---

## 2. Palet Warna & Verifikasi Kontras (WCAG AA)

Mengadaptasi sistem warna `dens-ui` dengan penyesuaian `--control-border` agar batas komponen interaktif (input, tombol outline, checkbox) memenuhi rasio non-teks minimum **3.0:1** (WCAG 1.4.11).

### Light Mode (`:root`)
| Token | Hex | Fungsi |
| --- | --- | --- |
| `--background` | `#edf0ef` | Latar halaman utama |
| `--card` | `#ffffff` | Panel dan kartu konten |
| `--surface` | `#f5f7f6` | Well sekunder / baris ringkasan |
| `--hero` | `#0f1716` | Kartu hero *Safe-to-Spend* & progress utang |
| `--border` | `#dbe2df` | Hairline pemisah dekoratif di dalam kartu |
| `--control-border` | `#7b8a87` | Border input, select, dan tombol outline |
| `--foreground` | `#0f1716` | Teks utama |
| `--muted-foreground` | `#566361` | Label sekunder dan timestamp |
| `--primary` | `#00797a` | Aksi utama, fokus ring, dan active state |
| `--primary-foreground` | `#ffffff` | Teks di atas `--primary` |
| `--highlight` | `#ff8a00` | Peringatan jatuh tempo dekat / unbilled CC |
| `--highlight-foreground` | `#1f1100` | Teks di atas `--highlight` |
| `--soft` | `#c0ebd7` | Latar status surplus / lunas |
| `--soft-foreground` | `#0a4a44` | Teks di atas `--soft` |
| `--destructive` | `#a42423` | Overbudget, defisit, aksi hapus |
| `--destructive-foreground` | `#ffffff` | Teks di atas `--destructive` |

### Dark Mode (`.dark` / toggle aktif + system fallback)
| Token | Hex | Fungsi |
| --- | --- | --- |
| `--background` | `#0c0b0b` | Latar halaman utama |
| `--card` | `#161918` | Panel dan kartu konten |
| `--surface` | `#121514` | Well sekunder |
| `--hero` | `#1b1f1e` | Kartu hero bertingkat |
| `--border` | `#262c2b` | Hairline pemisah di dalam kartu |
| `--control-border` | `#5e6c69` | Border input, select, dan tombol outline |
| `--foreground` | `#ecf2f0` | Teks utama |
| `--muted-foreground` | `#9aa8a5` | Label sekunder |
| `--primary` | `#19a3a4` | Aksi utama dan fokus ring |
| `--primary-foreground` | `#031414` | Teks di atas `--primary` |
| `--highlight` | `#ff9a1f` | Peringatan jatuh tempo / budget >= 80% |
| `--highlight-foreground` | `#1f1100` | Teks di atas `--highlight` |
| `--soft` | `#123f3a` | Latar status surplus / lunas |
| `--soft-foreground` | `#c0ebd7` | Teks di atas `--soft` |
| `--destructive` | `#f74835` | Overbudget, defisit, aksi hapus |
| `--destructive-foreground` | `#200604` | Teks di atas `--destructive` |

### Hasil Audit `contrast-check.py` (Terverifikasi)
- Light `--foreground` pada `--background` / `--card`: **15.86:1** / **18.19:1** (PASS AA).
- Light `--muted-foreground` pada `--background` / `--card`: **5.46:1** / **6.26:1** (PASS AA).
- Light `--primary-foreground` pada `--primary`: **5.23:1** (PASS AA).
- Light `--control-border` (`#7b8a87`) pada `--background`: **3.14:1** (PASS non-teks >= 3.0:1).
- Light `--highlight-foreground` pada `--highlight`: **7.81:1** (PASS AA).
- Light `--soft-foreground` pada `--soft`: **7.76:1** (PASS AA).
- Light `--destructive-foreground` pada `--destructive`: **7.36:1** (PASS AA).
- Dark `--foreground` pada `--background` / `--card`: **17.34:1** / **15.62:1** (PASS AA).
- Dark `--muted-foreground` pada `--background` / `--card`: **7.97:1** / **7.18:1** (PASS AA).
- Dark `--primary-foreground` pada `--primary`: **6.12:1** (PASS AA).
- Dark `--control-border` (`#5e6c69`) pada `--card` / `--background`: **3.22:1** / **3.58:1** (PASS non-teks >= 3.0:1).
- Dark `--destructive-foreground` pada `--destructive`: **5.45:1** (PASS AA).

---

## 3. Tipografi, Radius, Ikon & Elevation (R-31 Reasons)

1. **Tipografi (`Figtree` + `JetBrains Mono`):**
   - *Alasan:* `Figtree` ringkas untuk label berbahasa Indonesia pada layar sempit tanpa terasa generik. `JetBrains Mono` dengan `font-variant-numeric: tabular-nums` dipakai khusus untuk nominal Rupiah, persentase, dan tanggal supaya kolom angka sejajar vertikal saat discan cepat. Tidak dipakai sebagai heading besar bergaya terminal (R-06).
   - Ukuran teks menggunakan `clamp()` / skala responsif antara mobile dan desktop agar heading tidak memakan ruang di layar 360px dan tetap terbaca saat zoom 200%.
2. **Hierarki Radius (R-11):**
   - Input & filter chip: `10px`.
   - Kartu transaksi & wallet strip: `14px`.
   - Hero card & dialog desktop: `20px`.
   - Bottom sheet mobile: `24px 24px 0 0`.
   - Tombol CTA utama / tab aktif: `9999px` (pill hanya untuk navigasi/CTA primer, bukan semua elemen).
3. **Shadow & Glassmorphism (R-10, R-12):**
   - Kartu konten biasa memakai border datar `1px solid var(--border)` tanpa shadow agar halaman terasa membumi.
   - Shadow halus hanya diberikan pada **FAB `+`**, **Bottom Nav / Floating Sheet**, dan **Popover/Modal** sebagai penanda lapisan atas. Tidak ada glassmorphism blur bertumpuk.
4. **Ikon (R-04):**
   - Tidak mengimpor seluruh paket ikon generik (seperti Lucide default) dan tidak memakai emoji dekoratif pada heading/tombol.
   - Menggunakan ikon SVG custom ringan dengan ketebalan stroke seragam (`1.75px`, square/crisp join) yang relevan langsung dengan konteks keuangan: dompet, kartu kredit, cicilan/kalender, transfer dua arah, grafik harian, dan gembok keamanan.
5. **Tema Light & Dark Toggle (R-21, R-34):**
   - Menyediakan toggle manual `Terang / Gelap / Ikuti Sistem` di Pengaturan dan di header desktop, dengan verifikasi penuh di kedua mode.

---

## 4. Aturan Responsif, Aksesibilitas & Copywriting

- **Breakpoints berbasis konten (R-03, `antislop-layoutmobile`):**
  - *Mobile (`< 640px`):* 1 kolom, Bottom Nav 4 tab + FAB `+`, padding bawah menyisakan ruang aman `calc(84px + env(safe-area-inset-bottom))` agar baris terakhir tidak tertutup nav bar, semua tap target minimal `44 x 44 px` dengan jarak antar tombol >= `8px`.
  - *Tablet / Laptop kecil (`640px – 1024px`):* Grid 2 kolom untuk ringkasan siklus & kategori agar tidak terlihat seperti tumpukan memanjang.
  - *Desktop (`> 1024px`):* Left Icon Rail tetap di sisi kiri (dengan toggle collapse `aria-expanded`) dan max-width konten `1040px`.
- **Aksesibilitas & Interaksi (R-26, R-27, R-32, R-39):**
  - Base CSS menetapkan `cursor: pointer` untuk seluruh elemen interaktif aktif dan `cursor: not-allowed` untuk elemen `disabled`.
  - Semua kontrol aksi memakai `<button type="button/submit">`, bukan `<div>`/`<span>`.
  - Seluruh input memiliki `<label for>` terlihat; ikon tombol memiliki `aria-label`.
  - Bottom sheet dan dialog mendukung penutupan via `Escape`, focus trap, dan mengembalikan fokus ke tombol pemicu.
  - Setiap tampilan data menyediakan **4 state eksplisit:** Loading (skeleton ringkas berlabel), First-Run Empty, Filtered Empty (dengan tombol reset filter), dan Error (dengan penyebab + tombol Coba Lagi).
- **Copywriting UI (R-02, R-15, R-16):**
  - Bahasa Indonesia alami, ringkas, tanpa em dash (`—`), tanpa buzzword pemasaran, dan tanpa angka/klaim buatan.

---

## 5. Konfirmasi Aset Visual Sebelum Eksekusi UI (R-23)

Sebelum membuat file aset ikon PWA (`192x192`, `512x512`, `apple-touch-icon`) pada Phase 4 nanti, kita akan konfirmasi atau gunakan monogram geometris sederhana bertuliskan **`FT`** di atas latar **Mars Green `#00797a`** dengan teks `#ffffff` (atau desain lain jika kamu punya logo khusus).
