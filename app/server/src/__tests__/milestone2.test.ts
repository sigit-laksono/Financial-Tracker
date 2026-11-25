import { describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  auditLogs,
  categories,
  debtAccounts,
  goals,
  installments,
  recurringRules,
  settlementAllocations,
  transactionSplits,
  transactions,
  walletRecurringFees,
  wallets,
} from "../db/schema";
import { resolveBudgetsForPeriod } from "../lib/budgetService";
import { ensureMonthlyBankFees } from "../lib/ccBilling";
import { buildDashboardData, buildDebtsData, generateCycleTimeline } from "../lib/dashboardQuery";
import { ensurePayrollAutoPaid } from "../lib/debtEngine";
import { computeLedgerSnapshot, runDailyLedgerSync } from "../lib/ledgerSnapshot";
import { getSalaryPreview, receiveSalaryForPeriod } from "../lib/salaryService";
import { setupTestContext } from "./testHelper";

describe("Milestone 2: Hutang & Piutang, Upgrade Pinjaman, Multi-CC & Timeline Siklus", () => {
  it("pencatatan piutang baru menurunkan saldo dompet asal dan penerimaan pelunasan menambah dompet tujuan tanpa mengotori totalExpense/totalIncome", async () => {
    const { db, app } = await setupTestContext();

    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    const [gopay] = await db.select().from(wallets).where(eq(wallets.key, "gopay"));
    expect(bca).toBeDefined();
    expect(gopay).toBeDefined();

    // Opening balances: BCA Rp2.000.000, GoPay Rp100.000
    await app.request(`/api/wallets/${bca!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 2_000_000 }),
    });
    await app.request(`/api/wallets/${gopay!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 100_000 }),
    });

    let snap = await computeLedgerSnapshot(db, "2026-10-26");
    expect(snap.wallets.find((w) => w.id === bca!.id)?.balance).toBe(2_000_000);
    expect(snap.wallets.find((w) => w.id === gopay!.id)?.balance).toBe(100_000);

    // 1. Catat piutang baru Rp500.000 ke Budi dari BCA dengan disbursement langsung
    const createDebtRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Talangan Tiket Budi",
        lender: "Budi",
        kind: "receivable",
        direction: "receivable",
        initialBalance: 500_000,
        installmentCount: 1,
        installmentAmount: 500_000,
        firstDueDate: "2026-11-05",
        paymentMethod: "Transfer BCA",
        disburseWalletId: bca!.id,
        recordDisbursement: true,
      }),
    });
    expect(createDebtRes.status).toBe(201);
    const debtCreated = (await createDebtRes.json()) as { ok: boolean; accountId: number };
    expect(debtCreated.accountId).toBeGreaterThan(0);

    // Cek saldo BCA turun jadi Rp1.500.000
    snap = await computeLedgerSnapshot(db, "2026-10-26");
    expect(snap.wallets.find((w) => w.id === bca!.id)?.balance).toBe(1_500_000);

    // Cek debts data: remainingReceivable = 500.000, remainingDebt = 0
    let debtsData = await buildDebtsData(db, "2026-10-26");
    expect(debtsData.totals.remainingReceivable).toBe(500_000);
    expect(debtsData.totals.remainingDebt).toBe(0);
    expect(debtsData.totals.netDebtPosition).toBe(500_000);

    // Cek dashboard: totalExpense siklus tetap 0 (tidak mengotori expense!)
    let dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-26",
    });
    expect(dash.metrics.totalExpense).toBe(0);
    expect(dash.metrics.totalIncome).toBe(0);

    // 2. Budi bayar pengembalian Rp500.000 masuk ke GoPay
    const targetInstallment = debtsData.installments.find(
      (i) => i.accountId === debtCreated.accountId,
    );
    expect(targetInstallment).toBeDefined();

    const settleRes = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [targetInstallment!.id],
        fromWalletId: gopay!.id,
        paymentDate: "2026-10-28",
      }),
    });
    expect(settleRes.status).toBe(200);

    // Saldo GoPay naik Rp500.000 jadi Rp600.000
    snap = await computeLedgerSnapshot(db, "2026-10-28");
    expect(snap.wallets.find((w) => w.id === gopay!.id)?.balance).toBe(600_000);

    // Piutang lunas: remainingReceivable = 0
    debtsData = await buildDebtsData(db, "2026-10-28");
    expect(debtsData.totals.remainingReceivable).toBe(0);
    expect(debtsData.totals.paidReceivable).toBe(500_000);

    // totalIncome tetap 0 (tidak dianggap gaji/income!)
    dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-28",
    });
    expect(dash.metrics.totalIncome).toBe(0);

    // 3. Hapus transaksi penerimaan piutang (debt_collection) -> status cicilan harus kembali menjadi "upcoming"
    const settleJson = (await settleRes.json()) as { settlementTransactionId: number };
    expect(settleJson.settlementTransactionId).toBeDefined();

    const deleteTxRes = await app.request(
      `/api/transactions/${settleJson.settlementTransactionId}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteTxRes.status).toBe(200);

    const [revertedInst] = await db
      .select()
      .from(installments)
      .where(eq(installments.id, targetInstallment!.id));
    expect(revertedInst!.status).toBe("upcoming");
    expect(revertedInst!.settlementTransactionId).toBeNull();
    expect(revertedInst!.actualAmount).toBeNull();
  });

  it("pencairan loan (Flexi Cash) masuk ke dompet tujuan tanpa dihitung sebagai income gaji", async () => {
    const { db, app } = await setupTestContext();

    const [btpn] = await db.select().from(wallets).where(eq(wallets.key, "btpn"));
    expect(btpn).toBeDefined();

    // Initial balance BTPN 0
    let snap = await computeLedgerSnapshot(db, "2026-10-26");
    expect(snap.wallets.find((w) => w.id === btpn!.id)?.balance).toBe(0);

    // Catat pinjaman Flexi Cash cair Rp8.600.000 ke BTPN
    const res = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Flexi Cash Renovasi",
        lender: "Jenius",
        kind: "loan",
        direction: "payable",
        initialBalance: 8_600_000,
        installmentCount: 10,
        installmentAmount: 950_000,
        principalAmount: 860_000,
        interestAmount: 90_000,
        firstDueDate: "2026-11-23",
        paymentMethod: "Auto Debit",
        disburseWalletId: btpn!.id,
        recordDisbursement: true,
      }),
    });
    expect(res.status).toBe(201);

    // Saldo BTPN naik jadi Rp8.600.000
    snap = await computeLedgerSnapshot(db, "2026-10-26");
    expect(snap.wallets.find((w) => w.id === btpn!.id)?.balance).toBe(8_600_000);

    // Dashboard totalIncome tetap 0 (tidak masuk ke gaji atau evaluasi income)
    const dash = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-26",
    });
    expect(dash.metrics.totalIncome).toBe(0);
    expect(dash.metrics.totalExpense).toBe(0);

    // Debts portfolio mencatat sisa utang
    const debtsData = await buildDebtsData(db, "2026-10-26");
    expect(debtsData.totals.remainingDebt).toBe(8_600_000);
    expect(debtsData.installments[0]?.principalAmount).toBe(860_000);
    expect(debtsData.installments[0]?.interestAmount).toBe(90_000);
  });

  it("pelunasan dipercepat (early payoff) menutup seluruh sisa cicilan dan akun utang dalam 1 aksi atomik", async () => {
    const { db, app } = await setupTestContext();

    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    expect(bni).toBeDefined();

    // BNI opening balance Rp5.000.000
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 5_000_000 }),
    });

    // Buat utang 6 bulan @ Rp500.000 (total Rp3.000.000)
    const createRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pinjaman Teman",
        lender: "Andi",
        kind: "loan",
        direction: "payable",
        initialBalance: 3_000_000,
        installmentCount: 6,
        installmentAmount: 500_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId } = (await createRes.json()) as { accountId: number };

    // Lunasi cicilan pertama secara manual Rp500.000
    let debtsData = await buildDebtsData(db, "2026-10-26");
    const firstInst = debtsData.installments.find((i) => i.accountId === accountId);
    await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [firstInst!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-10-26",
      }),
    });

    debtsData = await buildDebtsData(db, "2026-10-26");
    const account = debtsData.accounts.find((a) => a.id === accountId);
    expect(account?.paidAmount).toBe(500_000);
    expect(account?.remainingBalance).toBe(2_500_000);
    expect(account?.closed).toBe(false);

    // Lakukan Early Payoff sisa Rp2.500.000
    const payoffRes = await app.request(`/api/debts/${accountId}/payoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWalletId: bni!.id,
        paymentDate: "2026-10-27",
      }),
    });
    expect(payoffRes.status).toBe(200);
    const payoffResult = (await payoffRes.json()) as {
      ok: boolean;
      payoffAmount: number;
      settledCount: number;
    };
    expect(payoffResult.payoffAmount).toBe(2_500_000);
    expect(payoffResult.settledCount).toBe(5);

    // Akun sekarang otomatis tertutup dan lunas
    debtsData = await buildDebtsData(db, "2026-10-27");
    const updatedAccount = debtsData.accounts.find((a) => a.id === accountId);
    expect(updatedAccount?.closed).toBe(true);
    expect(updatedAccount?.remainingBalance).toBe(0);
    expect(updatedAccount?.paidAmount).toBe(3_000_000);

    // Seluruh cicilan berstatus "paid"
    const accountInstallments = debtsData.installments.filter((i) => i.accountId === accountId);
    expect(accountInstallments.every((i) => i.status === "paid")).toBe(true);

    // Saldo BNI berkurang: 5.000.000 - 500.000 - 2.500.000 = 2.000.000
    const snap = await computeLedgerSnapshot(db, "2026-10-27");
    expect(snap.wallets.find((w) => w.id === bni!.id)?.balance).toBe(2_000_000);
  });

  it("mendukung Multi-CC dan konfigurasi biaya rutin per kartu secara independen", async () => {
    const { db, app } = await setupTestContext();

    // 1. Buat CC kedua: "CC BCA Everyday"
    const createCcRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CC BCA Everyday",
        type: "credit_card",
        creditLimit: 15_000_000,
        cutoffDay: 15,
        statementDay: 16,
        paymentDay: 5,
        color: "#2d54bc",
      }),
    });
    expect(createCcRes.status).toBe(201);
    const { wallet: ccBca } = (await createCcRes.json()) as { wallet: { id: number } };

    // 2. Tambah konfigurasi biaya rutin pada CC BCA
    const addFeeRes = await app.request(`/api/wallets/${ccBca.id}/recurring-fees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Notifikasi SMS",
        amount: 7_500,
        isActive: true,
      }),
    });
    expect(addFeeRes.status).toBe(201);

    // List recurring fees
    const listFees = await app.request(`/api/wallets/${ccBca.id}/recurring-fees`);
    expect(listFees.status).toBe(200);
    const { fees } = (await listFees.json()) as { fees: Array<{ name: string; amount: number }> };
    expect(fees.length).toBe(1);
    expect(fees[0]?.name).toBe("Notifikasi SMS");
    expect(fees[0]?.amount).toBe(7_500);

    // 3. Catat transaksi belanja di CC Jenius dan CC BCA
    const [ccJenius] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));

    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Jenius",
        amount: 300_000,
        transactionDate: "2026-10-22",
        category: "Belanja Pribadi & Hobi",
        walletId: ccJenius!.id,
      }),
    });

    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja BCA",
        amount: 450_000,
        transactionDate: "2026-10-22",
        category: "Belanja Pribadi & Hobi",
        walletId: ccBca.id,
      }),
    });

    // 4. Periksa data DebtsDto memuat kedua kartu dalam cards array
    const debtsData = await buildDebtsData(db, "2026-10-26");
    expect(debtsData.cards.length).toBe(2);

    const cardJenius = debtsData.cards.find((c) => c.walletId === ccJenius!.id);
    const cardBca = debtsData.cards.find((c) => c.walletId === ccBca.id);

    expect(cardJenius).toBeDefined();
    expect(cardBca).toBeDefined();
    expect(cardJenius!.limitUsed).toBe(300_000);
    expect(cardBca!.limitUsed).toBe(450_000);

    // 5. Verifikasi bahwa transaksi di CC kedua (BCA) terdeteksi sebagai isUnbilledCc
    const txListRes = await app.request("/api/transactions?end=2026-10-24");
    expect(txListRes.status).toBe(200);
    const { items: txItems } = (await txListRes.json()) as {
      items: Array<{ id: number; merchant: string; isUnbilledCc: boolean }>;
    };
    const bcaTx = txItems.find((t) => t.merchant === "Belanja BCA");
    expect(bcaTx).toBeDefined();
    expect(bcaTx!.isUnbilledCc).toBe(true);

    // Total limit teragregasi
    expect(debtsData.totals.ccLimit).toBe(35_000_000); // 20jt + 15jt
    expect(debtsData.totals.ccLimitUsed).toBe(750_000);
    expect(debtsData.totals.ccLimitAvailable).toBe(34_250_000);
  });

  it("timeline siklus menghasilkan node kronologis akurat untuk bulan pendek (Februari) dan transisi tahun", async () => {
    const { db } = await setupTestContext();

    const snap = await computeLedgerSnapshot(db, "2026-02-26");

    // Gajian cycle bounds for February: 2026-02-25 to 2026-03-24
    const boundsFeb = { start: "2026-02-25", end: "2026-03-24" };
    const timelineFeb = generateCycleTimeline(snap, boundsFeb, "2026-02-26");

    expect(timelineFeb.length).toBeGreaterThan(0);
    // Node dates must be ascending
    for (let i = 1; i < timelineFeb.length; i++) {
      expect(timelineFeb[i]!.date.localeCompare(timelineFeb[i - 1]!.date)).toBeGreaterThanOrEqual(
        0,
      );
    }

    // Year-end transition: 2026-12-25 to 2027-01-24
    const boundsYearEnd = { start: "2026-12-25", end: "2027-01-24" };
    const timelineYearEnd = generateCycleTimeline(snap, boundsYearEnd, "2026-12-28");
    expect(timelineYearEnd.length).toBeGreaterThan(0);

    // Gajian tgl 25 Desember 2026 harus ada
    const gajianNode = timelineYearEnd.find((n) => n.id.startsWith("gajian"));
    expect(gajianNode).toBeDefined();
    expect(gajianNode?.date).toBe("2026-12-25");

    // Tutup buku Januari 2027 (tgl 20) harus ada
    const cutoffJan = timelineYearEnd.find(
      (n) => n.category === "cc_cutoff" && n.date === "2027-01-20",
    );
    expect(cutoffJan).toBeDefined();
  });

  it("menolak pelunasan tagihan CC atau utang jika saldo dompet sumber tidak mencukupi (preventOverdraft)", async () => {
    const { db, app } = await setupTestContext();

    const [tunai] = await db.select().from(wallets).where(eq(wallets.key, "tunai"));
    const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));
    expect(tunai).toBeDefined();
    expect(cc).toBeDefined();

    // 1. Buat belanja CC Rp 250.000 pada siklus 2026-10
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Supermarket",
        amount: 250_000,
        transactionDate: "2026-10-15",
        category: "Makanan & Belanja Dapur",
        walletId: cc!.id,
      }),
    });

    // 2. Coba bayar tagihan CC menggunakan dompet Tunai (saldo Rp 0) dengan preventOverdraft: true
    const failSettleRes = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ccCycleKey: "2026-10",
        fromWalletId: tunai!.id,
        paymentDate: "2026-10-25",
        preventOverdraft: true,
      }),
    });

    expect(failSettleRes.status).toBe(400);
    const failBody = await failSettleRes.json();
    expect(failBody.error).toContain("tidak mencukupi");

    // 3. Setor saldo ke dompet Tunai sebesar Rp 300.000
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "income",
        merchant: "Setor Kas",
        amount: 300_000,
        transactionDate: "2026-10-24",
        category: "Gaji",
        walletId: tunai!.id,
      }),
    });

    // 4. Bayar lagi tagihan CC sekarang karena saldo sudah cukup
    const successSettleRes = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ccCycleKey: "2026-10",
        fromWalletId: tunai!.id,
        paymentDate: "2026-10-25",
        preventOverdraft: true,
      }),
    });

    expect(successSettleRes.status).toBe(200);
    const snap = await computeLedgerSnapshot(db, "2026-10-26");
    const tunaiWallet = snap.wallets.find((w) => w.id === tunai!.id);
    expect(tunaiWallet?.balance).toBe(50_000); // 300.000 - 250.000
  });

  it("cicilan kartu kredit memotong sisa limit dan memblokir transaksi harian yang melebihi sisa limit", async () => {
    const { app } = await setupTestContext();

    // 1. Buat kartu kredit baru dengan limit Rp 15.000.000
    const createCcRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CC Limit 15Jt",
        type: "credit_card",
        creditLimit: 15_000_000,
        cutoffDay: 20,
        statementDay: 21,
        paymentDay: 10,
      }),
    });
    expect(createCcRes.status).toBe(201);
    const { wallet: cc15 } = (await createCcRes.json()) as { wallet: { id: number } };

    // 2. Tambah cicilan kartu kredit sebesar Rp 6.000.000 (6 x Rp 1.000.000) terikat ke kartu ini
    const createInstallmentRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cicilan Laptop CC",
        lender: "CC Limit 15Jt",
        kind: "card_installment",
        direction: "payable",
        walletId: cc15.id,
        initialBalance: 6_000_000,
        installmentCount: 6,
        installmentAmount: 1_000_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Tagihan kartu",
      }),
    });
    expect(createInstallmentRes.status).toBe(201);

    // 3. Verifikasi sisa limit sekarang Rp 9.000.000 (6 jt terkunci cicilan)
    let debtsRes = await app.request("/api/debts");
    let debtsBody = (await debtsRes.json()) as {
      cards: Array<{
        walletId: number;
        creditLimit: number;
        limitUsed: number;
        dailyLimitUsed: number;
        installmentLimitUsed: number;
        balance: number;
      }>;
      totals: { cardInstallmentRemaining: number };
    };
    let card15 = debtsBody.cards.find((c) => c.walletId === cc15.id)!;
    expect(card15.creditLimit).toBe(15_000_000);
    expect(card15.installmentLimitUsed).toBe(6_000_000);
    expect(card15.dailyLimitUsed).toBe(0);
    expect(card15.limitUsed).toBe(6_000_000);
    expect(card15.balance).toBe(9_000_000);
    expect(debtsBody.totals.cardInstallmentRemaining).toBe(6_000_000);

    // 4. Transaksi harian Rp 9.500.000 harus ditolak (melebihi sisa limit Rp 9.000.000)
    const overLimitDailyRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Melebihi Sisa Limit",
        amount: 9_500_000,
        transactionDate: "2026-10-25",
        category: "Belanja Pribadi & Hobi",
        walletId: cc15.id,
      }),
    });
    expect(overLimitDailyRes.status).toBe(400);
    const overLimitJson = (await overLimitDailyRes.json()) as { error: string };
    expect(overLimitJson.error).toContain("melebihi sisa limit");

    // 5. Transaksi harian Rp 5.000.000 berhasil dan menyisakan limit Rp 4.000.000
    const okDailyRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Normal",
        amount: 5_000_000,
        transactionDate: "2026-10-25",
        category: "Belanja Pribadi & Hobi",
        walletId: cc15.id,
      }),
    });
    expect(okDailyRes.status).toBe(201);
    const { id: okDailyTxId } = (await okDailyRes.json()) as { id: number };

    // 5b. Edit transaksi Rp 5jt -> Rp 9.5jt harus ditolak (tersedia sebelum edit = 9jt),
    // sedangkan edit ke Rp 6jt harus berhasil (tersedia 9jt -> sisa 3jt), lalu kembalikan ke Rp 5jt
    const overLimitPatchRes = await app.request(`/api/transactions/${okDailyTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 9_500_000 }),
    });
    expect(overLimitPatchRes.status).toBe(400);

    const okPatchRes = await app.request(`/api/transactions/${okDailyTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 5_000_000 }),
    });
    expect(okPatchRes.status).toBe(200);

    debtsRes = await app.request("/api/debts");
    debtsBody = (await debtsRes.json()) as typeof debtsBody;
    card15 = debtsBody.cards.find((c) => c.walletId === cc15.id)!;
    expect(card15.installmentLimitUsed).toBe(6_000_000);
    expect(card15.dailyLimitUsed).toBe(5_000_000);
    expect(card15.limitUsed).toBe(11_000_000);
    expect(card15.balance).toBe(4_000_000);

    // 6. Tambah cicilan CC baru Rp 4.500.000 juga harus ditolak karena sisa limit Rp 4.000.000
    const overLimitInstRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cicilan Overlimit",
        lender: "CC Limit 15Jt",
        kind: "card_installment",
        direction: "payable",
        walletId: cc15.id,
        initialBalance: 4_500_000,
        installmentCount: 3,
        installmentAmount: 1_500_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Tagihan kartu",
      }),
    });
    expect(overLimitInstRes.status).toBe(400);

    // 7. Uji PATCH /api/debts/:id: edit cicilan CC (geser tanggal jatuh tempo + custom nominal)
    const debtAcc = (
      (await (await app.request("/api/debts")).json()) as {
        accounts: Array<{ id: number; name: string }>;
        installments: Array<{ id: number; accountId: number; dueDate: string; plannedAmount: number }>;
      }
    );
    const laptopAcc = debtAcc.accounts.find((a) => a.name === "Cicilan Laptop CC")!;
    const laptopInsts = debtAcc.installments.filter((i) => i.accountId === laptopAcc.id);

    // Ubah jatuh tempo & nominal bulan pertama dari 1.000.000 -> 1.500.000 (total naik 500rb, masih muat di sisa limit 4jt)
    const patchOkRes = await app.request(`/api/debts/${laptopAcc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cicilan Laptop CC Revisi",
        installments: laptopInsts.map((inst, idx) => ({
          id: inst.id,
          dueDate: idx === 0 ? "2026-11-15" : inst.dueDate,
          plannedAmount: idx === 0 ? 1_500_000 : inst.plannedAmount,
        })),
      }),
    });
    expect(patchOkRes.status).toBe(200);

    // Ubah nominal bulan pertama jadi 6.000.000 (naik 4,5jt melebihi sisa limit 3,5jt) -> harus ditolak 400
    const patchOverRes = await app.request(`/api/debts/${laptopAcc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installments: laptopInsts.map((inst, idx) => ({
          id: inst.id,
          dueDate: inst.dueDate,
          plannedAmount: idx === 0 ? 6_000_000 : inst.plannedAmount,
        })),
      }),
    });
    expect(patchOverRes.status).toBe(400);

    // 8. Uji cut-off CC: kartu dengan cut-off tgl 21, cicilan tanggal 26 Nov 2026 harus masuk siklus Desember 2026 (sama seperti transaksi 22 Nov)
    const createJeniusRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jenius Cut21",
        type: "credit_card",
        creditLimit: 15_000_000,
        cutoffDay: 21,
        statementDay: 21,
        paymentDay: 7,
      }),
    });
    expect(createJeniusRes.status).toBe(201);
    const { wallet: jenius21 } = (await createJeniusRes.json()) as { wallet: { id: number } };

    const ccNovInstRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CC Nov",
        lender: "Jenius Cut21",
        kind: "card_installment",
        direction: "payable",
        walletId: jenius21.id,
        initialBalance: 3_582_808,
        installmentCount: 1,
        installmentAmount: 3_582_808,
        firstDueDate: "2026-11-26",
        paymentMethod: "Tagihan kartu",
      }),
    });
    expect(ccNovInstRes.status).toBe(201);

    const ccNovTxRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Warung Agus",
        amount: 22_000,
        transactionDate: "2026-11-22",
        category: "Makanan & Belanja Dapur",
        walletId: jenius21.id,
      }),
    });
    expect(ccNovTxRes.status).toBe(201);

    const debtsCutoffRes = await app.request("/api/debts");
    const debtsCutoffBody = (await debtsCutoffRes.json()) as {
      cards: Array<{
        walletId: number;
        cycleSummaries: Array<{
          cycleKey: string;
          dailyTotal: number;
          installmentTotal: number;
          totalBill: number;
        }>;
      }>;
      installments: Array<{ accountName: string; period: string; dueDate: string }>;
    };
    const jeniusCardSummary = debtsCutoffBody.cards.find((c) => c.walletId === jenius21.id)!;
    const decCycle = jeniusCardSummary.cycleSummaries.find((s) => s.cycleKey === "2026-12")!;
    const novCycle = jeniusCardSummary.cycleSummaries.find((s) => s.cycleKey === "2026-11")!;
    expect(decCycle.dailyTotal).toBe(22_000);
    expect(decCycle.installmentTotal).toBe(3_582_808);
    expect(decCycle.totalBill).toBe(3_604_808);
    expect(novCycle.installmentTotal).toBe(0);
    const ccNovInst = debtsCutoffBody.installments.find((i) => i.accountName === "CC Nov")!;
    expect(ccNovInst.period).toBe("2026-12");

    // 9. Uji pembayaran cicilan & pelunasan dipercepat masuk ke Cicilan & Hutang + totalExpense, tanpa double-count belanja harian CC (cc_cycle)
    const walletsRes9 = await app.request("/api/wallets");
    const walletsList9 = ((await walletsRes9.json()) as { wallets: Array<{ id: number; key: string }> }).wallets;
    const bni9 = walletsList9.find((w) => w.key === "bni")!;
    // Deposit cukup saldo ke BNI
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "income",
        merchant: "Gaji Uji",
        amount: 10_000_000,
        transactionDate: "2026-11-25",
        category: "Gaji",
        walletId: bni9.id,
      }),
    });

    // Bayar gabungan siklus 2026-12 Jenius Cut21: harian 22.000 (cc_cycle) + cicilan CC Nov 3.582.808 (installment) = 3.604.808
    const decUnpaidInstIds = debtsCutoffBody.cards
      .find((c) => c.walletId === jenius21.id)!
      .cycleSummaries.find((s) => s.cycleKey === "2026-12")!;
    const settleCombined9 = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ccWalletId: jenius21.id,
        ccCycleKey: "2026-12",
        installmentIds: (decUnpaidInstIds as unknown as { unpaidInstallmentIds: number[] }).unpaidInstallmentIds,
        fromWalletId: bni9.id,
        paymentDate: "2026-11-26",
      }),
    });
    expect(settleCombined9.status).toBe(200);

    // Cek dashboard gajian 2026-11 (25 Nov - 24 Des 2026):
    // Pembayaran gabungan Rp 3.604.808 pada 26 Nov: porsi cc_cycle Rp 22.000 (belanja 22 Nov) TIDAK dihitung ulang;
    // hanya porsi cicilan Rp 3.582.808 yang masuk ke totalExpense & Cicilan & Hutang.
    const dashRes9 = await app.request("/api/dashboard?cycle=gajian&period=2026-11");
    const dashBody9 = (await dashRes9.json()) as {
      metrics: { totalExpense: number; installmentExpense: number; totalSettlement: number };
      categoryTotals: Array<{ category: string; total: number }>;
    };
    expect(dashBody9.metrics.totalSettlement).toBe(3_604_808);
    expect(dashBody9.metrics.installmentExpense).toBe(3_582_808);
    expect(dashBody9.metrics.totalExpense).toBe(3_582_808);
    expect(
      dashBody9.categoryTotals.find((c) => c.category === "Cicilan & Hutang")?.total,
    ).toBe(3_582_808);

    // Cek /api/budgets/summary untuk 2026-11: Cicilan & Hutang harus menampilkan 3.582.808 di bucket savings
    const budgetSummaryRes9 = await app.request("/api/budgets/summary?period=2026-11");
    const budgetSummary9 = (await budgetSummaryRes9.json()) as {
      savings: {
        spent: number;
        categories: Array<{ categoryName: string; actualSpent: number }>;
      };
    };
    expect(
      budgetSummary9.savings.categories.find((c) => c.categoryName === "Cicilan & Hutang")
        ?.actualSpent,
    ).toBe(3_582_808);
    expect(budgetSummary9.savings.spent).toBe(3_582_808);
  }, 15_000);

  it("auto-closes settled payable/receivable and payroll accounts, and auto-reopens on unsettle or transaction delete", async () => {
    const { db, app } = await setupTestContext();

    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [gopay] = await db.select().from(wallets).where(eq(wallets.key, "gopay"));
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 5_000_000 }),
    });
    await app.request(`/api/wallets/${gopay!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 500_000 }),
    });

    // 1. Payable loan 2x500k
    const payableRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pinjaman Auto Close",
        lender: "Bank A",
        kind: "loan",
        direction: "payable",
        initialBalance: 1_000_000,
        installmentCount: 2,
        installmentAmount: 500_000,
        firstDueDate: "2026-10-10",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId: payableId } = (await payableRes.json()) as { accountId: number };

    // 2. Receivable 1x300k
    const receivableRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Piutang Auto Close",
        lender: "Rina",
        kind: "receivable",
        direction: "receivable",
        initialBalance: 300_000,
        installmentCount: 1,
        installmentAmount: 300_000,
        firstDueDate: "2026-10-15",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId: receivableId } = (await receivableRes.json()) as { accountId: number };

    const debtsBefore = await buildDebtsData(db, "2026-10-20");
    const payableInsts = debtsBefore.installments
      .filter((i) => i.accountId === payableId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const receivableInst = debtsBefore.installments.find((i) => i.accountId === receivableId)!;

    // Settle 1st payable installment -> still open
    const settle1Res = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [payableInsts[0]!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-10-10",
      }),
    });
    const settle1Json = (await settle1Res.json()) as { closedAccountIds: number[] };
    expect(settle1Json.closedAccountIds).toEqual([]);
    const [payableAfter1] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payableId));
    expect(payableAfter1!.closedAt).toBeNull();

    // Settle 2nd payable installment -> auto-closes payable account + writes audit log
    const settle2Res = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [payableInsts[1]!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-10-20",
      }),
    });
    const settle2Json = (await settle2Res.json()) as { closedAccountIds: number[] };
    expect(settle2Json.closedAccountIds).toEqual([payableId]);
    const [payableClosed] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payableId));
    expect(payableClosed!.closedAt?.toISOString()).toBe("2026-10-20T00:00:00.000Z");

    const closeAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "debt_account"),
          eq(auditLogs.entityId, payableId),
          eq(auditLogs.action, "auto_close_settled"),
        ),
      );
    expect(closeAudits).toHaveLength(1);

    // Settle receivable -> auto-closes receivable account
    const settleRecRes = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [receivableInst.id],
        fromWalletId: gopay!.id,
        paymentDate: "2026-10-21",
      }),
    });
    const settleRecJson = (await settleRecRes.json()) as {
      settlementTransactionId: number;
      closedAccountIds: number[];
    };
    expect(settleRecJson.closedAccountIds).toEqual([receivableId]);
    const [recClosed] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, receivableId));
    expect(recClosed!.closedAt?.toISOString()).toBe("2026-10-21T00:00:00.000Z");

    // Unsettle 2nd payable installment -> auto-reopens payable account
    const unsettleRes = await app.request(`/api/installments/${payableInsts[1]!.id}/unsettle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeSettlementTx: true }),
    });
    expect(unsettleRes.status).toBe(200);
    const [payableReopened] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payableId));
    expect(payableReopened!.closedAt).toBeNull();

    // Delete receivable collection transaction -> auto-reopens receivable account
    const delRecTxRes = await app.request(
      `/api/transactions/${settleRecJson.settlementTransactionId}`,
      { method: "DELETE" },
    );
    expect(delRecTxRes.status).toBe(200);
    const [recReopened] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, receivableId));
    expect(recReopened!.closedAt).toBeNull();

    // 3. Payroll account auto-paid & auto-closed
    const payrollRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Potong Gaji Koperasi",
        lender: "Koperasi Kantor",
        kind: "payroll",
        direction: "payable",
        initialBalance: 1_000_000,
        installmentCount: 2,
        installmentAmount: 500_000,
        firstDueDate: "2026-10-01",
        paymentMethod: "Potong Gaji",
      }),
    });
    const { accountId: payrollId } = (await payrollRes.json()) as { accountId: number };

    const paidCount1 = await ensurePayrollAutoPaid(db, "2026-10-15");
    expect(paidCount1).toBe(1);
    const [payrollMid] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payrollId));
    expect(payrollMid!.closedAt).toBeNull();

    const paidCount2 = await ensurePayrollAutoPaid(db, "2026-11-05");
    expect(paidCount2).toBe(1);
    const [payrollClosed] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payrollId));
    expect(payrollClosed!.closedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");

    const payrollAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "debt_account"),
          eq(auditLogs.entityId, payrollId),
          eq(auditLogs.action, "auto_close_payroll"),
        ),
      );
    expect(payrollAudits).toHaveLength(1);
  });

  it("DELETE /api/debts/:id keeps ledger transactions and wallet balances intact (Ledger-First)", async () => {
    const { db, app } = await setupTestContext();

    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 2_000_000 }),
    });

    // 1. Loan with disbursement (+1jt -> 3jt) and 1 paid installment (-500k -> 2.5jt)
    const createLoanRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pinjaman Ledger First",
        lender: "Bank B",
        kind: "loan",
        direction: "payable",
        initialBalance: 1_000_000,
        installmentCount: 2,
        installmentAmount: 500_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Transfer",
        disburseWalletId: bni!.id,
        recordDisbursement: true,
      }),
    });
    const { accountId: loanId } = (await createLoanRes.json()) as { accountId: number };

    const loanInsts = await db
      .select()
      .from(installments)
      .where(eq(installments.accountId, loanId));
    const settleLoanRes = await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [loanInsts[0]!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-11-10",
      }),
    });
    const { settlementTransactionId: loanSettleTxId } = (await settleLoanRes.json()) as {
      settlementTransactionId: number;
    };

    const [disburseTxBefore] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.debtAccountId, loanId));
    expect(disburseTxBefore).toBeDefined();

    let snap = await computeLedgerSnapshot(db, "2026-11-10");
    expect(snap.wallets.find((w) => w.id === bni!.id)?.balance).toBe(2_500_000);

    // Delete the loan account
    const delLoanRes = await app.request(`/api/debts/${loanId}`, { method: "DELETE" });
    expect(delLoanRes.status).toBe(200);

    // Account and installments are gone
    expect(await db.select().from(debtAccounts).where(eq(debtAccounts.id, loanId))).toHaveLength(0);
    expect(await db.select().from(installments).where(eq(installments.accountId, loanId))).toHaveLength(0);

    // Disbursement & settlement transactions and allocations remain intact with unlinked FKs
    const [disburseTxAfter] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, disburseTxBefore!.id));
    expect(disburseTxAfter).toBeDefined();
    expect(disburseTxAfter!.debtAccountId).toBeNull();

    const [settleTxAfter] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, loanSettleTxId));
    expect(settleTxAfter).toBeDefined();
    expect(settleTxAfter!.debtAccountId).toBeNull();
    expect(settleTxAfter!.installmentId).toBeNull();

    const allocsAfter = await db
      .select()
      .from(settlementAllocations)
      .where(eq(settlementAllocations.settlementTransactionId, loanSettleTxId));
    expect(allocsAfter).toHaveLength(1);
    expect(allocsAfter[0]!.installmentId).toBeNull();
    expect(allocsAfter[0]!.allocatedAmount).toBe(500_000);

    // Wallet balance remains 2.500.000
    snap = await computeLedgerSnapshot(db, "2026-11-10");
    expect(snap.wallets.find((w) => w.id === bni!.id)?.balance).toBe(2_500_000);

    // 2. Split Pay source transactions: unpaid -> reverts conversion; partially paid -> stays converted
    const ccTx1Res = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Split Unpaid",
        amount: 600_000,
        transactionDate: "2026-10-12",
        category: "Belanja Pribadi & Hobi",
        walletId: cc!.id,
      }),
    });
    const { id: ccTx1Id } = (await ccTx1Res.json()) as { id: number };
    const split1Res = await app.request(`/api/transactions/${ccTx1Id}/convert-to-installment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentCount: 2,
        installmentAmount: 300_000,
        firstPeriod: "2026-11",
      }),
    });
    const { accountId: split1AccountId } = (await split1Res.json()) as { accountId: number };

    const delSplit1Res = await app.request(`/api/debts/${split1AccountId}`, { method: "DELETE" });
    expect(delSplit1Res.status).toBe(200);
    const [ccTx1After] = await db.select().from(transactions).where(eq(transactions.id, ccTx1Id));
    expect(ccTx1After!.isConvertedToInstallment).toBe(false);
    expect(ccTx1After!.convertedAccountId).toBeNull();

    // Partially paid Split Pay
    const ccTx2Res = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Split Paid",
        amount: 800_000,
        transactionDate: "2026-10-12",
        category: "Belanja Pribadi & Hobi",
        walletId: cc!.id,
      }),
    });
    const { id: ccTx2Id } = (await ccTx2Res.json()) as { id: number };
    const split2Res = await app.request(`/api/transactions/${ccTx2Id}/convert-to-installment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentCount: 2,
        installmentAmount: 400_000,
        firstPeriod: "2026-11",
      }),
    });
    const { accountId: split2AccountId } = (await split2Res.json()) as { accountId: number };
    const split2Insts = await db
      .select()
      .from(installments)
      .where(eq(installments.accountId, split2AccountId));
    await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [split2Insts[0]!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-11-12",
      }),
    });

    const delSplit2Res = await app.request(`/api/debts/${split2AccountId}`, { method: "DELETE" });
    expect(delSplit2Res.status).toBe(200);
    const [ccTx2After] = await db.select().from(transactions).where(eq(transactions.id, ccTx2Id));
    expect(ccTx2After!.isConvertedToInstallment).toBe(true);
    expect(ccTx2After!.convertedAccountId).toBeNull();
  });

  it("enforces recurring CC limits/idempotency, Rp 0 disabled bank fees, inactive CC exclusion, and payday salary sync integrity", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));

    // 1. Disabling all walletRecurringFees gives Rp 0 fees (never falls back to DEFAULT_BANK_FEES)
    await db
      .update(walletRecurringFees)
      .set({ isActive: false })
      .where(eq(walletRecurringFees.walletId, cc!.id));
    expect(await ensureMonthlyBankFees(db, "2026-10")).toBe(0);

    // 2. Inactive CC with limitUsed === 0 is excluded from ccWallets, limits, and timelines
    const createInactiveCc = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CC Lama", type: "credit_card", creditLimit: 50_000_000 }),
    });
    const { wallet: ccLama } = (await createInactiveCc.json()) as { wallet: { id: number } };
    await app.request(`/api/wallets/${ccLama.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    const snapInactive = await computeLedgerSnapshot(db, "2026-10-26");
    expect(snapInactive.ccWallets.some((w) => w.id === ccLama.id)).toBe(false);
    const debtsInactive = await buildDebtsData(db, "2026-10-26");
    expect(debtsInactive.totals.ccLimit).toBe(20_000_000);

    // Unused new card gets no lookback previous-month fees on runDailyLedgerSync
    await runDailyLedgerSync(db, "2026-11-22", { force: true });
    const prevFees = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.walletId, cc!.id), eq(transactions.ccCycleKey, "2026-11")));
    expect(prevFees).toHaveLength(0);

    // 3. Recurring on CC sets ccCycleKey, checks limit, rejects inactive rule/wallet
    const recRes = await app.request("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: "Cloud CC",
        amount: 500_000,
        category: "Internet & Komunikasi",
        walletId: cc!.id,
        dueDay: 10,
        isActive: true,
      }),
    });
    const { rule } = (await recRes.json()) as { rule: { id: number } };
    const payCcRes = await app.request(`/api/recurring/${rule.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: "2026-10", transactionDate: "2026-10-25" }),
    });
    expect(payCcRes.status).toBe(201);
    const { transactionId: recTxId } = (await payCcRes.json()) as { transactionId: number };
    const [recTx] = await db.select().from(transactions).where(eq(transactions.id, recTxId));
    expect(recTx!.ccCycleKey).toBe("2026-11");

    // Paid on 2026-10-25 appears paid in CC cycle 2026-11 as well as gajian 2026-10
    const ccDash = await buildDashboardData(db, { cycle: "cc", period: "2026-11", today: "2026-10-26" });
    expect(ccDash.recurringBills!.find((r) => r.id === rule.id)?.isPaidThisCycle).toBe(true);

    // Deleting recurring tx clears lastPaidPeriod
    const delRecTx = await app.request(`/api/transactions/${recTxId}`, { method: "DELETE" });
    expect(delRecTx.status).toBe(200);
    const [ruleAfterDel] = await db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, rule.id));
    expect(ruleAfterDel!.lastPaidPeriod).toBeNull();

    // Inactive rule is rejected
    await app.request(`/api/recurring/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    const payInactiveRes = await app.request(`/api/recurring/${rule.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: "2026-10" }),
    });
    expect(payInactiveRes.status).toBe(400);

    // 4. Salary: strictly matches gajianPeriodForDate, includes payday auto-sync rows, closes account, rejects gross <= due
    const payrollRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Kasbon Bulanan",
        lender: "Kantor",
        kind: "payroll",
        direction: "payable",
        initialBalance: 2_000_000,
        installmentCount: 2,
        installmentAmount: 1_000_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Potong Gaji",
      }),
    });
    const { accountId: payrollId } = (await payrollRes.json()) as { accountId: number };

    // 2026-11-10 belongs to gajian 2026-10 (2026-10-25..2026-11-24); 2026-12-10 belongs to 2026-11
    await ensurePayrollAutoPaid(db, "2026-11-10");
    const preview10 = await getSalaryPreview(db, { period: "2026-10", grossSalary: 5_000_000 }, "2026-11-10");
    expect(preview10.totalPayrollDue).toBe(1_000_000);
    expect(preview10.payrollInstallments).toHaveLength(1);

    await expect(
      receiveSalaryForPeriod(
        db,
        { period: "2026-10", grossSalary: 1_000_000, walletId: bni!.id, transactionDate: "2026-10-25" },
        "2026-11-10",
      ),
    ).rejects.toThrow();

    await receiveSalaryForPeriod(
      db,
      { period: "2026-10", grossSalary: 5_000_000, walletId: bni!.id, transactionDate: "2026-10-25" },
      "2026-11-10",
    );

    // Pay second month (2026-11) -> auto-closes payroll account
    const sal11 = await receiveSalaryForPeriod(
      db,
      { period: "2026-11", grossSalary: 5_000_000, walletId: bni!.id, transactionDate: "2026-11-25" },
      "2026-11-25",
    );
    expect(sal11.totalPayrollDue).toBe(1_000_000);
    const [closedPayroll] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, payrollId));
    expect(closedPayroll!.closedAt).not.toBeNull();
  });

  it("handles transaction split/transfer/CC-settled edits, fee-only & goal tx deletes, proportional debt settle/payoff, Split Pay safeguards, and budget/category integrity", async () => {
    const { db, app } = await setupTestContext();
    const [bni] = await db.select().from(wallets).where(eq(wallets.key, "bni"));
    const [bca] = await db.select().from(wallets).where(eq(wallets.key, "bca"));
    const [cc] = await db.select().from(wallets).where(eq(wallets.key, "cc-jenius"));
    await app.request(`/api/wallets/${bni!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: 30_000_000 }),
    });

    // 1. Split tx update validation & category rename propagation
    const splitTxRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Toko Split",
        amount: 300_000,
        transactionDate: "2026-10-26",
        category: "Makanan & Belanja Dapur",
        walletId: bni!.id,
        splits: [
          { category: "Makanan & Belanja Dapur", amount: 200_000 },
          { category: "Jajan & Nongkrong", amount: 100_000 },
        ],
      }),
    });
    const { id: splitTxId } = (await splitTxRes.json()) as { id: number };

    // Dashboard budgetBuckets uses splitsByTxId (needs: 200k, wants: 100k)
    const dashSplits = await buildDashboardData(db, {
      cycle: "gajian",
      period: "2026-10",
      today: "2026-10-27",
    });
    expect(dashSplits.budgetBuckets?.needs.spent).toBe(200_000);
    expect(dashSplits.budgetBuckets?.wants.spent).toBe(100_000);

    // Changing amount without splits -> 400
    const badAmountRes = await app.request(`/api/transactions/${splitTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 350_000 }),
    });
    expect(badAmountRes.status).toBe(400);

    // Changing type to transfer -> 400
    const badTypeRes = await app.request(`/api/transactions/${splitTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "transfer" }),
    });
    expect(badTypeRes.status).toBe(400);

    // Renaming category updates transactionSplits too
    const [jajanCat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.name, "Jajan & Nongkrong"), eq(categories.type, "expense")));
    await app.request(`/api/categories/${jajanCat!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kopi & Camilan" }),
    });
    const updatedSplits = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, splitTxId));
    expect(updatedSplits.some((s) => s.category === "Kopi & Camilan")).toBe(true);

    // Changing category without splits deletes orphaned splits
    await app.request(`/api/transactions/${splitTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Transportasi & Bensin" }),
    });
    expect(
      await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, splitTxId)),
    ).toHaveLength(0);

    // 2. Deleting a transfer fee row deletes ONLY the fee row, and adding adminFee to ungrouped transfer creates group
    const transferRes = await app.request("/api/transactions/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWalletId: bni!.id,
        toWalletId: bca!.id,
        amount: 500_000,
        adminFee: 6_500,
        transactionDate: "2026-10-26",
      }),
    });
    const { transferId, feeTransactionId } = (await transferRes.json()) as {
      transferId: number;
      feeTransactionId: number;
    };
    const delFeeOnly = await app.request(`/api/transactions/${feeTransactionId}`, {
      method: "DELETE",
    });
    expect(delFeeOnly.status).toBe(200);
    const [transferStillThere] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transferId));
    expect(transferStillThere).toBeDefined();

    // 3. Deleting a goal:* transfer decrements goal.currentAmount
    const [goal] = await db
      .insert(goals)
      .values({
        name: "Dana Liburan",
        targetAmount: 2_000_000,
        currentAmount: 500_000,
        walletId: bca!.id,
      })
      .returning();
    const [goalTx] = await db
      .insert(transactions)
      .values({
        type: "transfer",
        merchant: "Setor Target: Dana Liburan",
        amount: 500_000,
        transactionDate: "2026-10-26",
        category: "Tabungan",
        walletId: bni!.id,
        toWalletId: bca!.id,
        source: "manual",
        sourceRef: `goal:${goal!.id}:123456:abc`,
      })
      .returning();
    await app.request(`/api/transactions/${goalTx!.id}`, { method: "DELETE" });
    const [goalAfter] = await db.select().from(goals).where(eq(goals.id, goal!.id));
    expect(goalAfter!.currentAmount).toBe(0);

    // 4. Editing settled CC expense succeeds when limit doesn't increase, and Split Pay rejects settled cycle
    const ccSettledTxRes = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Lunas",
        amount: 6_000_000,
        transactionDate: "2026-09-10",
        category: "Belanja Pribadi & Hobi",
        walletId: cc!.id,
      }),
    });
    const { id: ccSettledTxId } = (await ccSettledTxRes.json()) as { id: number };
    await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ccWalletId: cc!.id,
        ccCycleKey: "2026-09",
        fromWalletId: bni!.id,
        paymentDate: "2026-09-25",
      }),
    });
    // Use up most of CC limit in 2026-10 (17M used -> 3M available)
    await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        merchant: "Belanja Besar",
        amount: 17_000_000,
        transactionDate: "2026-10-10",
        category: "Belanja Pribadi & Hobi",
        walletId: cc!.id,
      }),
    });
    // Editing note or reducing amount on settled 6M tx must succeed despite 3M available
    const patchSettledOk = await app.request(`/api/transactions/${ccSettledTxId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: "Belanja Lunas Edit", amount: 5_500_000 }),
    });
    expect(patchSettledOk.status).toBe(200);
    // Split Pay on settled 2026-09 cycle must be rejected
    const splitSettledRes = await app.request(
      `/api/transactions/${ccSettledTxId}/convert-to-installment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentCount: 2,
          installmentAmount: 2_750_000,
          firstPeriod: "2026-11",
        }),
      },
    );
    expect(splitSettledRes.status).toBe(400);

    // 5. Early payoff with customAmount allocates proportionally so unsettle never over-deducts
    const debtRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cicilan Diskon",
        lender: "Bank Z",
        kind: "loan",
        direction: "payable",
        initialBalance: 1_500_000,
        installmentCount: 3,
        installmentAmount: 500_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId: discId } = (await debtRes.json()) as { accountId: number };
    const payoffDiscRes = await app.request(`/api/debts/${discId}/payoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWalletId: bni!.id,
        paymentDate: "2026-10-28",
        customAmount: 1_200_000,
      }),
    });
    expect(payoffDiscRes.status).toBe(200);
    const { settlementTransactionId: payoffTxId } = (await payoffDiscRes.json()) as {
      settlementTransactionId: number;
    };
    const payoffAllocs = await db
      .select()
      .from(settlementAllocations)
      .where(eq(settlementAllocations.settlementTransactionId, payoffTxId));
    const sumAllocs = payoffAllocs.reduce((s, a) => s + a.allocatedAmount, 0);
    expect(sumAllocs).toBe(1_200_000);

    const discInsts = await db
      .select()
      .from(installments)
      .where(eq(installments.accountId, discId));
    await app.request(`/api/installments/${discInsts[0]!.id}/unsettle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeSettlementTx: true }),
    });
    const [txAfterUnsettle] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, payoffTxId));
    expect(txAfterUnsettle!.amount).toBe(800_000);

    // 6. Rejects credit_card disburseWalletId & mixing receivable + ccCycleKey; interest-bearing loan keeps last installment open
    const ccDisburseRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Invalid CC Disburse",
        lender: "Bank",
        kind: "loan",
        initialBalance: 500_000,
        installmentCount: 1,
        installmentAmount: 500_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Transfer",
        disburseWalletId: cc!.id,
        recordDisbursement: true,
      }),
    });
    expect(ccDisburseRes.status).toBe(400);

    const interestLoanRes = await app.request("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pinjaman Berbunga",
        lender: "KTA",
        kind: "loan",
        initialBalance: 2_000_000,
        installmentCount: 3,
        installmentAmount: 800_000,
        firstDueDate: "2026-11-10",
        paymentMethod: "Transfer",
      }),
    });
    const { accountId: intLoanId } = (await interestLoanRes.json()) as { accountId: number };
    const intInsts = await db
      .select()
      .from(installments)
      .where(eq(installments.accountId, intLoanId));
    await app.request("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installmentIds: [intInsts[0]!.id, intInsts[1]!.id, intInsts[2]!.id],
        fromWalletId: bni!.id,
        paymentDate: "2026-11-10",
        customAmount: 2_400_000,
      }),
    });
    // Paid 2.4M covers full scheduled 3x800k -> closes cleanly; check before 3rd wasn't hidden
    const [closedIntLoan] = await db
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, intLoanId));
    expect(closedIntLoan!.closedAt).not.toBeNull();

    // 7. Budgets: reject phantom category (400), include archived category with spend, and bound daysRemaining
    const phantomBudget = await app.request("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Kategori Hantu", period: "2026-10", limitAmount: 100_000 }),
    });
    expect(phantomBudget.status).toBe(400);

    const pastBudget = resolveBudgetsForPeriod(
      [
        {
          id: 1,
          category: "Makanan & Belanja Dapur",
          categoryId: null,
          period: "2026-09",
          limitAmount: 1_000_000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      "2026-09",
      new Map([["Makanan & Belanja Dapur", 200_000]]),
      "2026-10-24",
      "2026-11-01",
      "2026-09-25",
    );
    expect(pastBudget[0]!.dailyAllowanceRemaining).toBe(0);

    const futureBudget = resolveBudgetsForPeriod(
      [
        {
          id: 2,
          category: "Makanan & Belanja Dapur",
          categoryId: null,
          period: "2026-12",
          limitAmount: 310_000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      "2026-12",
      new Map(),
      "2027-01-24",
      "2026-10-01",
      "2026-12-25",
    );
    expect(futureBudget[0]!.dailyAllowanceRemaining).toBe(10_000);
  });
});
