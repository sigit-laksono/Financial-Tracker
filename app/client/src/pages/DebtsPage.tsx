import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DebtDirection } from "../../../shared/src/types";
import { BankBadge } from "../components/BankBadge";
import { HelpTooltip } from "../components/HelpTooltip";
import {
  AlertIcon,
  CardDebtIcon,
  CheckIcon,
  ClockIcon,
  LightbulbIcon,
  PlusIcon,
  SplitPayIcon,
  TrashIcon,
} from "../components/Icons";
import type { SplitPayTarget } from "../components/SplitPayModal";
import { Badge, Button, Card, ModalSheet, ProgressBar, StateView } from "../components/UI";
import { api, ApiError, type DebtAccountDto, type DebtsDto } from "../lib/api";
import {
  formatCompactRupiah,
  formatDigitsInput,
  formatMonthTitle,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  parsePositiveInt,
} from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";

export function DebtsPage({
  data,
  onOpenAddDebt,
  onPayInstallment,
  onPayCcCycle,
  onOpenSplitPay,
  onToast,
}: {
  data: DebtsDto;
  onOpenAddDebt: () => void;
  onPayInstallment: (installmentId: number) => void;
  onPayCcCycle: (cycleKey: string, installmentIds: number[], ccWalletId?: number) => void;
  onOpenSplitPay: (target: SplitPayTarget) => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();

  const [activeTab, setActiveTab] = useState<"payable" | "receivable" | "cards" | "all">("payable");
  const [showClosed, setShowClosed] = useState(false);

  // Multi-CC selection
  const cards = data.cards ?? [];
  const [selectedCardId, setSelectedCardId] = useState<number>(() => {
    return cards[0]?.walletId ?? 0;
  });

  const activeCard = useMemo(() => {
    return cards.find((c) => c.walletId === selectedCardId) ?? cards[0] ?? null;
  }, [cards, selectedCardId]);

  const activeCardWallet = useMemo(() => {
    return data.wallets.find((w) => w.id === activeCard?.walletId) ?? null;
  }, [data.wallets, activeCard]);

  const [selectedCycle, setSelectedCycle] = useState<string>(() => {
    return activeCard?.cycleSummaries[0]?.cycleKey ?? data.currentCcCycle;
  });

  // Early Payoff Modal State
  const [payoffTarget, setPayoffTarget] = useState<{
    id: number;
    name: string;
    lender: string;
    direction: DebtDirection;
    remaining: number;
    interestRateBps?: number | null;
  } | null>(null);

  const [payoffWalletId, setPayoffWalletId] = useState<number>(() => {
    const liquid = data.wallets.filter((w) => w.isActive && w.type !== "credit_card");
    return liquid[0]?.id ?? 0;
  });
  const [payoffDate, setPayoffDate] = useState<string>(jakartaToday);
  const [payoffAmountInput, setPayoffAmountInput] = useState<string>("");
  const [payoffError, setPayoffError] = useState<string>("");

  const liquidWallets = useMemo(
    () => data.wallets.filter((w) => w.isActive && w.type !== "credit_card"),
    [data.wallets],
  );

  const selectedPayoffWallet = useMemo(() => {
    return liquidWallets.find((w) => w.id === payoffWalletId) ?? liquidWallets[0] ?? null;
  }, [liquidWallets, payoffWalletId]);

  const [deletingAccount, setDeletingAccount] = useState<DebtAccountDto | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteDebt(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      onToast("Akun utang/piutang berhasil dihapus");
      setDeletingAccount(null);
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus akun.");
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, closed }: { id: number; closed: boolean }) => api.closeDebt(id, closed),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      onToast(vars.closed ? "Akun utang/piutang ditutup" : "Akun dibuka kembali");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal mengubah status akun.");
    },
  });

  const unsettleMutation = useMutation({
    mutationFn: (id: number) => api.unsettleInstallment(id, true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      onToast("Status lunas cicilan dibatalkan");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal membatalkan status lunas.");
    },
  });

  const payoffMutation = useMutation({
    mutationFn: async () => {
      if (!payoffTarget) return;
      const customAmt = parsePositiveInt(payoffAmountInput);
      const effectiveAmt = customAmt > 0 ? customAmt : payoffTarget.remaining;
      if (
        payoffTarget.direction !== "receivable" &&
        selectedPayoffWallet &&
        selectedPayoffWallet.balance < effectiveAmt
      ) {
        throw new Error(
          `Saldo dompet ${selectedPayoffWallet.name} tidak mencukupi untuk pelunasan.`,
        );
      }
      return api.earlyPayoff(payoffTarget.id, {
        fromWalletId: payoffWalletId,
        paymentDate: payoffDate,
        customAmount: customAmt > 0 ? customAmt : undefined,
        preventOverdraft: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onToast("Pelunasan berhasil dicatat dan akun ditutup.");
      setPayoffTarget(null);
    },
    onError: (err) => {
      setPayoffError(err instanceof ApiError ? err.message : "Gagal melakukan pelunasan.");
    },
  });

  const openPayoffModal = (account: {
    id: number;
    name: string;
    lender: string;
    direction: DebtDirection;
    remainingBalance: number;
    interestRateBps?: number | null;
  }) => {
    setPayoffTarget({
      id: account.id,
      name: account.name,
      lender: account.lender,
      direction: account.direction,
      remaining: account.remainingBalance,
      interestRateBps: account.interestRateBps,
    });
    setPayoffWalletId(liquidWallets[0]?.id ?? 0);
    setPayoffDate(jakartaToday());
    setPayoffAmountInput(String(account.remainingBalance));
    setPayoffError("");
  };

  const activeCycle =
    activeCard?.cycleSummaries.find((c) => c.cycleKey === selectedCycle) ??
    activeCard?.cycleSummaries[0] ??
    data.cycleSummaries[0] ??
    null;

  const cycleTransactions = useMemo(() => {
    if (!activeCard) return [];
    return data.ccTransactions.filter(
      (t) => t.walletId === activeCard.walletId && t.ccCycleKey === activeCycle?.cycleKey,
    );
  }, [data.ccTransactions, activeCard, activeCycle]);

  // Tab filtering for accounts
  const filteredAccounts = useMemo(() => {
    let list = data.accounts;
    if (activeTab === "payable") list = list.filter((a) => a.direction !== "receivable");
    else if (activeTab === "receivable") list = list.filter((a) => a.direction === "receivable");
    return list;
  }, [data.accounts, activeTab]);

  const activeAccounts = filteredAccounts.filter((a) => !a.closed);
  const closedAccounts = filteredAccounts.filter((a) => a.closed);

  const totalKewajiban = (data.totals.remainingDebt ?? 0) + (data.totals.ccLimitUsed ?? 0);
  const hasDebt = totalKewajiban > 0;

  const activeCardLimit = activeCard?.creditLimit ?? data.totals.ccLimit;
  const activeCardUsed = activeCard?.limitUsed ?? data.totals.ccLimitUsed;
  const activeCardAvailable = activeCard?.balance ?? data.totals.ccLimitAvailable;
  const ccPercent = activeCardLimit ? Math.round((activeCardUsed / activeCardLimit) * 100) : 0;

  // Monthly Debt Burden (planned upcoming installments this month)
  const monthlyDebtBurden = useMemo(() => {
    const today = jakartaToday();
    const currentYearMonth = today.slice(0, 7);
    return data.installments
      .filter(
        (i) =>
          !i.accountClosed &&
          i.direction !== "receivable" &&
          i.status === "upcoming" &&
          (i.period === currentYearMonth || i.dueDate.slice(0, 7) === currentYearMonth),
      )
      .reduce((sum, i) => sum + i.plannedAmount, 0);
  }, [data.installments]);

  // Monthly Receivable Target
  const monthlyReceivableTarget = useMemo(() => {
    const today = jakartaToday();
    const currentYearMonth = today.slice(0, 7);
    return data.installments
      .filter(
        (i) =>
          !i.accountClosed &&
          i.direction === "receivable" &&
          i.status === "upcoming" &&
          (i.period === currentYearMonth || i.dueDate.slice(0, 7) === currentYearMonth),
      )
      .reduce((sum, i) => sum + i.plannedAmount, 0);
  }, [data.installments]);

  const groupedSchedule = useMemo(() => {
    const map = new Map<string, typeof data.installments>();
    for (const item of data.installments) {
      if (item.accountClosed) continue;
      if (activeTab === "payable" && item.direction === "receivable") continue;
      if (activeTab === "receivable" && item.direction !== "receivable") continue;
      const list = map.get(item.period) ?? [];
      list.push(item);
      map.set(item.period, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.installments, activeTab]);

  // Counts for tabs
  const payableCount = data.accounts.filter(
    (a) => !a.closed && a.direction !== "receivable",
  ).length;
  const receivableCount = data.accounts.filter(
    (a) => !a.closed && a.direction === "receivable",
  ).length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Hutang, Piutang & CC</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Manajemen kewajiban utang, piutang talangan, kartu kredit, dan proteksi jadwal arus kas.
          </p>
        </div>
        <Button onClick={onOpenAddDebt} className="gap-2">
          <PlusIcon className="w-4 h-4" />
          <span>Tambah Utang / Piutang</span>
        </Button>
      </div>

      {/* Debts Summary Hero Card */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <CardDebtIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Kewajiban Utang</span>
            </div>
            <div className="flex items-baseline gap-2">
              <h2 className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(totalKewajiban, isMasked)}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[var(--hero-card-muted)] max-w-md">
              {hasDebt
                ? "Total sisa pokok pinjaman dan pemakaian kartu kredit aktif saat ini."
                : "Semua pinjaman dan kewajiban kartu kredit sudah lunas."}
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2.5">
            <div className="rounded-[16px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-4 text-left sm:text-right max-w-sm">
              <div className="flex items-center justify-between sm:justify-end gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-[var(--hero-card-muted)] uppercase tracking-wider">
                  Status Utang
                </span>
                <Badge tone={hasDebt ? "highlight" : "soft"} className="text-xs font-bold">
                  {hasDebt ? "Ada Kewajiban" : "Bebas Utang"}
                </Badge>
              </div>
              <p className="text-xs text-[var(--hero-card-muted)] leading-relaxed">
                {hasDebt
                  ? "Fokus selesaikan utang terdekat dan jaga arus kas tetap aman."
                  : "Kondisi arus kas sehat, tidak ada tagihan utang tertunggak."}
              </p>
            </div>
          </div>
        </div>

        {/* 4 Pillar Grid Metric Cards inside/below Hero */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-[var(--hero-border)] pt-5 sm:grid-cols-4">
          <div className="rounded-[14px] bg-[var(--hero-surface)] p-3.5 border border-[var(--hero-inner-border)]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--hero-card-muted)]">
              1. Sisa Utang Saya
            </span>
            <p className="font-mono text-lg font-bold text-[var(--hero-card-foreground)] tabular-nums mt-1">
              {formatRupiah(data.totals.remainingDebt, isMasked)}
            </p>
            <p className="text-[11px] text-[var(--hero-card-muted)] tabular-nums">
              Terbayar {formatCompactRupiah(data.totals.paidDebt, isMasked)}
            </p>
          </div>

          <div className="rounded-[14px] bg-[var(--hero-surface)] p-3.5 border border-[var(--hero-inner-border)]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--hero-card-muted)]">
              2. Sisa Piutang Teman
            </span>
            <p className="font-mono text-lg font-bold text-[var(--chart-income)] tabular-nums mt-1">
              {formatRupiah(data.totals.remainingReceivable, isMasked)}
            </p>
            <p className="text-[11px] text-[var(--hero-card-muted)] tabular-nums">
              Tertagih {formatCompactRupiah(data.totals.paidReceivable, isMasked)}
            </p>
          </div>

          <div className="rounded-[14px] bg-[var(--hero-surface)] p-3.5 border border-[var(--hero-inner-border)]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--hero-card-muted)]">
              3. Beban Bulan Ini
            </span>
            <p className="font-mono text-lg font-bold text-[var(--highlight-text)] tabular-nums mt-1">
              {formatRupiah(monthlyDebtBurden, isMasked)}
            </p>
            <p className="text-[11px] text-[var(--hero-card-muted)] tabular-nums">
              Target tagih {formatCompactRupiah(monthlyReceivableTarget, isMasked)}
            </p>
          </div>

          <div className="rounded-[14px] bg-[var(--hero-surface)] p-3.5 border border-[var(--hero-inner-border)]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--hero-card-muted)]">
              4. Limit CC Terpakai
            </span>
            <p className="font-mono text-lg font-bold text-[var(--destructive)] tabular-nums mt-1">
              {formatRupiah(data.totals.ccLimitUsed, isMasked)}
            </p>
            <p className="text-[11px] text-[var(--hero-card-muted)] tabular-nums">
              Sisa {formatCompactRupiah(data.totals.ccLimitAvailable, isMasked)}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-sm">
        <button
          type="button"
          onClick={() => setActiveTab("payable")}
          className={`min-h-[42px] rounded-[12px] px-4 font-bold transition-all ${
            activeTab === "payable"
              ? "bg-[var(--hero)] text-white shadow-sm"
              : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          }`}
        >
          Utang Saya ({payableCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("receivable")}
          className={`min-h-[42px] rounded-[12px] px-4 font-bold transition-all ${
            activeTab === "receivable"
              ? "bg-[var(--hero)] text-white shadow-sm"
              : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          }`}
        >
          Piutang Teman ({receivableCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("cards")}
          className={`min-h-[42px] rounded-[12px] px-4 font-bold transition-all ${
            activeTab === "cards"
              ? "bg-[var(--hero)] text-white shadow-sm"
              : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          }`}
        >
          Kartu Kredit ({cards.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`min-h-[42px] rounded-[12px] px-4 font-bold transition-all ${
            activeTab === "all"
              ? "bg-[var(--hero)] text-white shadow-sm"
              : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          }`}
        >
          Semua Portofolio
        </button>
      </div>

      {/* TAB 1: KARTU KREDIT (Shown when activeTab === 'cards' or activeTab === 'all') */}
      {(activeTab === "cards" || activeTab === "all") && (
        <div className="space-y-4">
          {cards.length === 0 ? (
            <Card className="p-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--muted-foreground)]">
                <CardDebtIcon className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)]">
                Belum Ada Kartu Kredit
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] max-w-md mx-auto">
                Tambahkan dompet bertipe Kartu Kredit di menu Dompet untuk melacak limit, siklus
                cetak tagihan, dan jatuh tempo bebas bunga.
              </p>
            </Card>
          ) : (
            <Card className="space-y-5 p-6 rounded-[20px]">
              {/* Multi-CC Card Switcher Tabs */}
              {cards.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                    Pilih Kartu:
                  </span>
                  {cards.map((c) => (
                    <button
                      key={c.walletId}
                      type="button"
                      onClick={() => {
                        setSelectedCardId(c.walletId);
                        setSelectedCycle(c.cycleSummaries[0]?.cycleKey ?? data.currentCcCycle);
                      }}
                      className={`min-h-[36px] rounded-[10px] px-3.5 text-xs font-bold transition-colors ${
                        activeCard?.walletId === c.walletId
                          ? "bg-[var(--hero)] text-white shadow-xs"
                          : "border border-[var(--control-border)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      {c.walletName}
                    </button>
                  ))}
                </div>
              )}

              {/* Virtual Credit Card Container */}
              <div className="relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--card)] p-5 sm:p-6 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <BankBadge
                        provider={activeCardWallet?.provider ?? "other"}
                        name={activeCard?.walletName}
                      />
                      <h2 className="text-lg font-extrabold text-[var(--foreground)]">
                        {activeCard?.walletName ?? "Kartu Kredit"}
                      </h2>
                    </div>
                    <div className="flex items-baseline gap-2 pt-2">
                      <span className="font-mono text-2xl sm:text-3xl font-black text-[var(--foreground)] tabular-nums">
                        {formatRupiah(activeCardUsed, isMasked)}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        terpakai dari {formatCompactRupiah(activeCardLimit, isMasked)}
                      </span>
                    </div>
                  </div>

                  {/* Limit Usage Pill Badge */}
                  <Badge
                    tone={ccPercent >= 80 ? "highlight" : ccPercent >= 50 ? "neutral" : "soft"}
                    className="text-xs font-bold"
                  >
                    {ccPercent}% Terpakai · Sisa{" "}
                    {formatCompactRupiah(activeCardAvailable, isMasked)}
                  </Badge>
                </div>

                {/* Limit Progress Bar */}
                <div className="mt-4">
                  <ProgressBar
                    value={ccPercent}
                    tone={ccPercent >= 80 ? "highlight" : "primary"}
                    label={`Pemakaian limit ${activeCard?.walletName ?? "CC"}`}
                  />
                </div>

                {/* Card Dates & Cashflow Protection Status */}
                <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
                  <div className="rounded-[10px] bg-[var(--surface)] p-2.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
                      Tutup Buku (Cut-off)
                    </span>
                    <p className="font-mono text-sm font-bold text-[var(--foreground)] mt-0.5">
                      Tgl {activeCard?.cutoffDay ?? 20} tiap bulan
                    </p>
                  </div>

                  <div className="rounded-[10px] bg-[var(--surface)] p-2.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
                      Cetak Tagihan (Statement)
                    </span>
                    <p className="font-mono text-sm font-bold text-[var(--foreground)] mt-0.5">
                      Tgl {activeCard?.statementDay ?? 21} tiap bulan
                    </p>
                  </div>

                  <div className="rounded-[10px] bg-[var(--surface)] p-2.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
                      Jatuh Tempo (Due Date)
                    </span>
                    <p className="font-mono text-sm font-bold text-amber-500 mt-0.5">
                      Tgl {activeCard?.paymentDay ?? 10} tiap bulan
                    </p>
                  </div>
                </div>
              </div>

              {/* Cycle Selector & Payment Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="cc-cycle-select"
                    className="text-sm font-semibold flex items-center gap-1.5"
                  >
                    Siklus Tagihan
                    <HelpTooltip
                      title="Siklus Tagihan Kartu Kredit"
                      content="Masa pencatatan transaksi dari tanggal tutup buku bulan lalu hingga tutup buku bulan ini. Transaksi baru setelah tutup buku masuk ke tagihan bulan berikutnya (bebas bunga)."
                    />
                    :
                  </label>
                  <select
                    id="cc-cycle-select"
                    value={activeCycle?.cycleKey ?? ""}
                    onChange={(e) => setSelectedCycle(e.target.value)}
                    className="tabular-nums min-h-[42px] rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--foreground)]"
                  >
                    {(activeCard?.cycleSummaries ?? data.cycleSummaries).map((c) => (
                      <option key={c.cycleKey} value={c.cycleKey}>
                        {formatMonthTitle(c.cycleKey)} ({formatRupiah(c.totalBill, isMasked)})
                      </option>
                    ))}
                  </select>
                </div>

                {activeCycle && !activeCycle.settled && activeCycle.totalBill > 0 && (
                  <Button
                    onClick={() =>
                      onPayCcCycle(
                        activeCycle.cycleKey,
                        activeCycle.unpaidInstallmentIds,
                        activeCard?.walletId,
                      )
                    }
                    className="gap-2"
                  >
                    <CheckIcon className="w-4 h-4" />
                    <span>Bayar Tagihan ({formatRupiah(activeCycle.totalBill, isMasked)})</span>
                  </Button>
                )}
                {activeCycle?.settled && (
                  <Badge tone="soft" className="gap-1.5 py-1 px-3">
                    <CheckIcon className="w-3.5 h-3.5" />
                    <span>Tagihan Siklus Ini Lunas</span>
                  </Badge>
                )}
              </div>

              {/* Breakdown 3 Komponen Tagihan Siklus */}
              {activeCycle && (
                <div className="grid grid-cols-1 gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Belanja Harian + Biaya Bank
                    </p>
                    <p className="tabular-nums font-mono mt-0.5 text-base font-bold text-[var(--foreground)]">
                      {formatRupiah(activeCycle.dailyTotal, isMasked)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Cicilan Bulanan</p>
                    <p className="tabular-nums font-mono mt-0.5 text-base font-bold text-[var(--foreground)]">
                      {formatRupiah(activeCycle.installmentTotal, isMasked)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
                      Total Tagihan Siklus
                      <HelpTooltip
                        title="Fasilitas Bebas Bunga"
                        content="Bayar lunas total tagihan sebelum tanggal jatuh tempo untuk menikmati 100% bebas bunga dari bank penerbit."
                      />
                    </p>
                    <p className="tabular-nums font-mono mt-0.5 text-base font-extrabold text-[var(--primary)]">
                      {formatRupiah(activeCycle.totalBill, isMasked)}
                    </p>
                  </div>
                </div>
              )}

              {/* CC Transactions in Cycle */}
              <div className="space-y-2 pt-2">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  Transaksi {activeCard?.walletName ?? "CC"} ({cycleTransactions.length})
                </h3>
                {cycleTransactions.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] py-2">
                    Belum ada transaksi kartu kredit yang dicatat pada siklus ini.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] overflow-hidden">
                    {cycleTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--surface)] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--foreground)]">
                              {tx.merchant}
                            </span>
                            {tx.isConvertedToInstallment && (
                              <Badge tone="soft">Sudah Jadi Cicilan</Badge>
                            )}
                          </div>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {formatShortDate(tx.transactionDate)} · {tx.category}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="tabular-nums font-mono text-sm font-bold">
                            {formatRupiah(tx.amount, isMasked)}
                          </span>
                          {!tx.isConvertedToInstallment && tx.category !== "Biaya Bank" && (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenSplitPay({
                                  id: tx.id,
                                  merchant: tx.merchant,
                                  amount: tx.amount,
                                  transactionDate: tx.transactionDate,
                                })
                              }
                              aria-label={`Ubah ${tx.merchant} menjadi cicilan bulanan`}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-[10px] border border-[var(--control-border)] px-3 text-xs font-semibold hover:bg-[var(--surface)] transition-colors"
                            >
                              <SplitPayIcon className="w-3.5 h-3.5" />
                              <span>Ubah Jadi Cicilan</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 2 & 3: UTANG SAYA & PIUTANG TEMAN (Shown when activeTab !== 'cards') */}
      {activeTab !== "cards" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              {activeTab === "receivable"
                ? `Daftar Piutang Aktif (${activeAccounts.length})`
                : activeTab === "payable"
                  ? `Daftar Utang & Pinjaman Aktif (${activeAccounts.length})`
                  : `Akun Utang & Piutang Aktif (${activeAccounts.length})`}
            </h2>
          </div>

          {activeAccounts.length === 0 ? (
            <StateView
              kind="empty"
              icon={<CardDebtIcon className="w-6 h-6" />}
              title={
                activeTab === "receivable"
                  ? "Tidak Ada Piutang Aktif"
                  : "Tidak Ada Utang / Cicilan Aktif"
              }
              description={
                activeTab === "receivable"
                  ? "Semua pinjaman atau talangan teman sudah lunas, atau Anda belum pernah mencatat piutang."
                  : "Bagus sekali! Semua pinjaman dan cicilan manual Anda sudah lunas tanpa tunggakan."
              }
              actionLabel={
                activeTab === "receivable"
                  ? "Catat Piutang / Talangan"
                  : "Catat Utang / Kartu Kredit"
              }
              onAction={onOpenAddDebt}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {activeAccounts.map((acc) => {
                const pct = acc.initialBalance
                  ? Math.round((acc.paidAmount / acc.initialBalance) * 100)
                  : 0;
                const isReceivable = acc.direction === "receivable";
                const hasInterest = acc.interestRateBps != null && acc.interestRateBps > 0;

                return (
                  <Card key={acc.id} className="space-y-4 p-5 rounded-[20px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-[var(--foreground)] truncate">
                            {acc.name}
                          </h3>
                          <Badge tone={isReceivable ? "soft" : "neutral"}>
                            {isReceivable ? "Piutang" : "Utang"}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {acc.lender} · {acc.paymentMethod}
                          {hasInterest &&
                            ` · Bunga ${(acc.interestRateBps! / 100).toFixed(1)}% p.a.`}
                        </p>
                      </div>

                      <Badge tone={acc.kind === "payroll" ? "neutral" : "primary"}>
                        {acc.totalInstallments > 0
                          ? `Bulan ${acc.paidInstallments} dari ${acc.totalInstallments} bln`
                          : "Tenor Bebas"}
                      </Badge>
                    </div>

                    <ProgressBar
                      value={pct}
                      tone={isReceivable ? "soft" : "primary"}
                      label={`Progress pembayaran ${acc.name}`}
                    />

                    <div className="flex items-center justify-between text-sm pt-1">
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {isReceivable ? "Sisa piutang tertagih" : "Sisa pokok kewajiban"}
                      </span>
                      <strong className="tabular-nums font-mono text-base font-extrabold text-[var(--foreground)]">
                        {formatRupiah(acc.remainingBalance, isMasked)}
                      </strong>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                      {acc.remainingBalance > 0 && acc.kind !== "payroll" && (
                        <Button
                          variant="secondary"
                          onClick={() => openPayoffModal(acc)}
                          className="flex-1 text-xs min-h-[40px] font-bold"
                        >
                          Lunasi Sekaligus
                        </Button>
                      )}

                      {acc.remainingBalance === 0 && (
                        <Button
                          variant="secondary"
                          onClick={() => closeMutation.mutate({ id: acc.id, closed: true })}
                          className="flex-1 text-xs min-h-[40px]"
                        >
                          Tutup Akun (Sudah Lunas)
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        onClick={() => setDeletingAccount(acc)}
                        className="text-xs min-h-[40px] text-[var(--destructive)] hover:bg-[var(--destructive)]/10 px-2.5 shrink-0"
                        title="Hapus Akun"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Collapsible Closed Accounts */}
          {closedAccounts.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((v) => !v)}
                className="min-h-[40px] text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1.5"
              >
                <span>
                  {showClosed ? "Sembunyikan" : "Tampilkan"} Riwayat Akun Ditutup (
                  {closedAccounts.length})
                </span>
                <span>{showClosed ? "▲" : "▼"}</span>
              </button>

              {showClosed && (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {closedAccounts.map((acc) => (
                    <Card key={acc.id} className="space-y-2 opacity-80 p-4 rounded-[16px]">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-[var(--foreground)]">
                              {acc.name}
                            </h3>
                            <Badge tone="neutral">
                              {acc.direction === "receivable" ? "Piutang" : "Utang"}
                            </Badge>
                          </div>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Total lunas {formatRupiah(acc.initialBalance, isMasked)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            onClick={() => closeMutation.mutate({ id: acc.id, closed: false })}
                            className="text-xs"
                          >
                            Buka Lagi
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDeletingAccount(acc)}
                            className="text-xs text-[var(--destructive)] hover:bg-[var(--destructive)]/10 px-2"
                            title="Hapus Akun"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Monthly Installment Schedule Accordion */}
          {groupedSchedule.length > 0 && (
            <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-xs mt-6">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-bold text-base hover:bg-[var(--surface)] transition-colors select-none">
                <span className="flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-[var(--primary)]" />
                  Jadwal Angsuran Bulanan ({groupedSchedule.length} Bulan)
                  <HelpTooltip
                    title="Jadwal Angsuran Bulanan"
                    content="Rincian jadwal cicilan kewajiban atau piutang yang jatuh tempo pada bulan-bulan mendatang."
                  />
                </span>
                <span className="text-xs font-semibold text-[var(--primary)] group-open:hidden">
                  Buka Jadwal ▼
                </span>
                <span className="text-xs font-semibold text-[var(--muted-foreground)] hidden group-open:inline">
                  Tutup ▲
                </span>
              </summary>
              <div className="p-4 pt-1 space-y-3 border-t border-[var(--border)]">
                {groupedSchedule.map(([period, rows]) => {
                  const totalMonth = rows.reduce((sum, r) => sum + r.plannedAmount, 0);
                  return (
                    <Card key={period} className="p-0 overflow-hidden rounded-[14px]">
                      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
                        <strong className="text-sm font-bold text-[var(--foreground)]">
                          {formatMonthTitle(period)}
                        </strong>
                        <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                          {formatRupiah(totalMonth, isMasked)}
                        </span>
                      </div>
                      <div className="divide-y divide-[var(--border)]">
                        {rows.map((item) => {
                          const isReceivable = item.direction === "receivable";
                          return (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--surface)] transition-colors"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-[var(--foreground)]">
                                    {item.accountName}
                                  </span>
                                  <Badge tone={isReceivable ? "soft" : "neutral"}>
                                    {isReceivable ? "Tagih Piutang" : "Bayar Utang"}
                                  </Badge>
                                  {item.accountKind === "payroll" ? (
                                    <Badge tone="neutral">Auto Potong Gaji</Badge>
                                  ) : item.status === "paid" ? (
                                    <Badge tone="soft">Lunas</Badge>
                                  ) : (
                                    <Badge tone="highlight">Belum Lunas</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  Jatuh tempo {formatShortDate(item.dueDate)} · {item.lender}
                                </p>
                              </div>

                              <div className="flex items-center gap-2.5">
                                <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                                  {formatRupiah(item.actualAmount ?? item.plannedAmount, isMasked)}
                                </span>
                                {item.accountKind !== "payroll" && item.status === "upcoming" && (
                                  <Button
                                    onClick={() => onPayInstallment(item.id)}
                                    className="min-h-[36px] px-3 text-xs"
                                  >
                                    {isReceivable ? "Terima" : "Bayar"}
                                  </Button>
                                )}
                                {item.accountKind !== "payroll" && item.status === "paid" && (
                                  <Button
                                    variant="secondary"
                                    disabled={unsettleMutation.isPending}
                                    onClick={() => unsettleMutation.mutate(item.id)}
                                    className="min-h-[36px] px-3 text-xs"
                                  >
                                    Batal Lunas
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Early Payoff Modal (Pelunasan Dipercepat & Potong Saldo Dompet) */}
      {payoffTarget && (
        <ModalSheet
          open={Boolean(payoffTarget)}
          onClose={() => setPayoffTarget(null)}
          title={`Pelunasan Dipercepat: ${payoffTarget.name}`}
        >
          <div className="space-y-4">
            <p className="text-xs sm:text-sm text-[var(--muted-foreground)]">
              {payoffTarget.direction === "receivable"
                ? `Tutup dan catat penerimaan seluruh sisa piutang dari ${payoffTarget.lender}. Dana akan otomatis ditambahkan ke saldo dompet pilihan.`
                : `Lunasi seluruh sisa pinjaman pada ${payoffTarget.lender} sekaligus dan tutup seluruh jadwal cicilan mendatang.`}
            </p>

            {/* Interest Savings Note */}
            {payoffTarget.interestRateBps != null && payoffTarget.interestRateBps > 0 && (
              <div className="rounded-[12px] bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                <LightbulbIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Info Penghematan:</strong> Pinjaman ini memiliki bunga{" "}
                  {(payoffTarget.interestRateBps / 100).toFixed(1)}% p.a. Pelunasan sisa pokok lebih
                  awal akan membebaskan Anda dari beban bunga pada bulan-bulan berikutnya.
                </span>
              </div>
            )}

            {/* Wallet Selector with Real Balance Display */}
            <div className="space-y-1.5">
              <label htmlFor="payoff-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                {payoffTarget.direction === "receivable"
                  ? "Pilih Dompet Penerima Dana (Saldo bertambah):"
                  : "Pilih Dompet Sumber Pembayaran (Saldo berkurang):"}
              </label>
              <select
                id="payoff-wallet"
                value={payoffWalletId}
                onChange={(e) => setPayoffWalletId(Number(e.target.value))}
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              >
                {liquidWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} - Saldo: {formatRupiah(w.balance, isMasked)}
                  </option>
                ))}
              </select>
            </div>

            {/* Wallet Overdraft Warning */}
            {payoffTarget.direction !== "receivable" &&
              selectedPayoffWallet &&
              selectedPayoffWallet.balance <
                (parsePositiveInt(payoffAmountInput) || payoffTarget.remaining) && (
                <div className="rounded-[14px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div>
                    <p className="font-bold">Saldo Dompet Tidak Mencukupi!</p>
                    <p className="mt-0.5">
                      Saldo {selectedPayoffWallet.name} saat ini{" "}
                      {formatRupiah(selectedPayoffWallet.balance, isMasked)}, sedangkan pelunasan
                      sebesar{" "}
                      {formatRupiah(
                        parsePositiveInt(payoffAmountInput) || payoffTarget.remaining,
                        isMasked,
                      )}
                      . Pembayaran tidak dapat diproses.
                    </p>
                  </div>
                </div>
              )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="payoff-amount" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                  Nominal Pelunasan (Rp)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
                    Rp
                  </span>
                  <input
                    id="payoff-amount"
                    inputMode="numeric"
                    value={payoffAmountInput}
                    onChange={(e) => setPayoffAmountInput(formatDigitsInput(e.target.value))}
                    className="tabular-nums font-mono w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-bold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="payoff-date" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                  Tanggal Pelunasan
                </label>
                <input
                  id="payoff-date"
                  type="date"
                  value={payoffDate}
                  onChange={(e) => setPayoffDate(e.target.value)}
                  className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                />
              </div>
            </div>

            {payoffError && (
              <p className="text-xs text-[var(--destructive)] font-semibold">{payoffError}</p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-700">
              <button
                type="button"
                onClick={() => setPayoffTarget(null)}
                className="inline-flex min-h-[44px] items-center px-4 py-2.5 rounded-[14px] text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => payoffMutation.mutate()}
                disabled={
                  payoffMutation.isPending ||
                  (payoffTarget.direction !== "receivable" &&
                    Boolean(
                      selectedPayoffWallet &&
                        selectedPayoffWallet.balance <
                          (parsePositiveInt(payoffAmountInput) || payoffTarget.remaining),
                    ))
                }
                className="min-h-[44px] px-6 py-3 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
              >
                {payoffMutation.isPending ? "Memproses..." : "Konfirmasi Lunasi Sekarang"}
              </button>
            </div>
          </div>
        </ModalSheet>
      )}

      {/* Delete Debt Account Confirmation Modal */}
      {deletingAccount && (
        <ModalSheet
          open={Boolean(deletingAccount)}
          onClose={() => setDeletingAccount(null)}
          title={`Hapus ${deletingAccount.direction === "receivable" ? "Piutang" : "Utang"}?`}
        >
          <div className="space-y-4">
            <div className="rounded-[14px] border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-4 text-sm text-[var(--foreground)] space-y-2">
              <p>
                Apakah Anda yakin ingin menghapus akun <strong>{deletingAccount.name}</strong> (
                {deletingAccount.lender})?
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Seluruh jadwal angsuran dan riwayat terkait akun ini akan dihapus secara permanen
                dari sistem. Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="ghost"
                onClick={() => setDeletingAccount(null)}
                disabled={deleteMutation.isPending}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteMutation.mutate(deletingAccount.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus Akun"}
              </Button>
            </div>
          </div>
        </ModalSheet>
      )}
    </div>
  );
}
