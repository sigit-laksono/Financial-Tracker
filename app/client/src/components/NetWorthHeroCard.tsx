import { usePrivacyMode } from "../lib/usePrivacyMode";
import { formatRupiah } from "../lib/format";
import { AssetIcon, EyeIcon, EyeOffIcon } from "./Icons";
import { Badge } from "./UI";

export function NetWorthHeroCard({
  totalNetWorth,
  totalAssets,
  totalLiabilities,
  actions,
  showPrivacyToggle = false,
}: {
  totalNetWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  totalIncome?: number;
  totalExpense?: number;
  actions?: React.ReactNode;
  showPrivacyToggle?: boolean;
}) {
  const { isMasked, toggle } = usePrivacyMode();
  const isPositive = totalNetWorth >= 0;

  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[20px] border border-[var(--hero-border)] bg-[var(--hero-bg)] p-5 sm:p-6 text-[var(--hero-card-foreground)] shadow-sm transition-all">
      <div>
        {/* Top Row: Title Badge */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <AssetIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Kekayaan Bersih</span>
            </div>
            <Badge
              tone={isMasked ? "neutral" : isPositive ? "soft" : "danger"}
              className="text-[11px] font-bold px-2 py-0.5"
            >
              {isMasked ? "Mode Privasi" : isPositive ? "Net Worth Positif" : "Defisit Bersih"}
            </Badge>
          </div>
        </div>

        {/* Main Metric: Total Net Worth */}
        <div className="relative z-10 mt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2
              className={`tabular-nums font-mono text-3xl sm:text-4xl font-black tracking-tight ${
                isMasked || isPositive
                  ? "text-[var(--hero-card-foreground)]"
                  : "text-[var(--destructive)]"
              }`}
            >
              {!isMasked && !isPositive ? "−" : ""}
              {formatRupiah(Math.abs(totalNetWorth), isMasked)}
            </h2>
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

          {/* 2-Column Breakdown: Total Aset | Liabilitas */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-[12px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--hero-card-muted)]">
                Total Aset
              </span>
              <strong
                className={`mt-1 block metric-value-compact font-extrabold ${
                  isMasked ? "text-[var(--hero-card-foreground)]" : "text-[var(--chart-income)]"
                }`}
              >
                {formatRupiah(totalAssets, isMasked)}
              </strong>
            </div>

            <div className="rounded-[12px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--hero-card-muted)]">
                Liabilitas
              </span>
              <strong
                className={`mt-1 block metric-value-compact font-extrabold ${
                  isMasked ? "text-[var(--hero-card-foreground)]" : "text-[var(--destructive)]"
                }`}
              >
                {formatRupiah(totalLiabilities, isMasked)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {actions && (
        <div className="relative z-10 mt-5 border-t border-[var(--hero-border)] pt-3.5 flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
