import { useMemo } from "react";
import type { DashboardDto } from "../lib/api";
import { formatRupiah } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { Badge, Button } from "./UI";

export function BudgetBucketProgress({
  budgetBuckets,
  daysElapsed,
  daysTotal,
  onOpenBudget,
  onOpenGoals,
}: {
  budgetBuckets?: DashboardDto["budgetBuckets"];
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

  const needs = budgetBuckets?.needs ?? {
    spent: 0,
    limit: 0,
    percent: 0,
    status: "unconfigured" as const,
  };
  const wants = budgetBuckets?.wants ?? {
    spent: 0,
    limit: 0,
    percent: 0,
    status: "unconfigured" as const,
  };
  const savings = budgetBuckets?.savings ?? {
    spent: 0,
    target: 0,
    percent: 0,
    status: "unconfigured" as const,
  };

  const isNeedsConfigured = (needs.limit ?? 0) > 0 && needs.status !== "unconfigured";
  const isWantsConfigured = (wants.limit ?? 0) > 0 && wants.status !== "unconfigured";
  const isSavingsConfigured = (savings.target ?? 0) > 0 && savings.status !== "unconfigured";
  const isAllUnconfigured = !isNeedsConfigured && !isWantsConfigured && !isSavingsConfigured;

  const getStatusBadge = (
    type: "needs" | "wants" | "savings",
    status: string,
    spent: number,
    isConfigured: boolean,
  ): { text: string; tone: "neutral" | "primary" | "soft" | "highlight" | "danger" } => {
    if (!isConfigured) {
      return { text: "Belum diatur", tone: "neutral" };
    }
    if (type === "savings") {
      if (status === "on_track" || spent > 0) {
        return { text: status === "on_track" ? "Sesuai rencana" : "Berjalan", tone: "soft" };
      }
      return { text: "Belum menabung", tone: "neutral" };
    }
    if (status === "exceeded") {
      return { text: "Melebihi jatah", tone: "danger" };
    }
    if (status === "warning") {
      return { text: "Mendekati jatah", tone: "highlight" };
    }
    return { text: "Masih aman", tone: "primary" };
  };

  const needsStatus = getStatusBadge("needs", needs.status, needs.spent, isNeedsConfigured);
  const wantsStatus = getStatusBadge("wants", wants.status, wants.spent, isWantsConfigured);
  const savingsStatus = getStatusBadge(
    "savings",
    savings.status,
    savings.spent,
    isSavingsConfigured,
  );

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 shadow-xs transition-all">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* Left Col: Cycle Day Progress Circle */}
        <div className="lg:col-span-4 flex items-center gap-3.5 lg:border-r lg:border-[var(--border)] lg:pr-4">
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

          <div className="flex-1 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[var(--foreground)]">Progres Pengeluaran</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Sisa {Math.max(0, daysTotal - daysElapsed)} hari
              </p>
            </div>
            {onOpenBudget && !isAllUnconfigured && (
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

        {/* Right Col: Single Empty State OR 3 Progress Bars */}
        <div className="lg:col-span-8">
          {isAllUnconfigured ? (
            <div className="flex flex-col gap-3 rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-[var(--foreground)]">
                    Anggaran Siklus Belum Diatur
                  </p>
                  <Badge tone="info" className="text-[10px]">
                    Panduan Siklus
                  </Badge>
                </div>
                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                  Atur batas budget <strong className="text-[var(--foreground)]">Kebutuhan</strong>,{" "}
                  <strong className="text-[var(--foreground)]">Keinginan</strong>, dan target{" "}
                  <strong className="text-[var(--foreground)]">Tabungan &amp; Utang</strong> siklus
                  ini.
                </p>
              </div>
              {onOpenBudget && (
                <Button
                  variant="primary"
                  onClick={onOpenBudget}
                  className="shrink-0 w-full sm:w-auto text-xs px-4"
                >
                  Atur Anggaran
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* 1. Kebutuhan (Needs) */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                      KEBUTUHAN
                    </span>
                    {isNeedsConfigured && (
                      <Badge tone={needsStatus.tone} className="text-[10px] px-1.5 py-0.5">
                        {needsStatus.text}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isNeedsConfigured ? (
                      <>
                        <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                          {formatRupiah(needs.spent, isMasked)} /{" "}
                          {formatRupiah(needs.limit, isMasked)}
                        </span>
                        <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                          {needs.percent}%
                        </span>
                      </>
                    ) : (
                      <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                        {formatRupiah(needs.spent, isMasked)}
                      </span>
                    )}
                  </div>
                </div>
                {isNeedsConfigured && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
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
                  </div>
                )}
              </div>

              {/* 2. Keinginan (Wants) */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                      KEINGINAN
                    </span>
                    {isWantsConfigured && (
                      <Badge tone={wantsStatus.tone} className="text-[10px] px-1.5 py-0.5">
                        {wantsStatus.text}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isWantsConfigured ? (
                      <>
                        <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                          {formatRupiah(wants.spent, isMasked)} /{" "}
                          {formatRupiah(wants.limit, isMasked)}
                        </span>
                        <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                          {wants.percent}%
                        </span>
                      </>
                    ) : (
                      <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                        {formatRupiah(wants.spent, isMasked)}
                      </span>
                    )}
                  </div>
                </div>
                {isWantsConfigured && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
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
                  </div>
                )}
              </div>

              {/* 3. Tabungan (Savings) */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[var(--foreground)] tracking-wide">
                      TABUNGAN &amp; UTANG
                    </span>
                    {isSavingsConfigured && (
                      <Badge tone={savingsStatus.tone} className="text-[10px] px-1.5 py-0.5">
                        {savingsStatus.text}
                      </Badge>
                    )}
                    {onOpenGoals && (
                      <button
                        type="button"
                        onClick={onOpenGoals}
                        className="inline-flex min-h-[44px] items-center px-1.5 text-xs font-bold text-[var(--primary)] hover:underline"
                      >
                        Target
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isSavingsConfigured ? (
                      <>
                        <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                          {formatRupiah(savings.spent, isMasked)} /{" "}
                          {formatRupiah(savings.target, isMasked)}
                        </span>
                        <span className="tabular-nums font-mono font-bold text-[var(--foreground)]">
                          {savings.percent}%
                        </span>
                      </>
                    ) : (
                      <span className="tabular-nums font-mono text-[11px] text-[var(--muted-foreground)]">
                        {formatRupiah(savings.spent, isMasked)}
                      </span>
                    )}
                  </div>
                </div>
                {isSavingsConfigured ? (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
                    <div
                      className="h-full rounded-full bg-[var(--chart-income)] transition-all duration-500"
                      style={{ width: `${Math.min(100, savings.percent)}%` }}
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Cicilan, utang &amp; tabungan yang dibayar siklus ini
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
