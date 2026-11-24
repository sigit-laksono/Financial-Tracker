# Laporan Analisis Kualitas Kode & Arsitektur (Code Review)
**Financial Tracker Application**
**Tanggal**: 23 November 2026  
**Auditor**: Code Reviewer Agent  
**Cakupan**: Backend (`app/server/src`), Frontend (`app/client/src`), Shared (`app/shared/src`)  
**Status Audit**: Lengkap (P0, P1, P2)

---

## 1. Ringkasan Eksekutif

Audit kualitas kode (Code Review) menyeluruh telah dilakukan pada seluruh basis kode proyek **Financial Tracker**. Aplikasi ini memiliki fondasi teknis yang kokoh berbasis **Bun**, **Hono**, **Drizzle ORM (SQLite WAL mode)**, **React 19**, **TanStack Query v5**, dan **Zod**, serta telah memiliki test suite dengan 42 pengujian otomatis yang lulus 100%.

Namun, audit mendalam terhadap alur data, konkurensi database, sinkronisasi cache frontend-backend, dan integritas akuntansi menemukan sejumlah kelemahan struktural penting yang perlu segera ditangani agar aplikasi siap digunakan di tingkat produksi dengan stabil, bebas bug, dan mudah dirawat:

1. **Integritas Pembukuan & Transaksi Database (P0)**: Mutasi kritis pada alur penerimaan gaji (`receiveSalaryForPeriod`) berjalan tanpa perlindungan transaksi atomik database (`db.transaction`), membuka risiko *partial write* dan korupsi data finansial jika terjadi interupsi.
2. **Sinkronisasi Cache TanStack Query (P0)**: Ditemukan ketidakcocokan kunci cache (*query key mismatch*) yang parah. `BudgetPage` menggunakan query key `["budget-summary"]`, sementara seluruh mutasi transaksi dan pengaturan meng-invalidate query key `["budgets"]`. Akibatnya, halaman budgeting mengalami *stale read* permanen dan tidak pernah ter-update saat transaksi ditambah/diedit/dihapus.
3. **Regresi Multi-Kartu Kredit (P1)**: Pengaturan global pada `PATCH /api/settings` secara membabi buta menimpa seluruh kartu kredit dengan nilai limit dan tanggal jatuh tempo yang seragam. Selain itu, pendeteksian transaksi *unbilled* di `routes/transactions.ts` hanya memeriksa kartu kredit pertama, mengabaikan kartu kredit ke-2 dan seterusnya.
4. **Skalabilitas & Efisiensi Memori (P1)**: Perhitungan saldo dompet (`computeWalletBalance`) memuat seluruh baris transaksi dari awal waktu ke memori JavaScript array, alih-alih memanfaatkan agregasi native SQLite.
5. **Kopling Monolitik Frontend (P1 & P2)**: `App.tsx` mengunci rendering seluruh tab saat query dashboard pending/error. Beberapa file halaman memiliki ukuran sangat besar (`SettingsPage.tsx` mencapai 1.856 baris) yang menggabungkan terlalu banyak tanggung jawab.

---

## 2. Matriks Temuan & Klasifikasi Severity

| ID | Kategori | Severity | Komponen / File | Dampak Utama |
|---|---|:---:|---|---|
| **CR-01** | Backend / Accounting | **P0** | `server/src/lib/salaryService.ts:170-200` | Mutasi gaji & cicilan non-atomik (data inconsistency) |
| **CR-02** | Frontend / Cache | **P0** | `client/src/pages/BudgetPage.tsx:44` vs `QuickAddSheet.tsx:271` | Stale read permanen pada halaman budgeting (`["budgets"]` vs `["budget-summary"]`) |
| **CR-03** | Backend / Data Loss | **P1** | `server/src/routes/settings.ts:70-86` | Update pengaturan global merusak konfigurasi multi-CC |
| **CR-04** | Backend / Logic | **P1** | `server/src/routes/transactions.ts:116-131, 185-193` | Transaksi *unbilled* multi-CC tidak terdeteksi |
| **CR-05** | Backend / Integrity | **P1** | `server/src/routes/transactions.ts:803-813` | Hapus transaksi penerimaan piutang meninggalkan cicilan `paid` menggantung |
| **CR-06** | Backend / Performance | **P1** | `server/src/lib/cashLedger.ts:10-50` | In-memory row scanning pada `computeWalletBalance` |
| **CR-07** | Backend / Architecture | **P1** | `server/src/routes/goals.ts:238-268` | Setor goal tidak menambah saldo ke dompet target tabungan |
| **CR-08** | Frontend / Resilience | **P1** | `client/src/App.tsx:341-365` | `dashboardQuery` mengunci akses tab lain (Single Point of Failure) |
| **CR-09** | Backend / Concurrency | **P1** | `server/src/routes/debts.ts:171` | Pemanggilan `recordAuditLog(db)` di dalam blok transaksi `tx` |
| **CR-10** | Frontend / Linter | **P2** | `OverviewPage.tsx`, `SettingsPage.tsx`, `biome.json` | 6 error linter Biome (dead state, unused params/vars) |
| **CR-11** | Frontend / Resilience | **P2** | `client/src/main.tsx:21`, `UI.tsx:298` | Kurang localized Error Boundary untuk chart & visual widgets |
| **CR-12** | Backend / DB Load | **P2** | `server/src/lib/auth.ts:146-164` | `SELECT app_settings` dieksekusi berulang pada setiap HTTP request |
| **CR-13** | Frontend / Maintainability | **P2** | `client/src/pages/SettingsPage.tsx` (1.856 baris) | Komponen raksasa monolitik sulit dirawat |
| **CR-14** | Shared / Formatting | **P2** | `client/src/lib/format.ts:76-79` | Format compact nominal di atas Rp1 Miliar menjadi `Rp2500 jt` |
| **CR-15** | Backend / Integrity | **P2** | `server/src/routes/categories.ts:183-201` | Hapus kategori mengabaikan `transactionSplits` & `recurringRules` |
| **CR-16** | Frontend / Network | **P2** | `client/src/lib/api.ts:89` | Header `Content-Type` dikirim pada request GET/DELETE tanpa body |

---

## 3. Analisis Mendalam Temuan Prioritas Kritis (P0)

### CR-01: Alur Penerimaan Gaji (Receive Salary) Tidak Berada dalam Transaksi Atomik Database
- **Tingkat Keparahan**: **P0 (Kritis)**
- **Lokasi Berkas**: [salaryService.ts](../../app/server/src/lib/salaryService.ts#L170-L200)
- **Kondisi Saat Ini**:
  Fungsi `receiveSalaryForPeriod` melakukan dua operasi perubahan data penting secara terpisah:
  1. `await db.insert(transactions).values(...)` untuk mencatat pemasukan gaji bersih.
  2. Perulangan `for (const inst of preview.payrollInstallments)` yang memanggil `await db.update(installments).set({ status: 'paid', ... })`.
- **Dampak Risiko**:
  Operasi ini tidak dibungkus dalam `db.transaction`. Jika proses aplikasi mengalami restart (misalnya deploy atau OOM), atau koneksi SQLite terputus di tengah perulangan cicilan, transaksi pemasukan sudah tersimpan namun cicilan payroll tidak berubah (atau hanya sebagian yang terbayar). Pengguna tidak dapat mengulangi proses karena terhalang `ConflictError (Gaji sudah dicatat)`, menyebabkan pembukuan rusak permanen. Selain itu, alokasi cicilan payroll tidak dicatat ke `settlementAllocations`, sehingga jika cicilan di-unsettle di masa depan, saldo tidak sinkron.
- **Rekomendasi Solusi**:
  Bungkus seluruh mutasi dalam transaksi database tunggal dan tambahkan pencatatan ke `settlementAllocations`.

```typescript
// Solusi Refactoring: app/server/src/lib/salaryService.ts
export async function receiveSalaryForPeriod(
  db: AppDb,
  input: { period?: string; grossSalary?: number; walletId?: number; transactionDate?: string } = {},
  today = jakartaToday(),
) {
  const preview = await getSalaryPreview(db, input, today);
  if (preview.alreadyReceived) {
    throw new ConflictError(`Gaji untuk periode ${preview.period} sudah dicatat.`);
  }

  // Validasi awal input dan dompet...
  const grossSalary = input.grossSalary ?? preview.grossSalary;
  if (grossSalary <= 0) throw new ValidationError("Gaji kotor harus lebih dari 0.");
  
  const targetWalletId = input.walletId ?? preview.targetWalletId;
  if (!targetWalletId) throw new NotFoundError("Dompet penerima gaji tidak ditemukan.");

  return db.transaction((tx) => {
    // 1. Catat transaksi pemasukan gaji
    const [createdTx] = tx
      .insert(transactions)
      .values({
        type: "income",
        merchant: "Gaji Kantor",
        amount: Math.max(0, grossSalary - preview.totalPayrollDue),
        transactionDate: input.transactionDate ?? preview.periodStart,
        category: "Gaji",
        categoryId: categoryId,
        walletId: targetWalletId,
        source: "system",
        sourceRef: `salary-${preview.period}`,
        note,
      })
      .returning()
      .all();

    if (!createdTx) throw new Error("Gagal membuat transaksi penerimaan gaji.");

    // 2. Tandai cicilan kantor sebagai lunas dan simpan alokasinya secara atomik
    const paidAt = new Date();
    for (const inst of preview.payrollInstallments) {
      tx.update(installments)
        .set({
          status: "paid",
          actualAmount: inst.plannedAmount,
          paidAt,
          settlementTransactionId: createdTx.id,
        })
        .where(eq(installments.id, inst.id))
        .run();

      tx.insert(settlementAllocations)
        .values({
          settlementTransactionId: createdTx.id,
          targetType: "installment",
          installmentId: inst.id,
          allocatedAmount: inst.plannedAmount,
        })
        .run();
    }

    // 3. Catat audit log menggunakan instance transaksi 'tx'
    recordAuditLog(tx, {
      entityType: "salary",
      entityId: createdTx.id,
      action: "receive_salary",
      after: { period: preview.period, grossSalary, transactionId: createdTx.id },
    });

    return { ok: true, period: preview.period, grossSalary, transaction: createdTx };
  });
}
```

---

### CR-02: Ketidakcocokan Query Key TanStack Query Mengakibatkan Stale Read Permanen pada Budgeting
- **Tingkat Keparahan**: **P0 (Kritis)**
- **Lokasi Berkas**:
  - [BudgetPage.tsx](../../app/client/src/pages/BudgetPage.tsx#L44)
  - [QuickAddSheet.tsx](../../app/client/src/components/QuickAddSheet.tsx#L271)
  - [TransactionsPage.tsx](../../app/client/src/pages/TransactionsPage.tsx#L118)
  - [SettingsPage.tsx](../../app/client/src/pages/SettingsPage.tsx#L686)
- **Kondisi Saat Ini**:
  - Halaman `BudgetPage.tsx` menggunakan:
    ```typescript
    useQuery({
      queryKey: ["budget-summary"],
      queryFn: () => api.getBudgetSummary(),
    });
    ```
  - Namun komponen input transaksi dan edit budget di tempat lain memanggil:
    ```typescript
    await queryClient.invalidateQueries({ queryKey: ["budgets"] });
    ```
- **Dampak Risiko**:
  Kunci `["budgets"]` dan `["budget-summary"]` diperlakukan sebagai dua entitas cache terpisah oleh TanStack Query. Akibatnya, setiap kali pengguna mencatat pengeluaran di `QuickAddSheet` atau mengedit transaksi di `TransactionsPage`, query `["budget-summary"]` **tidak pernah di-refresh**. Pengguna yang membuka tab Budgeting akan melihat batas anggaran dan persentase terpakai yang basi (*stale read*) sampai halaman di-refresh penuh via browser reload.
- **Rekomendasi Solusi**:
  Standarisasi kunci query cache menggunakan hirarki prefix TanStack Query atau Query Key Factory terpusat, dan pastikan invalidasi mencakup seluruh varian budget:

```typescript
// Solusi Refactoring: app/client/src/lib/queryKeys.ts
export const queryKeys = {
  dashboard: (cycle?: string, period?: string) => ["dashboard", cycle, period] as const,
  wallets: () => ["wallets"] as const,
  transactions: () => ["transactions"] as const,
  debts: () => ["debts"] as const,
  budgets: {
    all: () => ["budgets"] as const,
    list: (period?: string) => ["budgets", "list", period] as const,
    summary: (period?: string) => ["budgets", "summary", period] as const,
  },
  netWorth: () => ["net-worth-summary"] as const,
  goals: () => ["goals"] as const,
};

// Pada BudgetPage.tsx:
useQuery({
  queryKey: queryKeys.budgets.summary(period),
  queryFn: () => api.getBudgetSummary(period),
});

// Helper invalidasi transaksi:
export async function invalidateTransactionSideEffects(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["wallets"] }),
    queryClient.invalidateQueries({ queryKey: ["debts"] }),
    queryClient.invalidateQueries({ queryKey: ["budgets"] }), // Meng-invalidate semua yang berawalan "budgets"
    queryClient.invalidateQueries({ queryKey: ["budget-summary"] }), // Backward-compatible
    queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["quick-presets"] }),
  ]);
}
```

---

## 4. Analisis Temuan Prioritas Tinggi (P1)

### CR-03: Endpoint Pengaturan Global Menimpa Konfigurasi Multi Kartu Kredit
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [settings.ts](../../app/server/src/routes/settings.ts#L70-L86)
- **Kondisi Saat Ini**:
  ```typescript
  if (
    parsed.data.cardLimit !== undefined ||
    parsed.data.cardCutoffDay !== undefined ||
    parsed.data.statementDay !== undefined ||
    parsed.data.cardPaymentDay !== undefined
  ) {
    await db
      .update(wallets)
      .set({
        creditLimit: updated!.cardLimit,
        cutoffDay: updated!.cardCutoffDay,
        statementDay: updated!.statementDay,
        paymentDay: updated!.cardPaymentDay,
      })
      .where(eq(wallets.type, "credit_card"));
  }
  ```
- **Dampak Risiko**:
  Di Milestone 2, sistem telah ditingkatkan untuk mendukung banyak kartu kredit (*Multi-CC*) dengan limit dan tanggal siklus masing-masing yang disimpan di tabel `wallets`. Namun, kode di atas mengeksekusi update massal pada semua dompet bertipe `credit_card`. Jika user memiliki Kartu BCA (cutoff 20, limit 30jt) dan Kartu Mandiri (cutoff 10, limit 15jt), mengubah form pengaturan umum akan meratakan seluruh kartu menjadi identik, menghapus setelan individual kartu.
- **Rekomendasi Solusi**:
  Hapus mutasi massal tabel `wallets` dari `routes/settings.ts`. Biarkan pengaturan kartu kredit dikelola secara mandiri per kartu di modul `wallets` (`PATCH /api/wallets/:id`). Tabel `app_settings` hanya perlu menyimpan parameter umum seperti siklus gajian.

---

### CR-04: Transaksi *Unbilled* Kartu Kredit Mengabaikan Multi-CC
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [transactions.ts](../../app/server/src/routes/transactions.ts#L116-L131), [L185-L193](../../app/server/src/routes/transactions.ts#L185-L193)
- **Kondisi Saat Ini**:
  ```typescript
  const ccWallet = walletRows.find((w) => w.type === "credit_card") ?? null;
  // ...
  const isUnbilledCc = Boolean(
    unbilledStartKey &&
      ccWallet &&
      tx.walletId === ccWallet.id &&
      tx.type === "expense" &&
      // ...
  );
  ```
- **Dampak Risiko**:
  Variabel `ccWallet` hanya mengambil kartu kredit pertama yang ditemukan. Untuk kartu kredit kedua dan seterusnya, kondisi `tx.walletId === ccWallet.id` selalu bernilai `false`. Transaksi belanja pada kartu kredit non-primer tidak pernah mendapatkan status `isUnbilledCc: true`, sehingga badge UI "Belum Ditagih" tidak muncul dan klasifikasi tagihan berjalan keliru.
- **Rekomendasi Solusi**:
  Hitung tanggal batas *unbilled* per masing-masing kartu kredit:
  ```typescript
  const ccWalletMap = new Map(
    walletRows.filter((w) => w.type === "credit_card").map((w) => [w.id, w]),
  );

  const isUnbilledCc = (tx: typeof pageRows[0]) => {
    const card = ccWalletMap.get(tx.walletId);
    if (!card || tx.type !== "expense" || tx.isConvertedToInstallment) return false;
    const cutoff = card.cutoffDay ?? settings.cardCutoffDay;
    const cycle = ccCycleForDate(tx.transactionDate, cutoff);
    const bounds = periodBounds(cycle, "cc", settings.gajianStartDay, cutoff);
    return tx.transactionDate >= bounds.start && tx.transactionDate <= bounds.end;
  };
  ```

---

### CR-05: Hapus Transaksi Penerimaan Piutang Menggantungkan Status Cicilan
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [transactions.ts](../../app/server/src/routes/transactions.ts#L803-L813)
- **Kondisi Saat Ini**:
  ```typescript
  if (existing.type === "settlement") {
    tx.update(installments)
      .set({
        status: "upcoming",
        actualAmount: null,
        paidAt: null,
        settlementTransactionId: null,
      })
      .where(eq(installments.settlementTransactionId, id))
      .run();
  }
  ```
- **Dampak Risiko**:
  Ketika pengguna menerima pelunasan piutang (*receivable installment*), transaksi yang dibuat bertipe `"debt_collection"`. Jika pengguna kemudian menghapus transaksi tersebut di halaman Transaksi, blok pengecekan di atas dilewati karena tipenya bukan `"settlement"`. Cicilan piutang tetap tercatat `paid`, namun uang pelunasannya sudah dihapus, menghasilkan selisih saldo dan inkonsistensi data piutang.
- **Rekomendasi Solusi**:
  Sertakan tipe `"debt_collection"` pada pembatalan status cicilan saat transaksi dihapus:
  ```typescript
  if (existing.type === "settlement" || existing.type === "debt_collection") {
    tx.update(installments)
      .set({
        status: "upcoming",
        actualAmount: null,
        paidAt: null,
        settlementTransactionId: null,
      })
      .where(eq(installments.settlementTransactionId, id))
      .run();
  }
  ```

---

### CR-06: Perhitungan Saldo Dompet In-Memory Scanning (`computeWalletBalance`)
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [cashLedger.ts](../../app/server/src/lib/cashLedger.ts#L10-L50)
- **Kondisi Saat Ini**:
  ```typescript
  export function computeWalletBalance(tx: TxOrDb, walletId: number, openingBalance: number): number {
    const walletTxs = tx
      .select({ type: transactions.type, amount: transactions.amount, walletId: transactions.walletId, toWalletId: transactions.toWalletId })
      .from(transactions)
      .where(or(eq(transactions.walletId, walletId), eq(transactions.toWalletId, walletId)))
      .all();

    let currentBalance = openingBalance;
    for (const row of walletTxs) {
      // perulangan array di JavaScript...
    }
    return currentBalance;
  }
  ```
- **Dampak Risiko**:
  Fungsi ini dipanggil pada setiap validasi transfer, rekonsiliasi, pembayaran utang, pelunasan dipercepat, dan setoran target tabungan. Ketika jumlah transaksi mencapai ribuan (misalnya 5.000 - 20.000 transaksi), SQLite harus mengekspor semua baris ke objek JS di memori hanya untuk menjumlahkan angka saldo. Ini membebani memori V8/JavaScriptCore dan berpotensi menyebabkan jeda latensi signifikan.
- **Rekomendasi Solusi**:
  Lakukan agregasi langsung pada engine SQLite dengan ekspresi `SUM(CASE ...)`:
  ```typescript
  export function computeWalletBalance(tx: TxOrDb, walletId: number, openingBalance: number): number {
    const [row] = tx
      .select({
        inflow: sql<number>`COALESCE(SUM(CASE 
          WHEN ${transactions.walletId} = ${walletId} AND ${transactions.type} IN ('income', 'adjustment', 'debt_collection', 'loan_disbursement') THEN ${transactions.amount}
          WHEN ${transactions.toWalletId} = ${walletId} AND ${transactions.type} = 'transfer' THEN ${transactions.amount}
          ELSE 0 
        END), 0)`,
        outflow: sql<number>`COALESCE(SUM(CASE 
          WHEN ${transactions.walletId} = ${walletId} AND ${transactions.type} IN ('expense', 'settlement', 'transfer', 'debt_disbursement') THEN ${transactions.amount}
          ELSE 0 
        END), 0)`,
      })
      .from(transactions)
      .where(or(eq(transactions.walletId, walletId), eq(transactions.toWalletId, walletId)))
      .all();

    return openingBalance + Number(row?.inflow ?? 0) - Number(row?.outflow ?? 0);
  }
  ```

---

### CR-07: Transaksi Setor Goal Tidak Menambah Saldo ke Dompet Target Tabungan
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [goals.ts](../../app/server/src/routes/goals.ts#L238-L268)
- **Kondisi Saat Ini**:
  Tabel `goals` memiliki kolom relasi `wallet_id` yang mewakili rekening tabungan atau instrumen penampung dana (misal: "BCA Tabungan" atau "Bibit RDN"). Namun ketika user menyetor dana (`POST /api/goals/:id/contribute`), sistem hanya mencatat `type: "expense"` dari dompet sumber (misal "BCA Operasional") dan meng-update angka `goals.currentAmount`.
- **Dampak Risiko**:
  Uang terpotong dari rekening operasional, tetapi tidak pernah masuk ke saldo rekening tabungan tujuan di modul Dompet. Akibatnya, saldo dompet tabungan tetap Rp0 padahal target tabungan menunjukkan sudah terkumpul jutaan rupiah.
- **Rekomendasi Solusi**:
  Jika target goal ditautkan ke rekening tabungan (`goal.walletId`) dan rekening sumber berbeda, catat transaksi sebagai transfer antar dompet atau buat transaksi penambahan saldo masuk pada dompet target, sehingga total kekayaan bersih dan saldo rekening fisik tetap klop.

---

### CR-08: Monolitik `App.tsx` Mengunci Seluruh Tab Saat Query Dashboard Mengalami Kendala
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [App.tsx](../../app/client/src/App.tsx#L341-L365)
- **Kondisi Saat Ini**:
  ```tsx
  if (dashboardQuery.isPending) {
    return <StateView kind="loading" title="Memuat catatan keuangan..." />;
  }
  if (dashboardQuery.error || !dashboardQuery.data) {
    return <StateView kind="error" title="Gagal memuat data keuangan" ... />;
  }
  // Baru di bawahnya tab "overview", "wallets", "transactions", "budget", "goals", "assets", "settings" dirender...
  ```
- **Dampak Risiko**:
  Seluruh aplikasi mengalami *tight coupling* terhadap endpoint `/api/dashboard`. Jika endpoint dashboard mengalami error sementara (misalnya ada bug pada parsing tanggal siklus tertentu), pengguna tidak bisa membuka tab `Pengaturan` untuk mengubah setting/PIN, tidak bisa membuka tab `Dompet` untuk melihat saldo rekening, dan tidak bisa membuka tab `Aset` meskipun masing-masing halaman tersebut memanggil API-nya sendiri.
- **Rekomendasi Solusi**:
  Pindahkan pengecekan `dashboardQuery.isPending` dan `dashboardQuery.error` hanya ke dalam sub-komponen `OverviewPage`, dan berikan masing-masing tab otonomi rendering penuh.

---

### CR-09: Eksekusi `recordAuditLog(db)` di Dalam Blok Transaksi Database `tx`
- **Tingkat Keparahan**: **P1 (Tinggi)**
- **Lokasi Berkas**: [debts.ts](../../app/server/src/routes/debts.ts#L171)
- **Kondisi Saat Ini**:
  ```typescript
  db.transaction((tx) => {
    // ... operasi delete dengan tx ...
    recordAuditLog(db, {
      entityType: "debt_account",
      entityId: id,
      action: "delete_debt_account",
      before: existing,
    });
  });
  ```
- **Dampak Risiko**:
  Instance yang dilewatkan ke `recordAuditLog` adalah `db` utama, bukan koneksi transaksi `tx`. Pada SQLite dengan WAL mode, membuka query insert pada koneksi non-transaksi saat transaksi lain masih menahan lock penulisan dapat memicu error `database is locked` (SQLITE_BUSY) atau deadlock.
- **Rekomendasi Solusi**:
  Ganti `recordAuditLog(db, ...)` menjadi `recordAuditLog(tx, ...)`.

---

## 5. Analisis Temuan Menengah & Kebersihan Kode (P2)

### CR-10: Pelanggaran Linter Biome & Dead State di Halaman Klien
- **Lokasi**: [OverviewPage.tsx](../../app/client/src/pages/OverviewPage.tsx#L29), [SettingsPage.tsx](../../app/client/src/pages/SettingsPage.tsx#L598)
- **Temuan**:
  Perintah `bun run lint` menghasilkan 6 error dan 2 warning:
  1. `OverviewPage.tsx`: Parameter `cycle` dan `onCycleChange` tidak digunakan.
  2. `OverviewPage.tsx`: Variabel terhitung `todaySpent` dan `dailyAllowance` didefinisikan tetapi tidak dirender pada JSX.
  3. `SettingsPage.tsx`: `cardCutoffDay`, `statementDay`, `cardPaymentDay`, dan `cardLimit` disimpan di state lokal tetapi tidak memiliki input kontrol di JSX.
  4. `biome.json`: Format konfigurasi `linter.recommended` deprecated dan meminta migrasi ke `linter.preset`.
- **Rekomendasi Solusi**:
  Bersihkan dead code dan perbarui `biome.json` agar CI/CD pipeline bebas warning.

---

### CR-11: Kurangnya Granular Error Boundary pada Visual Widgets
- **Lokasi**: [main.tsx](../../app/client/src/main.tsx#L21-L25), [UI.tsx](../../app/client/src/components/UI.tsx#L298-L325)
- **Temuan**:
  Aplikasi hanya membungkus root komponen dengan satu `ErrorBoundary`. Komponen grafik kompleks seperti Recharts, Sparkline SVG Bézier calculation, dan Kalender Heatmap sangat sensitif terhadap data tak terduga (misalnya nilai koordinat `NaN` atau data array kosong).
- **Dampak**: Jika grafik mengalami error kalkulasi SVG, seluruh halaman meledak dan menampilkan error screen penuh yang memaksa reload.
- **Rekomendasi Solusi**: Buat `WidgetErrorBoundary` ringan yang membungkus komponen grafik agar jika grafik error, widget cukup menampilkan fallback card "Grafik tidak dapat dimuat" tanpa merusak sisa dashboard.

---

### CR-12: Redundansi Query Otentikasi pada Setiap Panggilan API
- **Lokasi**: [auth.ts](../../app/server/src/lib/auth.ts#L146-L164)
- **Temuan**:
  Middleware `createAuthMiddleware` selalu memanggil `db.select({ pinHash, sessionVersion }).from(appSettings).where(eq(appSettings.id, 1))` pada **setiap request**. Saat pengguna membuka dashboard, browser menembakkan hingga 10 request API secara simultan, memicu 10 query database yang identik secara bersamaan hanya untuk memastikan versi session tidak berubah.
- **Rekomendasi Solusi**: Simpan `sessionVersion` dan `pinHash` dalam memory cache sederhana dengan invalidasi saat PIN diubah atau settings di-update.

---

### CR-13: Monolitik Komponen Raksasa pada Frontend (Technical Debt)
- **Lokasi**:
  - `app/client/src/pages/SettingsPage.tsx` (1.856 baris)
  - `app/client/src/App.tsx` (948 baris)
  - `app/client/src/pages/TransactionsPage.tsx` (901 baris)
- **Temuan**:
  `SettingsPage.tsx` memuat logika pengaturan gaji, manajemen multi-dompet, pengelolaan kategori, biaya rutin kartu, reset database, ekspor CSV/JSON, dan ubah PIN dalam satu fungsi komponen raksasa dengan lebih dari 30 state lokal `useState`. Setiap pengetikan huruf pada input form memicu re-render ribuan elemen DOM.
- **Rekomendasi Solusi**:
  Pecah `SettingsPage.tsx` menjadi sub-komponen terisolasi:
  - `src/pages/settings/SalarySettingsSection.tsx`
  - `src/pages/settings/WalletSettingsSection.tsx`
  - `src/pages/settings/CategorySettingsSection.tsx`
  - `src/pages/settings/SecurityPinSection.tsx`
  - `src/pages/settings/DataBackupSection.tsx`

---

### CR-14: Format Rupiah di Atas Rp1 Miliar
- **Lokasi**: [format.ts](../../app/client/src/lib/format.ts#L76-L79)
- **Temuan**:
  Fungsi `formatCompactRupiah` hanya membagi angka ke dalam satuan juta (`jt`) dan ribu (`rb`):
  ```typescript
  if (abs >= 1_000_000) {
    const val = (abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1).replace(".", ",");
    return `${sign}Rp${val} jt`;
  }
  ```
  Pada modul *Net Worth* dan Aset Tetap (properti, rumah, tanah), angka valuasi mencapai miliaran. Nominal Rp2.500.000.000 akan diformat menjadi `Rp2500 jt`, yang janggal dibaca dalam konvensi finansial Indonesia.
- **Rekomendasi Solusi**:
  Tambahkan pemformatan miliar (`M`) dan triliun (`T`):
  ```typescript
  if (abs >= 1_000_000_000) {
    const val = (abs / 1_000_000_000).toFixed(1).replace(".", ",");
    return `${sign}Rp${val} M`;
  }
  ```

---

### CR-15: Hapus Kategori Mengabaikan `transactionSplits` dan `recurringRules`
- **Lokasi**: [categories.ts](../../app/server/src/routes/categories.ts#L183-L201)
- **Temuan**:
  Validasi penghapusan kategori hanya menghitung baris di tabel `transactions`. Jika kategori tersebut sedang digunakan oleh baris di tabel `transaction_splits` atau aturan di `recurring_rules`, kategori tetap terhapus, meninggalkan string kategori yang tidak terdaftar.
- **Rekomendasi Solusi**:
  Periksa juga tabel `transactionSplits` dan `recurringRules` sebelum mengizinkan penghapusan kategori.

---

### CR-16: Pengiriman Header `Content-Type` pada Request Tanpa Body
- **Lokasi**: [api.ts](../../app/client/src/lib/api.ts#L89)
- **Temuan**:
  Helper `request<T>()` selalu menyematkan `'Content-Type': 'application/json'` untuk semua pemanggilan, termasuk `GET /api/wallets` atau `DELETE /api/goals/1`. Menurut spesifikasi HTTP RFC, request tanpa payload body tidak seharusnya memuat header `Content-Type`.
- **Rekomendasi Solusi**:
  Hanya sematkan `'Content-Type'` jika opsi `init?.body` ada.

---

## 6. Evaluasi Skema Shared & Type Safety (`app/shared/src`)

1. **Zod Validation & Range Limits**:
   - Di `convertSplitPaySchema` (baris 108), `paymentDay` dibatasi `max(28)`. Sementara di `createRecurringRuleSchema` (baris 175) dan `recurring_rules` batasnya adalah `max(31)`. Pembatasan tanggal tagihan ke 28 terlalu ketat untuk kartu kredit atau utang yang jatuh temponya tanggal 30 atau 31. Tanggal 29-31 sebaiknya diizinkan dengan penyesuaian otomatis (*clamping*) ke hari terakhir bulan berjalan melalui `addMonthsToDate`.
2. **Sinkronisasi DTO & Response Type**:
   - Seluruh DTO di `dtos.ts` didefinisikan dengan rapi dan diekspor ke client. Tidak ditemukan penggunaan `any` yang berbahaya.
   - Pengecekan TypeScript (`bun run typecheck`) berjalan dengan **0 error** di server maupun client.
3. **Penyelarasan Nilai Moneter**:
   - Aturan baku proyek: *Seluruh nominal uang disimpan dalam bilangan bulat IDR (bukan sen)* diterapkan dengan konsisten pada Drizzle schema (`integer`) dan validasi Zod (`z.number().int()`).

---

## 7. Rencana Tindakan Refactoring Terstruktur

```mermaid
flowchart TD
    subgraph Fase 1: Perbaikan Kritis & Bug Pembukuan (P0)
        A1[Bungkus receiveSalaryForPeriod dalam db.transaction] --> A2[Catat alokasi payroll ke settlementAllocations]
        A3[Standarisasi TanStack Query Keys & Invalidation Helper] --> A4[Perbaiki queryKey budget-summary vs budgets]
    end

    subgraph Fase 2: Integritas Multi-CC & Accounting Engine (P1)
        B1[Hapus mutasi massal credit_card di routes/settings.ts] --> B2[Dukung deteksi isUnbilledCc untuk Multi-CC]
        B3[Perbaiki hapus transaksi debt_collection di transactions.ts] --> B4[Optimasi computeWalletBalance via SQL Aggregate SUM]
        B5[Hubungkan transaksi setor goal ke dompet tujuan] --> B6[Lepaskan ketergantungan dashboardQuery di App.tsx]
        B7[Ganti recordAuditLog db menjadi tx di debts.ts]
    end

    subgraph Fase 3: Kebersihan Kode & Refactoring Modular (P2)
        C1[Selesaikan 6 Error Biome Linter di OverviewPage & SettingsPage]
        C2[Pecah SettingsPage.tsx 1.856 baris menjadi sub-modul terpisah]
        C3[Implementasikan WidgetErrorBoundary pada visual charts]
        C4[Tambahkan format Rp Miliar pada formatCompactRupiah]
    end

    Fase 1 --> Fase 2 --> Fase 3
```

---

## 8. Kesimpulan & Rekomendasi Selanjutnya

Kode program Financial Tracker memiliki arsitektur yang modern, terstruktur rapi, serta didukung oleh pengetikan TypeScript yang kuat dan dokumentasi milestone yang komprehensif. Masalah-masalah yang teridentifikasi dalam review ini sebagian besar berasal dari proses evolusi fitur (*feature evolution*), seperti penambahan fitur *Multi-CC*, *Split Categories*, dan *Goals/Aset* yang meninggalkan sisa-sisa logika lama (legacy single-card assumption, dead state, dan query key mismatch).

Dengan mengimplementasikan rekomendasi perbaikan P0 dan P1 di atas, sistem akan mencapai stabilitas tingkat tinggi, performa kueri yang optimal, serta jaminan integritas data keuangan tanpa risiko salah catat.
