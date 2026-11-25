import type { TransactionDto } from "../lib/api";
import { formatRupiah, formatShortDate } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { ReceiptIcon } from "./Icons";
import { ErrorBoundary } from "./UI";
import { CashflowSparkline, type DailyDataPoint } from "./CashflowSparkline";

export function RecentTransactionsWidget({
  transactions = [],
  dailyTotals,
  onOpenTransactions,
  onAddTransaction,
}: {
  transactions?: TransactionDto[];
  dailyTotals?: DailyDataPoint[];
  onOpenTransactions: () => void;
  onAddTransaction?: () => void;
}) {
  const { isMasked } = usePrivacyMode();
  const maxItems = dailyTotals && dailyTotals.length > 0 ? 3 : 5;
  const recentItems = transactions.slice(0, maxItems);

  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 shadow-xs transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--foreground)]">Transaksi Terbaru</h2>
          <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
            Aktivitas pengeluaran & pemasukan
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenTransactions}
          className="inline-flex min-h-[36px] items-center px-2 text-xs font-bold text-[var(--primary)] hover:underline"
        >
          Lihat Semua
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 py-3">
        {recentItems.length === 0 ? (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center p-6 text-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--muted-foreground)] mb-2"
              aria-hidden="true"
            >
              <ReceiptIcon className="w-6 h-6" />
            </span>
            <p className="text-sm font-semibold text-[var(--foreground)]">Belum ada data</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Transaksi pada siklus ini akan muncul di sini.
            </p>
            {onAddTransaction && (
              <button
                type="button"
                onClick={onAddTransaction}
                className="mt-3 inline-flex min-h-[36px] items-center rounded-lg bg-[var(--surface)] px-3 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--border)]"
              >
                + Catat Transaksi
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {recentItems.map((tx) => {
              const isInflow =
                tx.type === "income" ||
                tx.type === "debt_collection" ||
                tx.type === "loan_disbursement";
              const isTransfer = tx.type === "transfer";

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-colors hover:border-[var(--control-border)]"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        isMasked
                          ? "bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)]"
                          : isInflow
                            ? "bg-[var(--chart-income)]/15 text-[var(--chart-income)]"
                            : isTransfer
                              ? "bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)]"
                              : "bg-[var(--destructive)]/15 text-[var(--destructive)]"
                      }`}
                    >
                      {isInflow ? "↓" : isTransfer ? "⇄" : "↑"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs sm:text-sm font-bold text-[var(--foreground)]">
                        {tx.merchant || tx.category}
                      </p>
                      <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                        {tx.category} · {tx.walletName}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p
                      className={`tabular-nums font-mono text-xs font-bold ${
                        isMasked
                          ? "text-[var(--muted-foreground)]"
                          : isInflow
                            ? "text-[var(--chart-income)]"
                            : isTransfer
                              ? "text-[var(--foreground)]"
                              : "text-[var(--destructive)]"
                      }`}
                    >
                      {isMasked ? "" : isInflow ? "+" : isTransfer ? "" : "−"}
                      {formatRupiah(tx.amount, isMasked)}
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      {formatShortDate(tx.transactionDate)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Integrated Tren Belanja 7 Hari */}
      {dailyTotals && dailyTotals.length > 0 && (
        <div className="border-t border-[var(--border)] pt-3 mt-auto">
          <ErrorBoundary
            fallback={
              <p className="text-xs text-[var(--muted-foreground)]">
                Tren belanja tidak dapat dimuat.
              </p>
            }
          >
            <CashflowSparkline data={dailyTotals} days={7} variant="embedded" />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
