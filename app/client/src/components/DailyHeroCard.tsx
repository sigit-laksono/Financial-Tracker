import { usePrivacyMode } from "../lib/usePrivacyMode";
import { formatRupiah } from "../lib/format";
import { EyeIcon, EyeOffIcon, TransferIcon } from "./Icons";
import { HelpTooltip } from "./HelpTooltip";
import { Badge } from "./UI";

export function DailyHeroCard({
  totalIncome = 0,
  totalExpense = 0,
  todaySpent = 0,
  actions,
  showPrivacyToggle = false,
  // backwards-compatible optional props:
  installmentExpense: _installmentExpense,
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
  showPrivacyToggle?: boolean;
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
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[20px] border border-[var(--hero-border)] bg-[var(--hero-bg)] p-5 sm:p-6 text-[var(--hero-card-foreground)] shadow-sm transition-all">
      <div>
        {/* Top Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <TransferIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Arus Kas Siklus Ini</span>
            </div>
            <Badge
              tone={isMasked ? "neutral" : isSurplus ? "soft" : "danger"}
              className="text-[11px] font-bold px-2 py-0.5"
            >
              {isMasked ? "Mode Privasi" : isSurplus ? "Surplus Kas" : "Defisit Kas"}
            </Badge>
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
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--hero-card-muted)]">
              Selisih Arus Kas
            </span>
            <HelpTooltip
              title="Arus Kas Bersih (Net Cashflow)"
              content="Total pemasukan dikurangi seluruh pengeluaran pada siklus berjalan ini. Angka positif menandakan surplus/hemat, sedangkan negatif menandakan defisit."
            />
          </div>
          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap mt-0.5">
            <p
              className={`tabular-nums font-mono text-3xl sm:text-4xl font-black tracking-tight ${
                isMasked
                  ? "text-[var(--hero-card-foreground)]"
                  : isSurplus
                    ? "text-[var(--chart-income)]"
                    : "text-[var(--destructive)]"
              }`}
            >
              {isMasked ? "" : isSurplus ? "+" : "−"}
              {formatRupiah(Math.abs(netCashflow), isMasked)}
            </p>
            {showPrivacyToggle && (
              <button
                type="button"
                onClick={toggle}
                title={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
                className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[var(--hero-surface)] text-[var(--hero-card-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--hero-card-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                aria-label={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
              >
                {isMasked ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Dual Comparison Cards: Pemasukan vs Pengeluaran */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 relative z-10">
          {/* Box Pemasukan */}
          <div className="rounded-[12px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-3 sm:p-3.5">
            <span
              className={`block text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider ${
                isMasked ? "text-[var(--hero-card-muted)]" : "text-[var(--chart-income)]"
              }`}
            >
              Total Pemasukan
            </span>
            <span
              className={`mt-1 block metric-value-compact font-black ${
                isMasked ? "text-[var(--hero-card-foreground)]" : "text-[var(--chart-income)]"
              }`}
            >
              {formatRupiah(totalIncome, isMasked)}
            </span>
          </div>

          {/* Box Pengeluaran */}
          <div className="rounded-[12px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-3 sm:p-3.5">
            <span
              className={`block text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider ${
                isMasked ? "text-[var(--hero-card-muted)]" : "text-[var(--destructive)]"
              }`}
            >
              Total Pengeluaran
            </span>
            <span
              className={`mt-1 block metric-value-compact font-black ${
                isMasked ? "text-[var(--hero-card-foreground)]" : "text-[var(--destructive)]"
              }`}
            >
              {formatRupiah(totalExpense, isMasked)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Actions Row */}
      {actions && (
        <div className="relative z-10 mt-5 border-t border-[var(--hero-border)] pt-3.5 flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

// Backwards compatibility alias
export const CashflowHeroCard = DailyHeroCard;
export const BudggtHeroCard = DailyHeroCard;
