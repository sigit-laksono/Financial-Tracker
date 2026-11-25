import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ccCycleForDate } from "../../../shared/src/dates";
import type { DebtDirection, DebtKind } from "../../../shared/src/types";
import { BankBadge } from "../components/BankBadge";
import { EditDebtModal } from "../components/EditDebtModal";
import { HelpTooltip } from "../components/HelpTooltip";
import {
  AlertIcon,
  CardDebtIcon,
  CheckIcon,
  ClockIcon,
  EditIcon,
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

type DebtPageTab = "summary" | "loan" | "cards" | "payroll" | "receivable";

const KIND_BADGE_LABEL: Record<DebtKind, string> = {
  loan: "Pinjaman Tunai",
  card_installment: "Cicilan CC",
  payroll: "Potong Gaji",
  receivable: "Piutang",
};

export function DebtsPage({
  data,
  onOpenAddDebt,
  onPayInstallment,
  onPayCcCycle,
  onOpenSplitPay,
  onToast,
}: {
  data: DebtsDto;
  onOpenAddDebt: (opts?: { direction?: DebtDirection; kind?: DebtKind }) => void;
  onPayInstallment: (installmentId: number) => void;
  onPayCcCycle: (cycleKey: string, installmentIds: number[], ccWalletId?: number) => void;
  onOpenSplitPay: (target: SplitPayTarget) => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();

  const [activeTab, setActiveTab] = useState<DebtPageTab>("summary");
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
    if (!activeCard) return data.currentCcCycle;
    const cardCurrent = ccCycleForDate(jakartaToday(), activeCard.cutoffDay);
    return (
      activeCard.cycleSummaries.find((c) => c.cycleKey === cardCurrent)?.cycleKey ??
      activeCard.cycleSummaries[0]?.cycleKey ??
      data.currentCcCycle
    );
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
  const [editingAccount, setEditingAccount] = useState<DebtAccountDto | null>(null);

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

  // Group accounts cleanly by debt type
  const activeLoanAccounts = useMemo(
    () => data.accounts.filter((a) => !a.closed && a.direction !== "receivable" && a.kind === "loan"),
    [data.accounts],
  );
  const activePayrollAccounts = useMemo(
    () => data.accounts.filter((a) => !a.closed && a.direction !== "receivable" && a.kind === "payroll"),
    [data.accounts],
  );
  const activeCardInstallments = useMemo(
    () =>
      data.accounts.filter(
        (a) => !a.closed && a.direction !== "receivable" && a.kind === "card_installment",
      ),
    [data.accounts],
  );
  const activeCardSpecificInstallments = useMemo(() => {
    if (!activeCard) return activeCardInstallments;
    return activeCardInstallments.filter(
      (a) => a.walletId === activeCard.walletId || (cards.length === 1 && !a.walletId),
    );
  }, [activeCardInstallments, activeCard, cards.length]);
  const activeReceivableAccounts = useMemo(
    () => data.accounts.filter((a) => !a.closed && a.direction === "receivable"),
    [data.accounts],
  );

  const closedAccounts = useMemo(() => {
    return data.accounts.filter((a) => {
      if (!a.closed) return false;
      if (activeTab === "loan") return a.direction !== "receivable" && a.kind === "loan";
      if (activeTab === "cards") return a.direction !== "receivable" && a.kind === "card_installment";
      if (activeTab === "payroll") return a.direction !== "receivable" && a.kind === "payroll";
      if (activeTab === "receivable") return a.direction === "receivable";
      return true;
    });
  }, [data.accounts, activeTab]);

  // Totals (prevent double-counting card_installment between remainingDebt and ccLimitUsed)
  const loanRemaining =
    data.totals.loanRemaining ??
    activeLoanAccounts.reduce((sum, a) => sum + a.remainingBalance, 0);
  const payrollRemaining =
    data.totals.payrollRemaining ??
    activePayrollAccounts.reduce((sum, a) => sum + a.remainingBalance, 0);
  const cardInstallmentRemaining =
    data.totals.cardInstallmentRemaining ??
    activeCardInstallments.reduce((sum, a) => sum + a.remainingBalance, 0);
  const nonCcRemainingDebt = loanRemaining + payrollRemaining;
  const unlinkedCardInstallment = cards.length === 0 ? cardInstallmentRemaining : 0;
  const totalKewajiban =
    nonCcRemainingDebt + (data.totals.ccLimitUsed ?? 0) + unlinkedCardInstallment;
  const hasDebt = totalKewajiban > 0;

  const activeCardLimit = activeCard?.creditLimit ?? data.totals.ccLimit;
  const activeCardUsed = activeCard?.limitUsed ?? data.totals.ccLimitUsed;
  const activeCardInstallmentUsed = activeCard?.installmentLimitUsed ?? 0;
  const activeCardDailyUsed =
    activeCard?.dailyLimitUsed ?? Math.max(0, activeCardUsed - activeCardInstallmentUsed);
  const activeCardAvailable = activeCard?.balance ?? data.totals.ccLimitAvailable;

  const ccPercent = activeCardLimit ? Math.round((activeCardUsed / activeCardLimit) * 100) : 0;
  const ccInstallmentPct = activeCardLimit
    ? Math.min(100, (activeCardInstallmentUsed / activeCardLimit) * 100)
    : 0;
  const ccDailyPct = activeCardLimit
    ? Math.min(Math.max(0, 100 - ccInstallmentPct), (activeCardDailyUsed / activeCardLimit) * 100)
    : 0;

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

  const groupedSchedule = useMemo(() => {
    const map = new Map<string, typeof data.installments>();
    for (const item of data.installments) {
      if (item.accountClosed) continue;
      if (activeTab === "loan" && (item.direction === "receivable" || item.accountKind !== "loan")) {
        continue;
      }
      if (
        activeTab === "cards" &&
        (item.direction === "receivable" || item.accountKind !== "card_installment")
      ) {
        continue;
      }
      if (
        activeTab === "payroll" &&
        (item.direction === "receivable" || item.accountKind !== "payroll")
      ) {
        continue;
      }
      if (activeTab === "receivable" && item.direction !== "receivable") continue;
      const list = map.get(item.period) ?? [];
      list.push(item);
      map.set(item.period, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.installments, activeTab]);

  const upcomingObligations = useMemo(() => {
    return data.installments
      .filter((i) => !i.accountClosed && i.status === "upcoming")
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [data.installments]);

  const renderAccountCards = (accounts: DebtAccountDto[]) => (
    <div
      className={`grid gap-4 ${
        accounts.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
      }`}
    >
      {accounts.map((acc) => {
        const pct = acc.initialBalance ? Math.round((acc.paidAmount / acc.initialBalance) * 100) : 0;
        const isReceivable = acc.direction === "receivable";
        const hasInterest = acc.interestRateBps != null && acc.interestRateBps > 0;
        const kindLabel = KIND_BADGE_LABEL[acc.kind] ?? "Utang";

        return (
          <Card key={acc.id} className="space-y-4 p-5 rounded-[20px]">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-[var(--foreground)] truncate">{acc.name}</h3>
                  <Badge tone={isReceivable ? "soft" : acc.kind === "card_installment" ? "highlight" : "neutral"}>
                    {kindLabel}
                  </Badge>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {acc.lender} · {acc.paymentMethod}
                  {hasInterest && ` · Bunga ${(acc.interestRateBps! / 100).toFixed(1)}% p.a.`}
                </p>
              </div>

              <Badge
                tone={acc.kind === "payroll" ? "neutral" : "primary"}
                className="whitespace-nowrap shrink-0"
              >
                {acc.totalInstallments > 0
                  ? `${acc.paidInstallments}/${acc.totalInstallments} angsuran`
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
                {isReceivable
                  ? "Sisa piutang tertagih"
                  : acc.kind === "card_installment"
                    ? "Sisa pokok mengunci limit CC"
                    : "Sisa pokok kewajiban"}
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

              {acc.kind === "payroll" && acc.remainingBalance > 0 && (
                <div className="flex-1 rounded-[10px] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold text-[var(--muted-foreground)]">
                  Otomatis dipotong dari gaji setiap bulan
                </div>
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
                variant="secondary"
                onClick={() => setEditingAccount(acc)}
                className="text-xs min-h-[40px] px-3 gap-1.5 shrink-0 font-semibold"
                title={
                  acc.kind === "card_installment" && !acc.walletId
                    ? "Edit & Tautkan ke Kartu Kredit"
                    : "Edit Utang & Jadwal Cicilan"
                }
                aria-label={`Edit ${acc.name}`}
              >
                <EditIcon className="w-3.5 h-3.5" />
                <span>{acc.kind === "card_installment" && !acc.walletId ? "Tautkan / Edit" : "Edit"}</span>
              </Button>

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
  );

  const tabs: Array<{ id: DebtPageTab; label: string }> = [
    { id: "summary", label: "Ringkasan" },
    { id: "loan", label: `Pinjaman Tunai (${activeLoanAccounts.length})` },
    { id: "cards", label: `Kartu Kredit (${cards.length})` },
    { id: "payroll", label: `Utang Kantor (${activePayrollAccounts.length})` },
    { id: "receivable", label: `Piutang Teman (${activeReceivableAccounts.length})` },
  ];

  const contextualHeaderCta: { label: string; onClick: () => void } =
    activeTab === "loan"
      ? {
          label: "Tambah Pinjaman Tunai",
          onClick: () => onOpenAddDebt({ direction: "payable", kind: "loan" }),
        }
      : activeTab === "cards"
        ? {
            label: "Tambah Cicilan CC",
            onClick: () => onOpenAddDebt({ direction: "payable", kind: "card_installment" }),
          }
        : activeTab === "payroll"
          ? {
              label: "Tambah Utang Kantor",
              onClick: () => onOpenAddDebt({ direction: "payable", kind: "payroll" }),
            }
          : activeTab === "receivable"
            ? {
                label: "Catat Piutang Teman",
                onClick: () => onOpenAddDebt({ direction: "receivable", kind: "receivable" }),
              }
            : {
                label: "Tambah Utang / Piutang",
                onClick: () => onOpenAddDebt(),
              };

  const showLoanSection = activeTab === "loan";
  const showCardsSection = activeTab === "cards";
  const showPayrollSection = activeTab === "payroll";
  const showReceivableSection = activeTab === "receivable";

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Kartu & Utang</h1>
        <Button
          onClick={contextualHeaderCta.onClick}
          className="w-full sm:w-auto justify-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          <span>{contextualHeaderCta.label}</span>
        </Button>
      </div>

      {/* Debts Summary Hero Card */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <CardDebtIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Kewajiban Utang</span>
            </div>
            <Badge
              tone={isMasked ? "neutral" : hasDebt ? "highlight" : "soft"}
              className="text-[11px] font-bold px-2 py-0.5"
            >
              {isMasked ? "Mode Privasi" : hasDebt ? "Ada Kewajiban" : "Lunas"}
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <h2 className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
              {formatRupiah(totalKewajiban, isMasked)}
            </h2>
          </div>
        </div>
      </div>

      {/* Beban Bulan Ini Summary Strip */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-[11px] font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
          Beban Bulan Ini
        </span>
        <p
          className={`metric-value-compact font-extrabold whitespace-nowrap tabular-nums ${
            isMasked ? "text-[var(--foreground)]" : "text-[var(--highlight-text)]"
          }`}
        >
          {formatRupiah(monthlyDebtBurden, isMasked)}
        </p>
      </div>

      {/* 5 Navigation Filter Tabs (1-Row Horizontal Scroll) */}
      <div
        role="tablist"
        aria-label="Kategori utang, kartu kredit, dan piutang"
        className="flex flex-nowrap overflow-x-auto no-scrollbar scroll-fade-x items-center gap-2 border-b border-[var(--border)] pb-3 text-sm"
      >
        {tabs.map((tabItem) => {
          const isActive = activeTab === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tabItem.id)}
              className={`min-h-[42px] whitespace-nowrap shrink-0 rounded-[12px] px-4 font-bold transition-all ${
                isActive
                  ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              }`}
            >
              {tabItem.label}
            </button>
          );
        })}
      </div>

      {/* TAB: RINGKASAN */}
      {activeTab === "summary" && (
        <div className="space-y-6">
          {/* Ringkasan per Kategori */}
          <section className="space-y-3">
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Ringkasan per Kategori
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Pinjaman Tunai */}
              <Card className="rounded-[18px] p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--foreground)]">
                        Pinjaman Tunai
                      </h3>
                      <Badge tone="neutral" className="whitespace-nowrap">
                        {activeLoanAccounts.length} akun aktif
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">Total sisa pinjaman</p>
                  </div>
                  <strong className="metric-value-compact shrink-0 text-right whitespace-nowrap font-extrabold text-[var(--foreground)]">
                    {formatRupiah(loanRemaining, isMasked)}
                  </strong>
                </div>
                <div className="flex items-center justify-end border-t border-[var(--border)] pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => setActiveTab("loan")}
                    className="min-h-[38px] px-3.5 text-xs font-bold"
                  >
                    Lihat Detail →
                  </Button>
                </div>
              </Card>

              {/* Kartu Kredit */}
              <Card className="rounded-[18px] p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--foreground)]">Kartu Kredit</h3>
                      <Badge tone="highlight" className="whitespace-nowrap">
                        {cards.length} kartu aktif
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
                      Sisa limit {formatCompactRupiah(data.totals.ccLimitAvailable, isMasked)} dari{" "}
                      {formatCompactRupiah(data.totals.ccLimit, isMasked)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right whitespace-nowrap">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Limit Terpakai
                    </span>
                    <strong
                      className={`metric-value-compact block whitespace-nowrap font-extrabold ${
                        isMasked ? "text-[var(--foreground)]" : "text-[var(--destructive)]"
                      }`}
                    >
                      {formatRupiah(data.totals.ccLimitUsed, isMasked)}
                    </strong>
                  </div>
                </div>
                <div className="flex items-center justify-end border-t border-[var(--border)] pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => setActiveTab("cards")}
                    className="min-h-[38px] px-3.5 text-xs font-bold"
                  >
                    Kelola CC →
                  </Button>
                </div>
              </Card>

              {/* Utang Kantor */}
              <Card className="rounded-[18px] p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--foreground)]">Utang Kantor</h3>
                      <Badge tone="neutral" className="whitespace-nowrap">
                        {activePayrollAccounts.length} akun aktif
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Total sisa potong gaji
                    </p>
                  </div>
                  <strong className="metric-value-compact shrink-0 text-right whitespace-nowrap font-extrabold text-[var(--foreground)]">
                    {formatRupiah(payrollRemaining, isMasked)}
                  </strong>
                </div>
                <div className="flex items-center justify-end border-t border-[var(--border)] pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => setActiveTab("payroll")}
                    className="min-h-[38px] px-3.5 text-xs font-bold"
                  >
                    Lihat Detail →
                  </Button>
                </div>
              </Card>

              {/* Piutang Teman */}
              <Card className="rounded-[18px] p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--foreground)]">Piutang Teman</h3>
                      <Badge tone="soft" className="whitespace-nowrap">
                        {activeReceivableAccounts.length} akun aktif
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">Total sisa piutang</p>
                  </div>
                  <strong
                    className={`metric-value-compact shrink-0 text-right whitespace-nowrap font-extrabold ${
                      isMasked
                        ? "text-[var(--foreground)]"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {formatRupiah(data.totals.remainingReceivable, isMasked)}
                  </strong>
                </div>
                <div className="flex items-center justify-end border-t border-[var(--border)] pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => setActiveTab("receivable")}
                    className="min-h-[38px] px-3.5 text-xs font-bold"
                  >
                    Lihat Detail →
                  </Button>
                </div>
              </Card>
            </div>
          </section>

          {/* Tagihan Terdekat / Kewajiban Bulan Ini */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold text-[var(--foreground)]">
                Tagihan Terdekat
              </h2>
              {upcomingObligations.length > 5 && (
                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                  Menampilkan 5 dari {upcomingObligations.length} jadwal mendatang
                </span>
              )}
            </div>

            {upcomingObligations.length === 0 ? (
              <Card className="p-4 text-xs text-[var(--muted-foreground)]">
                Tidak ada tagihan atau cicilan jatuh tempo terdekat.
              </Card>
            ) : (
              <Card className="p-0 overflow-hidden rounded-[18px]">
                <div className="divide-y divide-[var(--border)]">
                  {upcomingObligations.slice(0, 5).map((item) => {
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
                            {item.accountKind === "payroll" ? (
                              <Badge tone="neutral">Auto Potong Gaji</Badge>
                            ) : (
                              <Badge tone={isReceivable ? "soft" : "neutral"}>
                                {KIND_BADGE_LABEL[item.accountKind] ??
                                  (isReceivable ? "Piutang" : "Utang")}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Jatuh tempo {formatShortDate(item.dueDate)} · {item.lender}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                            {formatRupiah(item.plannedAmount, isMasked)}
                          </span>
                          {item.accountKind !== "payroll" && (
                            <Button
                              onClick={() => onPayInstallment(item.id)}
                              className="min-h-[36px] px-3 text-xs"
                            >
                              {isReceivable ? "Terima" : "Bayar"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </section>
        </div>
      )}

      {/* GROUP 1: PINJAMAN TUNAI */}
      {showLoanSection && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Pinjaman Tunai ({activeLoanAccounts.length})
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              KTA, pinjaman bank, atau pinjaman tunai dengan jadwal angsuran mandiri.
            </p>
          </div>

          {activeLoanAccounts.length === 0 ? (
            <StateView
              kind="empty"
              icon={<CardDebtIcon className="w-6 h-6" />}
              title="Tidak Ada Pinjaman Tunai Aktif"
              description="Semua pinjaman tunai sudah lunas atau belum ada yang dicatat."
              actionLabel="Catat Pinjaman Tunai"
              onAction={() => onOpenAddDebt({ direction: "payable", kind: "loan" })}
            />
          ) : (
            renderAccountCards(activeLoanAccounts)
          )}
        </section>
      )}

      {/* GROUP 2: KARTU KREDIT (Transaksi Harian + Cicilan Kartu Kredit) */}
      {showCardsSection && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Kartu Kredit & Cicilan Limit ({cards.length})
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Transaksi harian dan cicilan kartu kredit berbagi satu batas limit kartu yang sama.
            </p>
          </div>

          {cards.length === 0 ? (
            <Card className="p-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--muted-foreground)]">
                <CardDebtIcon className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)]">
                Belum Ada Kartu Kredit
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] max-w-md mx-auto">
                Tambahkan dompet bertipe Kartu Kredit di menu Dompet untuk melacak limit, cicilan
                yang mengunci limit, siklus cetak tagihan, dan transaksi harian.
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
                        const cardCurrent = ccCycleForDate(jakartaToday(), c.cutoffDay);
                        setSelectedCycle(
                          c.cycleSummaries.find((s) => s.cycleKey === cardCurrent)?.cycleKey ??
                            c.cycleSummaries[0]?.cycleKey ??
                            data.currentCcCycle,
                        );
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
                      <h3 className="text-lg font-extrabold text-[var(--foreground)]">
                        {activeCard?.walletName ?? "Kartu Kredit"}
                      </h3>
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
                    tone={ccPercent >= 80 ? "danger" : ccPercent >= 30 ? "highlight" : "soft"}
                    className="text-xs font-bold"
                  >
                    {ccPercent}% Terpakai · Sisa Limit{" "}
                    {formatRupiah(activeCardAvailable, isMasked)}
                  </Badge>
                </div>

                {/* Stacked 2-Segment Limit Progress Bar (Cicilan CC + Harian) */}
                <div className="mt-4 space-y-2">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, ccPercent)}
                    aria-label={`Pemakaian limit ${activeCard?.walletName ?? "CC"}`}
                    className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--border)]/60"
                  >
                    {ccInstallmentPct > 0 && (
                      <div
                        style={{ width: `${ccInstallmentPct}%` }}
                        className={`h-full transition-all duration-300 ${
                          ccPercent >= 80
                            ? "bg-[var(--destructive)]"
                            : ccPercent >= 30
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                        title={`Terkunci Cicilan: ${formatRupiah(activeCardInstallmentUsed, isMasked)}`}
                      />
                    )}
                    {ccDailyPct > 0 && (
                      <div
                        style={{ width: `${ccDailyPct}%` }}
                        className={`h-full transition-all duration-300 ${
                          ccPercent >= 80
                            ? "bg-[var(--destructive)]/80"
                            : ccPercent >= 30
                              ? "bg-amber-400"
                              : "bg-[var(--primary)]"
                        }`}
                        title={`Belanja Harian: ${formatRupiah(activeCardDailyUsed, isMasked)}`}
                      />
                    )}
                  </div>

                  {/* Breakdown Legend */}
                  <div className="grid grid-cols-1 gap-2 pt-1 text-xs sm:grid-cols-3">
                    <div className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            ccPercent >= 80
                              ? "bg-[var(--destructive)]"
                              : ccPercent >= 30
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                        />
                        Terkunci Cicilan
                      </span>
                      <strong className="font-mono tabular-nums text-[var(--foreground)]">
                        {formatRupiah(activeCardInstallmentUsed, isMasked)}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            ccPercent >= 80
                              ? "bg-[var(--destructive)]/80"
                              : ccPercent >= 30
                                ? "bg-amber-400"
                                : "bg-[var(--primary)]"
                          }`}
                        />
                        Belanja Harian
                      </span>
                      <strong className="font-mono tabular-nums text-[var(--foreground)]">
                        {formatRupiah(activeCardDailyUsed, isMasked)}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                        Sisa Limit Harian
                      </span>
                      <strong
                        className={`font-mono tabular-nums ${
                          isMasked
                            ? "text-[var(--foreground)]"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {formatRupiah(activeCardAvailable, isMasked)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Card Dates & Cashflow Protection Status */}
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
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

              {/* Sub-section A: Cicilan Kartu Kredit Aktif on this card */}
              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  Cicilan Kartu Kredit Aktif ({activeCardSpecificInstallments.length})
                </h3>

                {activeCardSpecificInstallments.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] py-1">
                    Belum ada cicilan kartu kredit aktif pada kartu ini.
                  </p>
                ) : (
                  renderAccountCards(activeCardSpecificInstallments)
                )}
              </div>

              {/* Sub-section B: CC Daily Transactions in Cycle */}
              <div className="space-y-2 border-t border-[var(--border)] pt-4">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  Transaksi Harian {activeCard?.walletName ?? "CC"} ({cycleTransactions.length})
                </h3>
                {cycleTransactions.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] py-2">
                    Belum ada transaksi harian kartu kredit yang dicatat pada siklus ini.
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

          {/* Fallback if there are unlinked card_installment accounts when cards.length === 0 */}
          {cards.length === 0 && activeCardInstallments.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[var(--foreground)]">
                Cicilan Kartu Kredit Belum Tertaut ({activeCardInstallments.length})
              </h3>
              {renderAccountCards(activeCardInstallments)}
            </div>
          )}
        </section>
      )}

      {/* GROUP 3: UTANG KANTOR / POTONGAN GAJI */}
      {showPayrollSection && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Utang Kantor / Potongan Gaji ({activePayrollAccounts.length})
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Kasbon atau pinjaman koperasi kantor yang otomatis dipotong dari gaji setiap bulan.
            </p>
          </div>

          {activePayrollAccounts.length === 0 ? (
            <StateView
              kind="empty"
              icon={<CardDebtIcon className="w-6 h-6" />}
              title="Tidak Ada Utang Kantor Aktif"
              description="Belum ada potongan gaji atau pinjaman kantor aktif saat ini."
              actionLabel="Catat Utang Kantor"
              onAction={() => onOpenAddDebt({ direction: "payable", kind: "payroll" })}
            />
          ) : (
            renderAccountCards(activePayrollAccounts)
          )}
        </section>
      )}

      {/* GROUP 4: PIUTANG TEMAN */}
      {showReceivableSection && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Piutang Teman & Talangan ({activeReceivableAccounts.length})
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Dana yang Anda pinjamkan atau talangkan ke pihak lain dan menunggu pengembalian.
            </p>
          </div>

          {activeReceivableAccounts.length === 0 ? (
            <StateView
              kind="empty"
              icon={<CardDebtIcon className="w-6 h-6" />}
              title="Tidak Ada Piutang Aktif"
              description="Semua pinjaman atau talangan teman sudah lunas, atau Anda belum pernah mencatat piutang."
              actionLabel="Catat Piutang / Talangan"
              onAction={() => onOpenAddDebt({ direction: "receivable", kind: "receivable" })}
            />
          ) : (
            renderAccountCards(activeReceivableAccounts)
          )}
        </section>
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
                        <h3 className="text-sm font-bold text-[var(--foreground)]">{acc.name}</h3>
                        <Badge tone="neutral">{KIND_BADGE_LABEL[acc.kind] ?? "Utang"}</Badge>
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
          <summary className="flex cursor-pointer items-center justify-between gap-2 p-4 font-bold text-base hover:bg-[var(--surface)] transition-colors select-none">
            <span className="flex flex-wrap items-center gap-2 min-w-0">
              <ClockIcon className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>Jadwal Angsuran Bulanan ({groupedSchedule.length} Bulan)</span>
              <HelpTooltip
                title="Jadwal Angsuran Bulanan"
                content="Rincian jadwal cicilan kewajiban atau piutang yang jatuh tempo pada bulan-bulan mendatang."
              />
            </span>
            <span className="text-xs font-semibold text-[var(--primary)] whitespace-nowrap shrink-0 group-open:hidden">
              Buka Jadwal ▼
            </span>
            <span className="text-xs font-semibold text-[var(--muted-foreground)] whitespace-nowrap shrink-0 hidden group-open:inline">
              Tutup ▲
            </span>
          </summary>
          <div className="p-4 pt-3 border-t border-[var(--border)]">
            <div className="border-l-2 border-[var(--border)] pl-4 space-y-4">
              {groupedSchedule.map(([period, rows]) => {
                const totalMonth = rows.reduce((sum, r) => sum + r.plannedAmount, 0);
                return (
                  <div key={period} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[23px] top-3 h-3 w-3 rounded-full border-2 border-[var(--card)] bg-[var(--primary)]"
                    />
                    <Card className="p-0 overflow-hidden rounded-[14px]">
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
                                  {item.accountKind === "payroll" ? (
                                    <Badge tone="neutral">Auto Potong Gaji</Badge>
                                  ) : (
                                    <>
                                      <Badge tone={isReceivable ? "soft" : "neutral"}>
                                        {KIND_BADGE_LABEL[item.accountKind] ??
                                          (isReceivable ? "Tagih Piutang" : "Bayar Utang")}
                                      </Badge>
                                      {item.status === "paid" ? (
                                        <Badge tone="soft">Lunas</Badge>
                                      ) : (
                                        <Badge tone="highlight">Belum Lunas</Badge>
                                      )}
                                    </>
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
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      )}

      {/* Early Payoff Modal (Pelunasan Dipercepat & Potong Saldo Dompet) */}
      {payoffTarget && (
        <ModalSheet
          open={Boolean(payoffTarget)}
          onClose={() => setPayoffTarget(null)}
          title={`Pelunasan Dipercepat: ${payoffTarget.name}`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPayoffTarget(null)}>
                Batal
              </Button>
              <Button
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
              >
                {payoffMutation.isPending ? "Memproses..." : "Konfirmasi Lunasi Sekarang"}
              </Button>
            </div>
          }
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
              <label
                htmlFor="payoff-wallet"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                {payoffTarget.direction === "receivable"
                  ? "Pilih Dompet Penerima Dana (Saldo bertambah):"
                  : "Pilih Dompet Sumber Pembayaran (Saldo berkurang):"}
              </label>
              <select
                id="payoff-wallet"
                value={payoffWalletId}
                onChange={(e) => setPayoffWalletId(Number(e.target.value))}
                className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
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
                <label
                  htmlFor="payoff-amount"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Nominal Pelunasan (Rp)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                    Rp
                  </span>
                  <input
                    id="payoff-amount"
                    inputMode="numeric"
                    value={payoffAmountInput}
                    onChange={(e) => setPayoffAmountInput(formatDigitsInput(e.target.value))}
                    className="tabular-nums font-mono h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="payoff-date"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Tanggal Pelunasan
                </label>
                <input
                  id="payoff-date"
                  type="date"
                  value={payoffDate}
                  onChange={(e) => setPayoffDate(e.target.value)}
                  className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                />
              </div>
            </div>

            {payoffError && (
              <p className="text-xs text-[var(--destructive)] font-semibold">{payoffError}</p>
            )}
          </div>
        </ModalSheet>
      )}

      {/* Edit Debt Account & Installment Schedule Modal */}
      <EditDebtModal
        account={editingAccount}
        installments={data.installments}
        wallets={data.wallets}
        onClose={() => setEditingAccount(null)}
        onSuccess={onToast}
      />

      {/* Delete Debt Account Confirmation Modal */}
      {deletingAccount && (
        <ModalSheet
          open={Boolean(deletingAccount)}
          onClose={() => setDeletingAccount(null)}
          title={`Hapus ${deletingAccount.direction === "receivable" ? "Piutang" : "Utang"}?`}
          footer={
            <div className="flex items-center justify-end gap-2.5">
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
          }
        >
          <div className="rounded-[14px] border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-4 text-sm text-[var(--foreground)] space-y-2">
            <p>
              Apakah Anda yakin ingin menghapus akun <strong>{deletingAccount.name}</strong> (
              {deletingAccount.lender})?
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Seluruh jadwal angsuran dan riwayat terkait akun ini akan dihapus secara permanen dari
              sistem. Tindakan ini tidak dapat dibatalkan.
            </p>
          </div>
        </ModalSheet>
      )}
    </div>
  );
}
