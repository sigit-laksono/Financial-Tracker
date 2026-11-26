import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CycleMode } from "../../../shared/src/types";
import { api, ApiError, type DashboardDto, type DebtsDto, type WalletDto } from "../lib/api";
import { formatPeriodRangeLabel, formatRupiah, formatShortDate, shiftMonth } from "../lib/format";
import {
  AlertIcon,
  AssetIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  WalletIcon,
} from "../components/Icons";
import { Badge, Button, Card, ErrorBoundary, ProgressBar } from "../components/UI";
import { DailyHeroCard } from "../components/DailyHeroCard";
import { NetWorthHeroCard } from "../components/NetWorthHeroCard";
import { BudgetBucketProgress } from "../components/BudgetBucketProgress";
import { CalendarActivityGrid } from "../components/CalendarActivityGrid";
import { RecentTransactionsWidget } from "../components/RecentTransactionsWidget";
import { RecurringBillsModal } from "../components/RecurringBillsModal";
import { BankBadge } from "../components/BankBadge";
import { CycleBurdenCard } from "../components/CycleBurdenCard";
import { budgetKeys } from "../lib/queryKeys";
import { usePrivacyMode } from "../lib/usePrivacyMode";

export function OverviewPage({
  data,
  debts,
  cycle: _cycle,
  period,
  onCycleChange: _onCycleChange,
  onPeriodChange,
  onPayInstallment,
  onPayCcCycle,
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
  /** Kartu & Utang data for the Beban Siklus Ini card; the card hides until it loads. */
  debts?: DebtsDto;
  cycle: CycleMode;
  period: string;
  onCycleChange: (cycle: CycleMode) => void;
  onPeriodChange: (period: string) => void;
  onPayInstallment: (installmentId: number) => void;
  onPayCcCycle: (cycleKey: string, installmentIds: number[], ccWalletId?: number) => void;
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
  const { metrics, wallets, budgetAlerts } = data;
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
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      onToast?.("Tagihan rutin berhasil dicatat sebagai pengeluaran");
    },
    onError: (err) => {
      onToast?.(err instanceof ApiError ? err.message : "Gagal mencatat pembayaran tagihan.");
    },
  });
  const liquidWallets = wallets.filter((w) => w.isActive && w.type !== "credit_card");
  const spendingWallets = liquidWallets.filter((w) => w.role !== "savings");
  const savingsWallets = liquidWallets.filter((w) => w.role === "savings");

  const totalSpendable = metrics.totalSpendableCash ?? metrics.totalLiquidCash ?? 0;
  const totalSavings = metrics.totalSavingsCash ?? 0;
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
  const showBurden = data.isCurrentPeriod && Boolean(debts);

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

      {/* 1-2. Arus Kas Siklus Ini & Beban Siklus Ini (side by side on desktop) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 items-stretch">
        <div className={`h-full ${showBurden ? "xl:col-span-7" : "xl:col-span-12"}`}>
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
        {showBurden && debts && (
          <div className="xl:col-span-5">
            <CycleBurdenCard
              data={debts}
              onPayInstallment={onPayInstallment}
              onPayCcCycle={onPayCcCycle}
              onOpenDebts={onOpenDebts}
            />
          </div>
        )}
      </div>

      {/* 3. Progres Pengeluaran */}
      <ErrorBoundary
        fallback={
          <Card className="p-4 text-center text-xs text-[var(--muted-foreground)]">
            Widget progres pengeluaran tidak dapat ditampilkan.
          </Card>
        }
      >
        <BudgetBucketProgress
          budgetBuckets={data.budgetBuckets}
          daysElapsed={daysElapsed}
          daysTotal={daysTotal}
          onOpenBudget={onOpenBudget}
          onOpenGoals={onOpenGoals}
        />
      </ErrorBoundary>

      {/* 4. Kas Harian & Tabungan */}
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

      {/* 5-6. Transaksi Terbaru then Kalender on phone; Kalender on the left on desktop */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-5 lg:order-2">
          <RecentTransactionsWidget
            transactions={data.transactions}
            onOpenTransactions={onOpenTransactions}
          />
        </div>
        <div className="lg:col-span-7 lg:order-1">
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
      </div>

      {/* Zona 3: Grid 2 Kolom Seimbang: Kewajiban Pembayaran (Kiri) & Kontrol Kredit / Peringatan (Kanan) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 items-start">
        {/* Kolom Kiri: Komitmen Pembayaran (Tagihan Rutin) */}
        <div className="space-y-4">
          {/* Tagihan Rutin Siklus Ini: one link while empty, full card once bills exist */}
          {recurringBills.length === 0 ? (
            <button
              type="button"
              onClick={() => setIsRecurringModalOpen(true)}
              className="min-h-[44px] text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              + Tambah tagihan rutin (WiFi, listrik, langganan)
            </button>
          ) : (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-[var(--foreground)]">
                      Tagihan Rutin Siklus Ini
                    </h2>
                    {metrics.unpaidRecurringSum !== undefined && metrics.unpaidRecurringSum > 0 && (
                      <Badge tone="highlight">
                        Sisa: {formatRupiah(metrics.unpaidRecurringSum, isMasked)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {metrics.unpaidRecurringSum === 0 && (
                    <Badge tone="soft">Semua Tagihan Lunas</Badge>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => setIsRecurringModalOpen(true)}
                    className="min-h-[44px] px-3 text-xs"
                  >
                    Kelola
                  </Button>
                </div>
              </div>

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
            </Card>
          )}
        </div>

        {/* Kolom Kanan: Pengawasan Risiko & Limit (Kartu Kredit & Peringatan Anggaran) */}
        <div className="space-y-4">
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

      {/* 7. Total Kekayaan Bersih */}
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
