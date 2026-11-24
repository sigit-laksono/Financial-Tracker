# PRD — Milestone 6: Visualisasi Tren Arus Kas, Glanceability Dompet & Timeline Risiko Siklus

## 1. Latar Belakang & Masalah

Meskipun fondasi perhitungan kas sudah akurat, aplikasi masih memiliki sejumlah kesenjangan dalam penyajian visual dan daya pikat informasi harian (*visual engagement & glanceability*):

1. **Ketiadaan Grafik Visual pada Halaman Ringkasan (Dashboard):**
   Pengguna awam sangat visual; saat membuka aplikasi pertama kali, mereka berharap melihat gambaran tren pengeluaran beberapa hari terakhir secara sekilas (*glanceable*). Saat ini grafik hanya tersedia di tab Transaksi, sehingga halaman Ringkasan terasa didominasi oleh angka statis.
2. **Keterbatasan Strip Dompet Horizontal Tanpa Segmentasi Peran:**
   Daftar dompet disajikan dalam baris horizontal geser (`overflow-x-auto`). Rekening tabungan dan e-wallet di sisi kanan sering terpotong dari pandangan. Selain itu, belum ada pengelompokan tegas antara **Kas Belanja Harian**, **Tabungan / Dana Darurat**, dan **Kartu Kredit**.
3. **Timeline Siklus Kurang Menyorot Titik Kritis Arus Kas:**
   Timeline siklus saat ini menampilkan daftar tanggal kalender biasa, namun belum menonjolkan pertanyaan kritis pengguna: *"Apakah tagihan CC jatuh tempo SEBELUM gajian atau SESUDAH gajian?"* (yang sangat menentukan risiko defisit kas).
4. **Kurangnya Penguatan Positif (*Positive Reinforcement*):**
   Aplikasi banyak memberikan indikator saat boros, tetapi belum memberikan apresiasi visual ketika pengguna berhasil disiplin atau sukses menghemat bunga kartu kredit.

---

## 2. Tujuan Milestone

1. **Menghadirkan Widget Tren Arus Kas 7 Hari (*CashflowSparkline*) di Halaman Ringkasan:**
   Visualisasi kurva pengeluaran harian berbasis SVG murni yang sangat ringan (< 1ms render, 0 KB bundle library baru) tanpa membebani performa browser.
2. **Meningkatkan Glanceability Saldo Dompet dengan Kartu Modular Terkelompok:**
   Mengelompokkan dompet menjadi 3 grup terpisah: Kas Belanja Harian, Tabungan/Simpanan, dan Kartu Kredit, lengkap dengan identitas visual bank/e-wallet yang mudah dikenali.
3. **Memperjelas Titik Kritis pada Timeline Siklus:**
   Memberikan penanda visual tegas antara tanggal tutup buku, jatuh tempo CC, dan hari gajian, disertai kalkulasi risiko kecukupan kas.
4. **Menghadirkan Micro-Nudge & Apresiasi Finansial:**
   Menampilkan lencana apresiasi *(Bebas Bunga Shield)* ketika tagihan CC lunas penuh dan streak hari aman belanja.

---

## 3. Ruang Lingkup Fungsional & Solusi Desain

### A. Komponen Ringan `CashflowSparkline.tsx`
- Buat komponen visual kurva SVG murni (menggunakan cubic Bézier / Catmull-Rom interpolation):
  - Membaca data pengeluaran 7 hari terakhir dari `data.dailyTotals`.
  - Merender garis kurva halus dengan aksen warna primer (`--primary`) dan efek gradient transparan di bawah garis.
  - Menampilkan tooltip sederhana saat titik hari disentuh/di-hover (menampilkan tanggal dan total belanja hari itu).
  - Dilengkapi ARIA label untuk aksesibilitas pembaca layar (`role="img"`).

### B. Desain Ulang Kartu Saldo Dompet Modular (`OverviewPage.tsx`)
- Ganti strip horizontal yang rawan terpotong dengan tata letak modular bertingkat:
  1. **Grup 1: Kas Belanja Siap Pakai (Spending Wallets)**
     - Menampilkan total kas belanja siap pakai.
     - Kartu rekening harian: BNI, BCA, GoPay dengan aksen warna brand khas.
     - Tombol cepat *"Cocokkan Saldo"*.
  2. **Grup 2: Tabungan & Dana Darurat (Savings Wallets)**
     - Menampilkan total dana tersimpan yang tidak boleh diutak-atik.
     - Kartu tabungan: Jenius Maxi Saver, Deposito, dll.
  3. **Grup 3: Kartu Kredit & Paylater**
     - Limit terpakai vs sisa limit.
     - Status cadangan kas bayar tagihan.

### C. Visualisasi Risiko Arus Kas pada `CycleTimeline.tsx`
- Berikan penanda kontras tinggi pada pin penunjuk **"HARI INI"** dengan dot berdenyut (*pulse*).
- Indikator Hubungan Gajian vs Jatuh Tempo:
  - Jika jatuh tempo CC jatuh **SEBELUM** tanggal gajian: Tampilkan penanda amber: *"Perhatian: Tagihan CC jatuh tempo sebelum gaji masuk. Pastikan kas di dompet BNI mencukupi."*
  - Jika jatuh tempo CC jatuh **SETELAH** tanggal gajian: Tampilkan penanda aman hijau: *"Tagihan aman: Akan dibayar setelah gaji masuk."*

### D. Micro-Nudge Apresiasi Finansial
- Hadirkan kartu apresiasi mikro di dashboard:
  - *"🛡️ Bebas Bunga Kartu Kredit:"* Menampilkan estimasi rupiah bunga yang berhasil dihindari bulan ini karena selalu bayar lunas sebelum jatuh tempo.
  - *"🎯 5 Hari Berturut-turut di Bawah Jatah Harian:"* Nudge positif untuk memotivasi kebiasaan hemat.

---

## 4. Kriteria Penerimaan (Acceptance Criteria)

- [ ] Halaman Ringkasan menampilkan grafik kurva tren pengeluaran 7 hari terakhir yang interaktif dan responsif di mobile.
- [ ] Daftar dompet terkelompok jelas antara Kas Belanja Harian dan Tabungan sehingga pengguna tidak keliru menganggap tabungan sebagai uang jajan.
- [ ] Timeline siklus secara visual menyorot apakah jatuh tempo CC berada sebelum atau sesudah tanggal gajian.
- [ ] Seluruh komponen baru memiliki waktu render di bawah 16ms (60 FPS) tanpa lag pada perangkat mobile.
