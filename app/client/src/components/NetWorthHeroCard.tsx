import { usePrivacyMode } from "../lib/usePrivacyMode";
import { formatRupiah } from "../lib/format";
import { AssetIcon, EyeIcon, EyeOffIcon } from "./Icons";

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
          <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
            <AssetIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
            <span>Total Kekayaan Bersih</span>
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

          {/* One line: Aset · Utang */}
          <p className="mt-2 text-xs text-[var(--hero-card-muted)]">
            Aset{" "}
            <strong className="tabular-nums font-mono font-bold text-[var(--hero-card-foreground)]">
              {formatRupiah(totalAssets, isMasked)}
            </strong>{" "}
            · Utang{" "}
            <strong className="tabular-nums font-mono font-bold text-[var(--hero-card-foreground)]">
              {formatRupiah(totalLiabilities, isMasked)}
            </strong>
          </p>
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
