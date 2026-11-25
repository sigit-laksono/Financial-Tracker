import { useMemo, useState } from "react";
import type { CycleTimelineNode } from "../lib/api";
import { formatCompactRupiah, formatRupiah, formatShortDate } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { AlertIcon, CalendarIcon, CheckIcon, ClockIcon, ShieldIcon } from "./Icons";
import { Badge, Button, Card } from "./UI";

export function CycleTimeline({
  nodes,
  title = "Timeline Siklus & Jatuh Tempo",
  subtitle = "Kronologi tanggal penting siklus kartu kredit, cicilan, piutang, dan gajian.",
  onPayInstallment,
}: {
  nodes: CycleTimelineNode[];
  title?: string;
  subtitle?: string;
  onPayInstallment?: (installmentId: number) => void;
}) {
  const { isMasked } = usePrivacyMode();
  const [filter, setFilter] = useState<"all" | "attention" | "upcoming">("all");

  const counts = useMemo(() => {
    let done = 0;
    let today = 0;
    let upcoming = 0;
    let overdue = 0;
    for (const n of nodes) {
      if (n.status === "done") done++;
      else if (n.status === "due_today") today++;
      else if (n.status === "upcoming") upcoming++;
      else if (n.status === "overdue") overdue++;
    }
    return { done, today, upcoming, overdue, total: nodes.length };
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    if (filter === "attention") {
      return nodes.filter((n) => n.status === "due_today" || n.status === "overdue");
    }
    if (filter === "upcoming") {
      return nodes.filter((n) => n.status === "upcoming" || n.status === "due_today");
    }
    return nodes;
  }, [nodes, filter]);

  const cashflowRiskNotice = useMemo(() => {
    // Only an unpaid card bill is a cash-flow risk; a paid one needs no warning.
    const ccNode = nodes.find((n) => n.category === "cc_payment" && n.status !== "done");
    const gajianNode = nodes.find((n) => n.category === "gajian");
    if (!ccNode || !gajianNode || !ccNode.amount || ccNode.amount <= 0) return null;
    const ccDate = ccNode.date;
    const gajianDate = gajianNode.date;
    if (ccDate < gajianDate) {
      return {
        type: "warning" as const,
        text: `Perhatian Arus Kas: Tagihan kartu kredit jatuh tempo (${formatShortDate(ccDate)}) sebelum hari gajian (${formatShortDate(gajianDate)}). Pastikan kas mencukupi sebelum tanggal tersebut.`,
      };
    }
    return {
      type: "safe" as const,
      text: `Arus Kas Terkendali: Tagihan kartu kredit jatuh tempo (${formatShortDate(ccDate)}) pada/setelah tanggal gajian (${formatShortDate(gajianDate)}).`,
    };
  }, [nodes]);

  const getStatusBadge = (
    status: CycleTimelineNode["status"],
    category?: CycleTimelineNode["category"],
  ) => {
    switch (status) {
      case "done":
        return (
          <Badge tone="soft" className="inline-flex items-center gap-1">
            <CheckIcon className="w-3 h-3" />
            Selesai
          </Badge>
        );
      case "due_today":
        return (
          <Badge tone="highlight" className="inline-flex items-center gap-1.5 font-bold shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
            </span>
            Hari Ini
          </Badge>
        );
      case "overdue":
        return (
          <Badge
            tone={category === "gajian" ? "neutral" : "danger"}
            className="inline-flex items-center gap-1 font-bold"
          >
            <AlertIcon className="w-3 h-3" />
            {category === "gajian" ? "Belum Diterima" : "Terlewat"}
          </Badge>
        );
      default:
        return (
          <Badge tone="neutral" className="inline-flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            Mendatang
          </Badge>
        );
    }
  };

  const getCategoryColor = (category: CycleTimelineNode["category"]) => {
    switch (category) {
      case "cc_cutoff":
      case "cc_statement":
        return "border-l-4 border-l-[var(--muted-foreground)]";
      case "cc_payment":
        return "border-l-4 border-l-[var(--highlight)]";
      case "gajian":
        return "border-l-4 border-l-[var(--chart-income)]";
      case "debt_due":
        return "border-l-4 border-l-[var(--primary)]";
      case "receivable_due":
        return "border-l-4 border-l-[var(--primary)]";
      default:
        return "border-l-4 border-l-[var(--border)]";
    }
  };

  if (!nodes || nodes.length === 0) {
    return (
      <Card className="space-y-2">
        <h3 className="text-base font-bold text-[var(--foreground)]">{title}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Belum ada jadwal jatuh tempo atau siklus tagihan pada periode ini.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      {cashflowRiskNotice && (
        <div
          className={`flex items-start gap-2.5 rounded-[12px] border p-3 text-xs leading-relaxed ${
            cashflowRiskNotice.type === "warning"
              ? "border-[var(--control-border)] bg-[var(--surface)] text-[var(--highlight-text)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--soft-foreground)]"
          }`}
        >
          <span className="shrink-0 mt-0.5" aria-hidden="true">
            {cashflowRiskNotice.type === "warning" ? (
              <AlertIcon className="w-4 h-4 text-[var(--highlight-text)]" />
            ) : (
              <ShieldIcon className="w-4 h-4 text-[var(--chart-income)]" />
            )}
          </span>
          <span className="font-medium">{cashflowRiskNotice.text}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[var(--primary)]" />
            <h2 className="text-base font-bold text-[var(--foreground)]">{title}</h2>
          </div>
          {subtitle && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`min-h-[44px] rounded-[10px] px-3 py-1 font-medium transition-colors ${
              filter === "all"
                ? "bg-[var(--hero)] text-[var(--hero-foreground)] font-bold"
                : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--muted-foreground)]"
            }`}
          >
            Semua ({counts.total})
          </button>
          {(counts.today > 0 || counts.overdue > 0) && (
            <button
              type="button"
              onClick={() => setFilter("attention")}
              className={`min-h-[44px] rounded-[10px] px-3 py-1 font-medium transition-colors ${
                filter === "attention"
                  ? "bg-[var(--highlight)] text-[var(--highlight-foreground)] font-bold"
                  : "border border-[var(--highlight)] text-[var(--highlight-text)] hover:bg-[var(--surface)]"
              }`}
            >
              Perlu Bayar ({counts.today + counts.overdue})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilter("upcoming")}
            className={`min-h-[44px] rounded-[10px] px-3 py-1 font-medium transition-colors ${
              filter === "upcoming"
                ? "bg-[var(--hero)] text-[var(--hero-foreground)] font-bold"
                : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--muted-foreground)]"
            }`}
          >
            Mendatang ({counts.upcoming + counts.today})
          </button>
        </div>
      </div>

      {/* Horizontal Strip for Desktop */}
      <div className="hidden lg:block overflow-x-auto pb-2">
        <div className="flex items-stretch gap-3 min-w-full">
          {filteredNodes.map((node) => {
            const isToday = node.status === "due_today";
            const isOverdue = node.status === "overdue";
            const dayNumber = node.date.split("-")[2];

            return (
              <div
                key={node.id}
                className={`relative flex min-w-[210px] max-w-[240px] flex-col justify-between rounded-[14px] border p-3.5 transition-all ${getCategoryColor(
                  node.category,
                )} ${
                  isToday
                    ? "border-[var(--highlight)] bg-[var(--surface)] shadow-sm"
                    : isOverdue
                      ? "border-[var(--destructive)] bg-[var(--surface)]"
                      : "border-[var(--border)] bg-[var(--card)]"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="tabular-nums font-mono text-xs font-bold text-[var(--muted-foreground)]">
                      Tgl {dayNumber} ({formatShortDate(node.date)})
                    </span>
                    {getStatusBadge(node.status, node.category)}
                  </div>
                  <h3 className="text-sm font-bold leading-tight text-[var(--foreground)] line-clamp-2">
                    {node.title}
                  </h3>
                  {node.badge && (
                    <span className="inline-block rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
                      {node.badge}
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
                  <span className="tabular-nums font-mono text-sm font-extrabold text-[var(--foreground)]">
                    {node.amount !== null ? formatRupiah(node.amount, isMasked) : "-"}
                  </span>
                  {node.installmentId &&
                    (node.status === "due_today" ||
                      node.status === "overdue" ||
                      node.status === "upcoming") &&
                    onPayInstallment && (
                      <Button
                        variant="secondary"
                        onClick={() => onPayInstallment(node.installmentId!)}
                        className="min-h-[44px] px-3 py-1 text-xs"
                      >
                        Bayar
                      </Button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vertical Stepper List for Mobile & Tablet */}
      <div className="lg:hidden divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)]">
        {filteredNodes.map((node) => {
          const isToday = node.status === "due_today";
          const isOverdue = node.status === "overdue";
          const dayNumber = node.date.split("-")[2];

          return (
            <div
              key={node.id}
              className={`flex flex-wrap items-center justify-between gap-3 p-3.5 transition-colors ${getCategoryColor(
                node.category,
              )} ${
                isToday
                  ? "bg-[var(--surface)]"
                  : isOverdue
                    ? "bg-[var(--surface)]"
                    : "bg-[var(--card)]"
              }`}
            >
              <div className="min-w-0 flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border tabular-nums ${
                    isToday
                      ? "border-[var(--highlight)] bg-[var(--highlight)] text-[var(--highlight-foreground)] font-extrabold"
                      : isOverdue
                        ? "border-[var(--destructive)] bg-[var(--destructive)] text-[var(--destructive-foreground)] font-bold"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] font-bold"
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider opacity-80">TGL</span>
                  <span className="text-base font-extrabold leading-none">{dayNumber}</span>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-[var(--foreground)]">{node.title}</span>
                    {getStatusBadge(node.status, node.category)}
                  </div>
                  <p className="tabular-nums text-xs text-[var(--muted-foreground)]">
                    {formatShortDate(node.date)} {node.badge ? `· ${node.badge}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {node.amount !== null && (
                  <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                    {formatCompactRupiah(node.amount, isMasked)}
                  </span>
                )}
                {node.installmentId &&
                  (node.status === "due_today" ||
                    node.status === "overdue" ||
                    node.status === "upcoming") &&
                  onPayInstallment && (
                    <Button
                      variant="secondary"
                      onClick={() => onPayInstallment(node.installmentId!)}
                      className="min-h-[44px] px-3.5 text-xs"
                    >
                      Bayar
                    </Button>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
