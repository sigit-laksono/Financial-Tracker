import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { installments, wallets } from "../db/schema";
import { buildDashboardData, buildDebtsData, generateCycleTimeline } from "../lib/dashboardQuery";
import { computeLedgerSnapshot } from "../lib/ledgerSnapshot";
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
        category: "Belanja",
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
        category: "Belanja",
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
        category: "Makanan & Minuman",
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
});
