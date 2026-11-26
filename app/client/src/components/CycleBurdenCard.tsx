import { useMemo } from "react";
import type { DebtsDto } from "../lib/api";
import { formatPeriodRangeLabel, formatRupiah, formatShortDate, jakartaToday } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { Button } from "./UI";

/** Whole days from `today` to `isoDate` (negative when overdue). */
export function daysUntil(isoDate: string, today: string): number {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function dueCountdownLabel(days: number): string {
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  if (days > 1) return `${days} hari lagi`;
  return `Terlambat ${Math.abs(days)} hari`;
}

/** Overdue or due within 3 days: shown in the destructive color. */
export function isDueUrgent(days: number): boolean {
  return days <= 3;
}

type ObligationItem =
  | {
      type: "installment";
      key: string;
      dueDate: string;
      amount: number;
      installment: DebtsDto["installments"][number];
    }
  | {
      type: "cc_bill";
      key: string;
      dueDate: string;
      amount: number;
      walletId: number;
      walletName: string;
      cycleKey: string;
      unpaidInstallmentIds: number[];
    };

const MAX_CYCLE_ITEMS = 3;

/**
 * Beban Siklus Ini: payable bills due by the end of the current salary (gajian) cycle,
 * overdue ones included. Shared by Home and the Kartu & Utang summary.
 */
export function CycleBurdenCard({
  data,
  onPayInstallment,
  onPayCcCycle,
  onOpenDebts,
}: {
  data: DebtsDto;
  onPayInstallment: (installmentId: number) => void;
  onPayCcCycle: (cycleKey: string, installmentIds: number[], ccWalletId?: number) => void;
  /** When set, the header shows a "Kelola" link to the Kartu & Utang page. */
  onOpenDebts?: () => void;
}) {
  const { isMasked } = usePrivacyMode();
  const today = jakartaToday();
  const cards = data.cards ?? [];

  // Card installments are billed inside their card's CC cycle bill; listing them
  // separately would count them twice.
  const cardInstallmentAccountIds = useMemo(() => {
    const cardIds = new Set(cards.map((c) => c.walletId));
    return new Set(
      data.accounts
        .filter(
          (a) =>
            a.kind === "card_installment" &&
            ((a.walletId !== null && cardIds.has(a.walletId)) ||
              (a.walletId === null && cards.length === 1)),
        )
        .map((a) => a.id),
    );
  }, [data.accounts, cards]);

  // Upcoming payable obligations: unpaid installments + closed, unpaid CC cycle bills.
  const payableObligations = useMemo<ObligationItem[]>(() => {
    const installmentItems: ObligationItem[] = data.installments
      .filter(
        (i) =>
          !i.accountClosed &&
          i.status === "upcoming" &&
          i.direction !== "receivable" &&
          !cardInstallmentAccountIds.has(i.accountId),
      )
      .map((i) => ({
        type: "installment",
        key: `inst-${i.id}`,
        dueDate: i.dueDate,
        amount: i.plannedAmount,
        installment: i,
      }));
    const ccItems: ObligationItem[] = cards.flatMap((card) =>
      card.cycleSummaries
        .filter((c) => c.remainingBill > 0 && c.closingDate <= today)
        .map((c) => ({
          type: "cc_bill" as const,
          key: `cc-${card.walletId}-${c.cycleKey}`,
          dueDate: c.dueDate,
          amount: c.remainingBill,
          walletId: card.walletId,
          walletName: card.walletName,
          cycleKey: c.cycleKey,
          unpaidInstallmentIds: c.unpaidInstallmentIds,
        })),
    );
    return [...installmentItems, ...ccItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [data.installments, cards, cardInstallmentAccountIds, today]);

  const cycleObligations = payableObligations.filter((o) => o.dueDate <= data.gajianCycle.end);
  const cycleDebtBurden = cycleObligations.reduce((sum, o) => sum + o.amount, 0);
  const nextPayable = payableObligations.find((o) => o.dueDate > data.gajianCycle.end) ?? null;
  const obligationName = (o: ObligationItem) =>
    o.type === "cc_bill" ? `Tagihan ${o.walletName}` : o.installment.accountName;

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 sm:px-5 sm:py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <span className="block text-[11px] font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
            Beban Siklus Ini
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            {formatPeriodRangeLabel(data.gajianCycle.start, data.gajianCycle.end)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p
            className={`metric-value-compact font-extrabold whitespace-nowrap tabular-nums ${
              isMasked ? "text-[var(--foreground)]" : "text-[var(--highlight-text)]"
            }`}
          >
            {formatRupiah(cycleDebtBurden, isMasked)}
          </p>
          {onOpenDebts && (
            <button
              type="button"
              onClick={onOpenDebts}
              className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-[var(--primary)] hover:underline"
            >
              Kelola
            </button>
          )}
        </div>
      </div>

      {cycleObligations.length > 0 ? (
        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {cycleObligations.slice(0, MAX_CYCLE_ITEMS).map((o) => {
            const days = daysUntil(o.dueDate, today);
            const isPayroll = o.type === "installment" && o.installment.accountKind === "payroll";
            return (
              <div key={o.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--foreground)]">
                    {obligationName(o)}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {formatShortDate(o.dueDate)} ·{" "}
                    <span
                      className={
                        isDueUrgent(days) ? "font-bold text-[var(--destructive)]" : "font-semibold"
                      }
                    >
                      {dueCountdownLabel(days)}
                    </span>
                    {isPayroll ? " · Potong gaji otomatis" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                    {formatRupiah(o.amount, isMasked)}
                  </span>
                  {o.type === "cc_bill" ? (
                    <Button
                      onClick={() => onPayCcCycle(o.cycleKey, o.unpaidInstallmentIds, o.walletId)}
                      className="min-h-[36px] px-3 text-xs"
                    >
                      Bayar
                    </Button>
                  ) : (
                    !isPayroll && (
                      <Button
                        onClick={() => onPayInstallment(o.installment.id)}
                        className="min-h-[36px] px-3 text-xs"
                      >
                        Bayar
                      </Button>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {cycleObligations.length > MAX_CYCLE_ITEMS && (
            <p className="pt-2.5 text-xs text-[var(--muted-foreground)]">
              +{cycleObligations.length - MAX_CYCLE_ITEMS} tagihan lainnya di siklus ini
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">
          Tidak ada tagihan di siklus ini.
          {nextPayable && (
            <>
              {" "}
              Berikutnya:{" "}
              <strong className="text-[var(--foreground)]">{obligationName(nextPayable)}</strong> ·{" "}
              {formatShortDate(nextPayable.dueDate)} ·{" "}
              {dueCountdownLabel(daysUntil(nextPayable.dueDate, today))}
            </>
          )}
        </p>
      )}
    </div>
  );
}
