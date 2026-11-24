import { useMemo } from "react";
import type { DashboardDto } from "../lib/api";
import { formatRupiah } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";

export function Budget503020Progress({
  budget503020,
  daysElapsed,
  daysTotal,
  onOpenBudget,
  onOpenGoals,
}: {
  budget503020?: DashboardDto["budget503020"];
  daysElapsed: number;
  daysTotal: number;
  onOpenBudget?: () => void;
  onOpenGoals?: () => void;
}) {
  const { isMasked } = usePrivacyMode();

  const progressPercent = useMemo(() => {
    if (!daysTotal) return 0;
    return Math.min(100, Math.round((daysElapsed / daysTotal) * 100));
  }, [daysElapsed, daysTotal]);

  const needs = budget503020?.needs ?? { spent: 0, limit: 0, percent: 0, status: "unconfigured" as const };
  const wants = budget503020?.wants ?? { spent: 0, limit: 0, percent: 0, status: "unconfigured" as const };
  const savings = budget503020?.savings ?? {
    spent: 0,
    target: 0,
    percent: 0,
    status: "unconfigured" as const,
  };

  const isNeedsConfigured = (needs.limit ?? 0) > 0 && needs.status !== "unconfigured";
  const isWantsConfigured = (wants.limit ?? 0) > 0 && wants.status !== "unconfigured";
  const isSavingsConfigured = (savings.target ?? 0) > 0 && savings.status !== "unconfigured";

  const getStatusText = (
    type: "needs" | "wants" | "savings",
    status: string,
    spent: number,
    isConfigured: boolean
  ) => {
    if (!isConfigured) {
      return {
        text: "Harap setup anggaran",
        color: "text-[var(--muted-foreground)] bg-[var(--surface)] border border-[var(--border)]",
      };
    }
    if (type === "savings") {
      if (status === "on_track") {
        return {
          text: "Sesuai rencana",
          color:
            "text-[var(--chart-income)] bg-[var(--chart-income)]/15 border border-[var(--chart-income)]/30",
        };
      }
      if (spent > 0) {
        return {
          text: "Berjalan",
          color:
            "text-[var(--chart-income)] bg-[var(--chart-income)]/15 border border-[var(--chart-income)]/30",
        };
      }
      return {
        text: "Belum menabung",
        color: "text-[var(--muted-foreground)] bg-[var(--surface)] border border-[var(--border)]",
      };
    }
    if (status === "exceeded") {
      return {
        text: "Melebihi jatah",
        color:
          "text-[var(--destructive)] bg-[var(--destructive)]/15 border border-[var(--destructive)]/30",
      };
    }
    if (status === "warning") {
      return {
        text: "Mendekati jatah",
        color:
          "text-[var(--highlight-text)] bg-[var(--highlight)]/15 border border-[var(--highlight)]/30",
      };
    }
    return {
      text: "Masih aman",
      color: "text-[var(--primary)] bg-[var(--primary)]/15 border border-[var(--primary)]/30",
    };
  };

  const needsStatus = getStatusText("needs", needs.status, needs.spent, isNeedsConfigured);
  const wantsStatus = getStatusText("wants", wants.status, wants.spent, isWantsConfigured);
  const savingsStatus = getStatusText("savings", savings.status, savings.spent, isSavingsConfigured);

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 shadow-xs transition-all">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* Left Col: Cycle Day Progress Circle */}
        <div className="lg:col-span-4 flex items-center gap-3.5 sm:border-r sm:border-[var(--border)] lg:pr-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            {/* SVG Progress Circle */}
            <svg
              role="img"
              aria-label={`Hari ${daysElapsed} dari ${daysTotal}`}
              className="h-14 w-14 -rotate-90 transform"
              viewBox="0 0 36 36"
            >
              <path
                className="text-[var(--surface)]"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-[var(--primary)] transition-all duration-500 ease-out"
                strokeDasharray={`${progressPercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute text-center leading-none">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                Hari
              </span>
              <strong className="tabular-nums font-mono text-sm font-extrabold text-[var(--foreground)]">
                {daysElapsed}
              </strong>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[var(--foreground)]">Progres Pengeluaran</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Hari {daysElapsed} dari {daysTotal} ({progressPercent}%)
              </p>
            </div>
            {onOpenBudget && (
              <button
                type="button"
                onClick={onOpenBudget}
                className="inline-flex min-h-[44px] items-center px-2 text-xs font-bold text-[var(--primary)] hover:underline"
              >
                Kelola
              </button>
            )}
          </div>
        </div>

        {/* Right Col: 3 Progress Bars (Needs, Wants, Savings) */}
        <div className="lg:col-span-8 space-y-3.5">
          {/* 1. Kebutuhan (Needs) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                  KEBUTUHAN
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${needsStatus.color}`}
                >
                  {needsStatus.text}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isNeedsConfigured ? (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(needs.spent, isMasked)} / {formatRupiah(needs.limit, isMasked)}
                    </span>
                    <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                      {needs.percent}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(needs.spent, isMasked)}
                    </span>
                    <span className="text-[11px] italic text-[var(--muted-foreground)]">
                      (Belum ada jatah)
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
              {isNeedsConfigured && (
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    needs.status === "exceeded"
                      ? "bg-[var(--destructive)]"
                      : needs.status === "warning"
                        ? "bg-[var(--highlight)]"
                        : "bg-[var(--primary)]"
                  }`}
                  style={{ width: `${Math.min(100, needs.percent)}%` }}
                />
              )}
            </div>
          </div>

          {/* 2. Keinginan (Wants) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                  KEINGINAN
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${wantsStatus.color}`}
                >
                  {wantsStatus.text}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isWantsConfigured ? (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(wants.spent, isMasked)} / {formatRupiah(wants.limit, isMasked)}
                    </span>
                    <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                      {wants.percent}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(wants.spent, isMasked)}
                    </span>
                    <span className="text-[11px] italic text-[var(--muted-foreground)]">
                      (Belum ada jatah)
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
              {isWantsConfigured && (
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    wants.status === "exceeded"
                      ? "bg-[var(--destructive)]"
                      : wants.status === "warning"
                        ? "bg-[var(--highlight)]"
                        : "bg-[var(--primary)]"
                  }`}
                  style={{ width: `${Math.min(100, wants.percent)}%` }}
                />
              )}
            </div>
          </div>

          {/* 3. Tabungan (Savings) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                  TABUNGAN & HUTANG
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${savingsStatus.color}`}
                >
                  {savingsStatus.text}
                </span>
                {onOpenGoals && (
                  <button
                    type="button"
                    onClick={onOpenGoals}
                    className="inline-flex min-h-[44px] items-center px-2 text-xs font-bold text-[var(--primary)] hover:underline"
                  >
                    Target
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {isSavingsConfigured ? (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(savings.spent, isMasked)} / {formatRupiah(savings.target, isMasked)}
                    </span>
                    <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                      {savings.percent}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                      {formatRupiah(savings.spent, isMasked)}
                    </span>
                    <span className="text-[11px] italic text-[var(--muted-foreground)]">
                      (Belum ada jatah)
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
              {isSavingsConfigured && (
                <div
                  className="h-full rounded-full bg-[var(--chart-income)] transition-all duration-500"
                  style={{ width: `${Math.min(100, savings.percent)}%` }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
