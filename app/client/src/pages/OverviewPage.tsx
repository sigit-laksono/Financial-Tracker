import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { daysBetween } from "../../../shared/src/dates";
import type { CycleMode } from "../../../shared/src/types";
import { api, ApiError, type DashboardDto, type WalletDto } from "../lib/api";
import {
  formatCompactRupiah,
  formatPeriodRangeLabel,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  shiftMonth,
} from "../lib/format";
import {
  AlertIcon,
  AssetIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  ShieldIcon,
  WalletIcon,
} from "../components/Icons";
import { Badge, Button, Card, ErrorBoundary, ProgressBar } from "../components/UI";
import { DailyHeroCard } from "../components/DailyHeroCard";
import { NetWorthHeroCard } from "../components/NetWorthHeroCard";
import { Budget503020Progress } from "../components/Budget503020Progress";
import { CalendarActivityGrid } from "../components/CalendarActivityGrid";
import { RecentTransactionsWidget } from "../components/RecentTransactionsWidget";
import { RecurringBillsModal } from "../components/RecurringBillsModal";
import { BankBadge } from "../components/BankBadge";
import { usePrivacyMode } from "../lib/usePrivacyMode";

export function OverviewPage({
  data,
  cycle: _cycle,
  period,
  onCycleChange: _onCycleChange,
  onPeriodChange,
  onPayInstallment,
  onOpenTransactions,
  onOpenDebts,
  onOpenReconcile,
  onOpenReceiveSalary,
  onOpenBudget,
  onOpenGoals,
  onOpenAssets,
  onReconcileWallet,
  onToast,
}: {
  data: DashboardDto;
  cycle: CycleMode;
  period: string;
  onCycleChange: (cycle: CycleMode) => void;
  onPeriodChange: (period: string) => void;
  onPayInstallment: (installmentId: number) => void;
  onOpenTransactions: () => void;
  onOpenDebts: () => void;
  onOpenReconcile: () => void;
  onOpenReceiveSalary: () => void;
  onOpenBudget?: () => void;
  onOpenGoals?: () => void;
  onOpenAssets?: () => void;
  onReconcileWallet?: (wallet: WalletDto) => void;
  onToast?: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const { metrics, wallets, nextDueInstallment, budgetAlerts } = data;
  const recurringBills = data.recurringBills ?? [];

  const { data: netWorthData } = useQuery({
    queryKey: ["net-worth-summary"],
    queryFn: () => api.getNetWorthSummary(),
  });

  const totalLiquidAssets = netWorthData?.totalLiquidAssets ?? metrics.totalLiquidCash ?? 0;
  const totalNonLiquidAssets =
    (netWorthData?.totalInvestmentAssets ?? 0) + (netWorthData?.totalFixedAssets ?? 0);
  const totalAssets = netWorthData?.totalAssets ?? totalLiquidAssets + totalNonLiquidAssets;
  const totalLiabilities = netWorthData?.totalLiabilities ?? metrics.ccLimitUsed ?? 0;
  const totalNetWorth = netWorthData?.totalNetWorth ?? totalAssets - totalLiabilities;

  const payRecurringMutation = useMutation({
    mutationFn: (ruleId: number) => api.payRecurringRule(ruleId, { period }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      onToast?.("Tagihan rutin berhasil dicatat sebagai pengeluaran");
    },
    onError: (err) => {
      onToast?.(err instanceof ApiError ? err.message : "Gagal mencatat pembayaran tagihan.");
    },
  });
  const liquidWallets = wallets.filter((w) => w.isActive && w.type !== "credit_card");
  const spendingWallets = liquidWallets.filter((w) => w.role !== "savings");
  const savingsWallets = liquidWallets.filter((w) => w.role === "savings");
  const ccWallet = wallets.find((w) => w.type === "credit_card");
  const ccPercent =
    metrics.ccLimit > 0 ? Math.round((metrics.ccLimitUsed / metrics.ccLimit) * 100) : 0;

  const totalSpendable = metrics.totalSpendableCash ?? metrics.totalLiquidCash ?? 0;
  const totalSavings = metrics.totalSavingsCash ?? 0;
  const ccReserved = metrics.ccReservedCash ?? 0;
  const daysElapsed = metrics.daysElapsed ?? 1;
  const daysTotal = metrics.daysTotal ?? 30;

  const pacingConfigMap: Record<
    "hemat" | "sesuai_jalur" | "agak_boros" | "overpace",
    { label: string; tone: "soft" | "primary" | "highlight" | "danger" }
  > = {
    hemat: { label: "Pacing: Hemat", tone: "soft" },
    sesuai_jalur: { label: "Pacing: Sesuai Jalur", tone: "primary" },
    agak_boros: { label: "Pacing: Agak Boros", tone: "highlight" },
    overpace: { label: "Pacing: Melebihi Batas", tone: "danger" },
  };
  const pacingConfig = metrics.pacingStatus ? pacingConfigMap[metrics.pacingStatus] : undefined;
  const todaySpent = data.calendarHeatmap?.find((d) => d.isToday)?.expense ?? 0;

  const nextDueDays = nextDueInstallment
    ? daysBetween(jakartaToday(), nextDueInstallment.dueDate)
    : null;
  const nextDueBadge =
    nextDueDays === null
      ? null
      : nextDueDays < 0
        ? { tone: "danger" as const, label: `Terlambat ${Math.abs(nextDueDays)} hr` }
        : nextDueDays === 0
          ? { tone: "highlight" as const, label: "Hari Ini" }
          : nextDueDays <= 7
            ? { tone: "highlight" as const, label: `${nextDueDays} hr lagi` }
            : { tone: "info" as const, label: `${nextDueDays} hari lagi` };

  return (
    <div className="space-y-5">
      {/* Page Heading & Period Switcher */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Ringkasan Keuangan</h1>
          <p className="text-xs font-medium text-[var(--muted-foreground)]">
            {data.settings.gajianStartDay === 1
              ? "Siklus Bulanan Kalender"
              : `Siklus Gajian (Tgl ${data.settings.gajianStartDay})`}
          </p>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          <div className="flex w-full sm:w-auto items-center justify-between gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 shadow-2xs">
            <button
              type="button"
              onClick={() => onPeriodChange(shiftMonth(period, -1))}
              aria-label="Periode sebelumnya"
              className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-[var(--surface)] text-[var(--foreground)] transition-colors"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <span className="tabular-nums px-2.5 text-xs font-bold text-[var(--foreground)] sm:text-sm">
              {formatPeriodRangeLabel(data.periodStart, data.periodEnd)}
            </span>
            <button
              type="button"
              onClick={() => onPeriodChange(shiftMonth(period, 1))}
              aria-label="Periode berikutnya"
              className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-[var(--surface)] text-[var(--foreground)] transition-colors"
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Hero Grid 2 Kolom Desktop: Total Kekayaan Bersih & Arus Kas Siklus Ini */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 items-stretch">
        <div className="xl:col-span-5 h-full">
          <NetWorthHeroCard
            totalNetWorth={totalNetWorth}
            totalAssets={totalAssets}
            totalLiabilities={totalLiabilities}
            actions={
              onOpenAssets || metrics.totalLiquidCash < 0 ? (
                <>
                  {onOpenAssets && (
                    <Button
                      variant="secondary"
                      onClick={onOpenAssets}
                      className="min-h-[44px] text-xs px-3.5"
                    >
                      <AssetIcon className="w-4 h-4 mr-1.5" />
                      Buka Portofolio Aset
                    </Button>
                  )}
                  {metrics.totalLiquidCash < 0 && (
                    <Button
                      variant="heroOutline"
                      onClick={onOpenReconcile}
                      className="min-h-[44px] text-xs px-3"
                    >
                      <WalletIcon className="w-3.5 h-3.5" />
                      Sesuaikan Saldo Awal
                    </Button>
                  )}
                </>
              ) : undefined
            }
          />
        </div>

        <div className="xl:col-span-7 h-full">
          <DailyHeroCard
            dailyAllowance={metrics.dailyAllowance}
            safeToSpend={metrics.safeToSpend}
            upcomingCcCyclesSum={metrics.upcomingCcCyclesSum}
            totalIncome={metrics.totalIncome}
            totalExpense={metrics.totalExpense}
            installmentExpense={metrics.installmentExpense}
            todaySpent={todaySpent}
            pacingLabel={pacingConfig?.label}
            pacingTone={pacingConfig?.tone}
            actions={
              !metrics.salaryReceivedThisCycle ? (
                <Button onClick={onOpenReceiveSalary} className="min-h-[44px] text-xs px-3">
                  Catat Gajian
                </Button>
              ) : onOpenBudget ? (
                <Button
                  variant="secondary"
                  onClick={onOpenBudget}
                  className="min-h-[44px] text-xs px-3.5"
                >
                  Atur Anggaran
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>

      {/* Zona 1: Likuiditas & Saldo Dompet Riil (Kas Belanja & Tabungan) */}
      <section aria-labelledby="wallets-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="wallets-heading" className="text-base font-bold text-[var(--foreground)]">
              Kas Belanja Harian
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Total Siap Pakai:{" "}
              <strong className="tabular-nums font-bold text-[var(--foreground)]">
                {formatRupiah(totalSpendable, isMasked)}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenReconcile}
            className="inline-flex min-h-[44px] items-center px-2 text-xs sm:text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
          >
            Cocokkan Saldo
          </button>
        </div>

        {spendingWallets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--border)] p-6 text-center bg-[var(--card)]">
            <p className="text-xs text-[var(--muted-foreground)]">
              Belum ada dompet kas belanja. Tambahkan rekening bank, e-wallet, atau kartu kredit di
              menu <strong className="text-[var(--foreground)]">Dompet</strong>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {spendingWallets.map((w) => (
              <button
                key={w.id}
                type="button"
                title={`Klik untuk cocokkan saldo ${w.name}`}
                onClick={() => (onReconcileWallet ? onReconcileWallet(w) : onOpenReconcile())}
                className="flex flex-col justify-between rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-3.5 text-left shadow-xs transition-all hover:border-[var(--primary)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <div className="w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <BankBadge provider={w.provider || "other"} size="sm" />
                    <span className="text-xs font-bold text-[var(--foreground)] leading-snug break-words">
                      {w.name}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5">
                      Kas Harian
                    </Badge>
                  </div>
                </div>

                <p className="metric-value-compact mt-3 font-bold text-[var(--foreground)]">
                  {formatRupiah(w.balance, isMasked)}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* Tabungan & Simpanan Aman (Hanya jika ada dompet savings) */}
        {savingsWallets.length > 0 && (
          <div className="space-y-2.5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-1.5">
                  <LockIcon
                    className={`w-4 h-4 shrink-0 ${
                      isMasked ? "text-[var(--muted-foreground)]" : "text-[var(--chart-income)]"
                    }`}
                  />
                  <span>Tabungan & Simpanan Aman</span>
                </h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Total Tersimpan:{" "}
                  <strong
                    className={`tabular-nums font-bold ${
                      isMasked ? "text-[var(--foreground)]" : "text-[var(--chart-income)]"
                    }`}
                  >
                    {formatRupiah(totalSavings, isMasked)}
                  </strong>{" "}
                  · Aman, tidak dihitung sebagai uang belanja
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {savingsWallets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  title={`Klik untuk cocokkan saldo ${w.name}`}
                  onClick={() => (onReconcileWallet ? onReconcileWallet(w) : onOpenReconcile())}
                  className="flex flex-col justify-between rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 text-left shadow-xs transition-all hover:border-[var(--primary)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  <div className="w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <BankBadge provider={w.provider || "other"} size="sm" />
                      <span className="text-xs font-bold text-[var(--foreground)] leading-snug break-words">
                        {w.name}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone="soft" className="text-[10px] px-1.5 py-0.5">
                        Tabungan
                      </Badge>
                    </div>
                  </div>

                  <p className="metric-value-compact mt-3 font-bold text-[var(--foreground)]">
                    {formatRupiah(w.balance, isMasked)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Zona 2: Progres Pengeluaran Variabel Utama */}
      <ErrorBoundary
        fallback={
          <Card className="p-4 text-center text-xs text-[var(--muted-foreground)]">
            Widget progres pengeluaran tidak dapat ditampilkan.
          </Card>
        }
      >
        <Budget503020Progress
          budget503020={data.budget503020}
          daysElapsed={daysElapsed}
          daysTotal={daysTotal}
          onOpenBudget={onOpenBudget}
          onOpenGoals={onOpenGoals}
        />
      </ErrorBoundary>

      {/* Zona 2: Calendar Activity & Recent Transactions (Grid 7:5) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7">
          <ErrorBoundary
            fallback={
              <Card className="p-4 text-center text-xs text-[var(--muted-foreground)]">
                Kalender aktivitas belanja tidak dapat dimuat.
              </Card>
            }
          >
            <CalendarActivityGrid
              calendarHeatmap={data.calendarHeatmap}
              today={data.periodStart}
              periodStart={data.periodStart}
              periodEnd={data.periodEnd}
            />
          </ErrorBoundary>
        </div>
        <div className="lg:col-span-5">
          <RecentTransactionsWidget
            transactions={data.transactions}
            dailyTotals={data.dailyTotals}
            onOpenTransactions={onOpenTransactions}
          />
        </div>
      </div>

      {/* Micro-Nudge & Positive Financial Reinforcement */}
      {metrics.totalCcExpense > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-3.5 text-xs shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--soft)] text-[var(--soft-foreground)] shrink-0">
              <ShieldIcon className="w-4 h-4" />
            </span>
            <div>
              <p className="font-bold text-[var(--foreground)]">Bebas Bunga Kartu Kredit</p>
              <p className="text-[var(--muted-foreground)]">
                Hemat estimasi bunga ~
                {formatCompactRupiah(Math.round(metrics.totalCcExpense * 0.0175))} jika dibayar
                lunas sebelum jatuh tempo.
              </p>
            </div>
          </div>
          <Badge tone="soft" className="shrink-0 font-semibold">
            Bebas Bunga
          </Badge>
        </div>
      )}

      {/* Zona 3: Grid 2 Kolom Seimbang: Kewajiban Pembayaran (Kiri) & Kontrol Kredit / Peringatan (Kanan) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 items-start">
        {/* Kolom Kiri: Komitmen Pembayaran (Tagihan Terdekat & Tagihan Rutin) */}
        <div className="space-y-4">
          {/* Tagihan Terdekat */}
          <Card className="flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Tagihan Terdekat
                </p>
                {nextDueInstallment ? (
                  <>
                    <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">
                      {nextDueInstallment.accountName}
                    </h2>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Jatuh tempo {formatShortDate(nextDueInstallment.dueDate)} (
                      {nextDueInstallment.lender})
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">
                      Tidak ada tagihan mendesak
                    </h2>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Semua cicilan manual terdekat sudah lunas.
                    </p>
                  </>
                )}
              </div>
              {nextDueBadge && <Badge tone={nextDueBadge.tone}>{nextDueBadge.label}</Badge>}
            </div>

            {nextDueInstallment ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <strong className="tabular-nums text-xl font-extrabold text-[var(--foreground)]">
                  {formatRupiah(nextDueInstallment.plannedAmount, isMasked)}
                </strong>
                <Button onClick={() => onPayInstallment(nextDueInstallment.id)}>
                  Bayar Tagihan
                </Button>
              </div>
            ) : (
              <div className="border-t border-[var(--border)] pt-3">
                <Button variant="secondary" onClick={onOpenDebts}>
                  Lihat Jadwal Cicilan
                </Button>
              </div>
            )}
          </Card>

          {/* Tagihan Rutin Siklus Ini */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-[var(--foreground)]">
                    Tagihan Rutin Siklus Ini
                  </h2>
                  {recurringBills.length > 0 &&
                    metrics.unpaidRecurringSum !== undefined &&
                    metrics.unpaidRecurringSum > 0 && (
                      <Badge tone="highlight">
                        Sisa: {formatRupiah(metrics.unpaidRecurringSum, isMasked)}
                      </Badge>
                    )}
                </div>
                {recurringBills.length > 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Proyeksi kewajiban bulanan & catat pembayaran 1-klik.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {recurringBills.length > 0 && metrics.unpaidRecurringSum === 0 && (
                  <Badge tone="soft">Semua Tagihan Lunas</Badge>
                )}
                <Button
                  variant="secondary"
                  onClick={() => setIsRecurringModalOpen(true)}
                  className="min-h-[44px] px-3 text-xs"
                >
                  {recurringBills.length === 0 ? "+ Tambah" : "Kelola"}
                </Button>
              </div>
            </div>

            {recurringBills.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-xs text-[var(--muted-foreground)]">
                Belum ada tagihan rutin (WiFi, listrik, langganan).
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {recurringBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="flex flex-col justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold text-[var(--foreground)] truncate">
                          {bill.merchant}
                        </span>
                        <Badge tone={bill.isPaidThisCycle ? "soft" : "neutral"}>
                          {bill.isPaidThisCycle ? "Sudah Lunas" : `Tgl ${bill.dueDay}`}
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {bill.category} · {bill.walletName}
                      </p>
                      <p className="tabular-nums text-sm font-bold text-[var(--foreground)]">
                        {formatRupiah(bill.amount, isMasked)}
                      </p>
                    </div>

                    <div className="border-t border-[var(--border)] pt-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        {bill.isPaidThisCycle
                          ? "Tercatat di pengeluaran"
                          : bill.dueDateThisCycle
                            ? `Jatuh tempo: ${formatShortDate(bill.dueDateThisCycle)}`
                            : `Jatuh tempo tgl ${bill.dueDay}`}
                      </span>
                      {!bill.isPaidThisCycle && (
                        <Button
                          disabled={payRecurringMutation.isPending}
                          onClick={() => payRecurringMutation.mutate(bill.id)}
                          className="min-h-[44px] text-xs px-3.5"
                        >
                          Bayar Sekarang
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Kolom Kanan: Pengawasan Risiko & Limit (Kartu Kredit & Peringatan Anggaran) */}
        <div className="space-y-4">
          {/* Kartu Kredit Bridge */}
          <Card className="flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {ccWallet ? `Kartu Kredit ${ccWallet.name}` : "Kartu Kredit"}
                </p>
                <span className="tabular-nums text-xs font-semibold text-[var(--muted-foreground)]">
                  Terpakai {ccPercent}%
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <strong className="tabular-nums text-xl font-extrabold text-[var(--foreground)]">
                  {formatRupiah(metrics.ccLimitUsed, isMasked)}
                </strong>
                <span className="tabular-nums text-xs text-[var(--muted-foreground)]">
                  dari {formatCompactRupiah(metrics.ccLimit, isMasked)}
                </span>
              </div>
              <ProgressBar
                value={ccPercent}
                tone={ccPercent >= 80 ? "danger" : ccPercent >= 30 ? "highlight" : "soft"}
                label="Persentase pemakaian limit kartu kredit"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-foreground)]">
              <span>
                {ccReserved > 0 ? (
                  <>
                    Jatuh Tempo Siklus Ini:{" "}
                    <strong className="tabular-nums text-[var(--foreground)]">
                      {formatRupiah(ccReserved, isMasked)}
                    </strong>
                  </>
                ) : (
                  <span>Tidak ada tagihan jatuh tempo siklus ini</span>
                )}
                {metrics.upcomingCcCyclesSum !== undefined && metrics.upcomingCcCyclesSum > 0 && (
                  <>
                    {" "}
                    · Menanti Gajian:{" "}
                    <strong className="tabular-nums text-[var(--foreground)]">
                      {formatRupiah(metrics.upcomingCcCyclesSum, isMasked)}
                    </strong>
                  </>
                )}
                {metrics.ccUnbilled > 0 && (
                  <>
                    {" "}
                    · Tagihan Berjalan:{" "}
                    <strong className="tabular-nums text-[var(--foreground)]">
                      {formatRupiah(metrics.ccUnbilled, isMasked)}
                    </strong>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={onOpenDebts}
                className="inline-flex min-h-[44px] items-center px-2 font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
              >
                Kelola CC
              </button>
            </div>
          </Card>

          {/* Budget Alerts: Peringatan Anggaran Kategori */}
          {budgetAlerts.length > 0 && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertIcon className="h-4 w-4 text-[var(--highlight)]" />
                  <h2 className="text-base font-bold text-[var(--foreground)]">
                    Perhatian Anggaran Kategori
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onOpenTransactions}
                  className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-[var(--primary)] hover:underline"
                >
                  Lihat Semua
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {budgetAlerts.map((b) => (
                  <div
                    key={b.category}
                    className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--foreground)]">
                        {b.category}
                      </span>
                      <Badge tone={b.status === "over" ? "danger" : "highlight"}>
                        {b.status === "over"
                          ? `Lewat batas (${b.percentUsed}%)`
                          : `Mendekati batas (${b.percentUsed}%)`}
                      </Badge>
                    </div>
                    <ProgressBar
                      value={b.percentUsed}
                      tone={b.status === "over" ? "danger" : "highlight"}
                      label={`Anggaran ${b.category}`}
                    />
                    <p className="tabular-nums text-xs text-[var(--muted-foreground)]">
                      Terpakai {formatRupiah(b.spentAmount, isMasked)} dari{" "}
                      {formatRupiah(b.limitAmount, isMasked)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <RecurringBillsModal
        open={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
        categories={data.categories}
        wallets={wallets}
        onToast={onToast}
      />
    </div>
  );
}
