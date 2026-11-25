import { usePrivacyMode } from "../lib/usePrivacyMode";
import { formatRupiah } from "../lib/format";
import { EyeIcon, EyeOffIcon, TransferIcon } from "./Icons";
import { HelpTooltip } from "./HelpTooltip";

export function DailyHeroCard({
  totalIncome = 0,
  totalExpense = 0,
  installmentExpense = 0,
  todaySpent = 0,
  actions,
  // backwards-compatible optional props:
  dailyAllowance: _dailyAllowance,
  safeToSpend: _safeToSpend,
  upcomingCcCyclesSum: _upcomingCcCyclesSum,
  pacingLabel: _pacingLabel,
  pacingTone: _pacingTone,
}: {
  totalIncome: number;
  totalExpense: number;
  installmentExpense?: number;
  todaySpent?: number;
  actions?: React.ReactNode;
  dailyAllowance?: number;
  safeToSpend?: number;
  upcomingCcCyclesSum?: number;
  pacingLabel?: string;
  pacingTone?: "soft" | "primary" | "highlight" | "danger";
}) {
  const { isMasked, toggle } = usePrivacyMode();

  const netCashflow = totalIncome - totalExpense;
  const isSurplus = netCashflow >= 0;

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-[var(--hero-border)] bg-[var(--hero-bg)] p-5 sm:p-6 text-[var(--hero-card-foreground)] shadow-sm transition-all">
      {/* Top Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
            <TransferIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
            <span>Arus Kas Siklus Ini</span>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
              isSurplus
                ? "bg-[var(--chart-income)]/15 text-[var(--chart-income)] border-[var(--chart-income)]/30"
                : "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30"
            }`}
          >
            {isSurplus ? "Surplus Kas" : "Defisit Kas"}
          </span>
        </div>

        {todaySpent > 0 && (
          <div className="text-right">
            <span className="text-[11px] text-[var(--hero-card-muted)]">
              Belanja hari ini:{" "}
              <strong className="font-mono text-xs font-bold text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(todaySpent, isMasked)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Main Metric: Net Cashflow */}
      <div className="mt-4 relative z-10">
        <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--hero-card-muted)]">
          Selisih Arus Kas (Net Cashflow)
        </span>
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap mt-0.5">
          <p
            className={`tabular-nums font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight ${
              isSurplus ? "text-[var(--chart-income)]" : "text-[var(--destructive)]"
            }`}
          >
            {isSurplus ? "+" : "−"}
            {formatRupiah(Math.abs(netCashflow), isMasked)}
          </p>
          <button
            type="button"
            onClick={toggle}
            title={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
            className="flex h-10 w-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[var(--hero-surface)] text-[var(--hero-card-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--hero-card-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
          >
            {isMasked ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--hero-card-muted)]">
          <span>
            {isSurplus
              ? "Pemasukan lebih besar daripada pengeluaran. Sisa kas siap ditabung atau dialokasikan."
              : "Pengeluaran melebihi pemasukan yang tercatat di siklus ini (atau belum mencatat gaji)."}
          </span>
          <HelpTooltip
            title="Arus Kas Bersih (Net Cashflow)"
            content="Total pemasukan dikurangi seluruh pengeluaran pada siklus berjalan ini. Angka positif menandakan surplus/hemat, sedangkan negatif menandakan defisit."
          />
        </p>
      </div>

      {/* Dual Comparison Cards: Pemasukan vs Pengeluaran */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
        {/* Box Pemasukan */}
        <div className="rounded-[14px] border border-[var(--hero-border)] bg-[var(--hero-surface)] p-3.5 sm:p-4 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--chart-income)]">
              Total Pemasukan
            </span>
            <span className="font-mono text-xl sm:text-2xl font-black text-[var(--chart-income)] tabular-nums block">
              {formatRupiah(totalIncome, isMasked)}
            </span>
            <span className="text-[11px] text-[var(--hero-card-muted)] block">
              Gaji & sumber pendapatan lain
            </span>
          </div>
        </div>

        {/* Box Pengeluaran */}
        <div className="rounded-[14px] border border-[var(--hero-border)] bg-[var(--hero-surface)] p-3.5 sm:p-4 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--destructive)]">
              Total Pengeluaran
            </span>
            <span className="font-mono text-xl sm:text-2xl font-black text-[var(--destructive)] tabular-nums block">
              {formatRupiah(totalExpense, isMasked)}
            </span>
            <span className="text-[11px] text-[var(--hero-card-muted)] block">
              {installmentExpense > 0
                ? `Belanja ${formatRupiah(Math.max(0, totalExpense - installmentExpense), isMasked)} · Cicilan ${formatRupiah(installmentExpense, isMasked)}`
                : "Realisasi belanja siklus ini"}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Actions Row */}
      {actions && (
        <div className="mt-5 border-t border-[var(--hero-border)] pt-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--hero-card-muted)] relative z-10">
          <div className="flex items-center gap-1.5 text-xs text-[var(--hero-card-muted)]">
            <span>
              Kelola pencatatan slip gaji masuk atau anggaran bulanan secara teratur.
            </span>
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
    </div>
  );
}

// Backwards compatibility alias
export const CashflowHeroCard = DailyHeroCard;
export const BudggtHeroCard = DailyHeroCard;
