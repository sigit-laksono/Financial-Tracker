import { useMemo, useState } from "react";
import type { DashboardDto } from "../lib/api";
import { formatPeriodRangeLabel, formatRupiah, formatShortDate } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";

const EMPTY_SLOT_KEYS = ["slot-0", "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"];

export function CalendarActivityGrid({
  calendarHeatmap = [],
  today,
  periodStart,
  periodEnd,
}: {
  calendarHeatmap?: NonNullable<DashboardDto["calendarHeatmap"]>;
  today: string;
  periodStart?: string;
  periodEnd?: string;
}) {
  const { isMasked } = usePrivacyMode();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const rangeStart = periodStart || calendarHeatmap[0]?.date || "";
  const rangeEnd = periodEnd || calendarHeatmap[calendarHeatmap.length - 1]?.date || "";

  const cycleRangeLabel = useMemo(() => {
    if (rangeStart && rangeEnd) {
      return formatPeriodRangeLabel(rangeStart, rangeEnd).replace(" - ", " – ").toUpperCase();
    }
    if (!today) return "";
    const date = new Date(`${today}T00:00:00Z`);
    return new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(date)
      .toUpperCase();
  }, [rangeStart, rangeEnd, today]);

  // Compute offset of the first rendered day (Monday = 0 ... Sunday = 6)
  const emptyDaysBefore = useMemo(() => {
    const firstDateStr =
      calendarHeatmap[0]?.date ?? periodStart ?? (today ? `${today.slice(0, 7)}-01` : "");
    if (!firstDateStr) return 0;
    const firstDay = new Date(`${firstDateStr}T00:00:00Z`);
    const dayOfWeek = firstDay.getUTCDay();
    return (dayOfWeek + 6) % 7;
  }, [calendarHeatmap, periodStart, today]);

  const maxExpense = useMemo(() => {
    return calendarHeatmap.reduce((max, item) => Math.max(item.expense, max), 0);
  }, [calendarHeatmap]);

  const activeDetail = useMemo(() => {
    if (!selectedDay) return null;
    return calendarHeatmap.find((d) => d.date === selectedDay) ?? null;
  }, [selectedDay, calendarHeatmap]);

  const weekHeaders = ["SN", "SL", "RB", "KM", "JM", "SB", "MG"];

  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 shadow-xs transition-all">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">Aktivitas Siklus Ini</h2>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              {cycleRangeLabel}
            </span>
          </div>
          {selectedDay && activeDetail && (
            <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs">
              <span className="text-[var(--muted-foreground)]">
                {formatShortDate(activeDetail.date)}:
              </span>
              {activeDetail.expense > 0 ? (
                <span
                  className={`tabular-nums font-mono font-bold ${
                    isMasked ? "text-[var(--foreground)]" : "text-[var(--destructive)]"
                  }`}
                >
                  {formatRupiah(activeDetail.expense, isMasked)}
                </span>
              ) : (
                <span className="text-[var(--chart-income)] font-semibold">Tidak ada belanja</span>
              )}
              <button
                type="button"
                aria-label="Tutup detail tanggal"
                onClick={() => setSelectedDay(null)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* 7-column weekday headers & days */}
        <div className="mt-2 grid grid-cols-7 gap-1 text-center">
          {weekHeaders.map((day) => (
            <div
              key={day}
              className="text-[10px] font-extrabold text-[var(--muted-foreground)] tracking-wider pt-0.5 pb-0.5"
            >
              {day}
            </div>
          ))}

          {/* Empty slots before first day */}
          {EMPTY_SLOT_KEYS.slice(0, emptyDaysBefore).map((slotKey) => (
            <div key={slotKey} className="h-10 sm:h-11" aria-hidden="true" />
          ))}

          {/* Days of the cycle */}
          {calendarHeatmap.map((item) => {
            const dayNumber = Number.parseInt(item.date.split("-")[2]!, 10);
            const hasExpense = item.expense > 0;
            const isSelected = selectedDay === item.date;
            const ratio = hasExpense && maxExpense > 0 ? item.expense / maxExpense : 0;
            const heatLevel = !hasExpense ? 0 : ratio <= 0.34 ? 1 : ratio <= 0.67 ? 2 : 3;
            const heatBgClass =
              heatLevel === 1
                ? "bg-rose-50/90 dark:bg-rose-950/35"
                : heatLevel === 2
                  ? "bg-rose-100/95 dark:bg-rose-900/50"
                  : heatLevel === 3
                    ? "bg-rose-200/90 dark:bg-rose-800/65"
                    : "bg-transparent";

            return (
              <button
                key={item.date}
                type="button"
                onClick={() => setSelectedDay(selectedDay === item.date ? null : item.date)}
                title={
                  hasExpense
                    ? `${formatShortDate(item.date)}: ${formatRupiah(item.expense, isMasked)}`
                    : `${formatShortDate(item.date)}: Tidak ada belanja`
                }
                aria-label={`${formatShortDate(item.date)}${
                  hasExpense ? `, belanja ${formatRupiah(item.expense, isMasked)}` : ", tidak ada belanja"
                }`}
                className={`group relative flex min-h-[44px] h-11 flex-col items-center justify-between rounded-[10px] p-1 transition-all ${
                  item.isToday
                    ? `border-2 border-[var(--primary)] ${heatLevel > 0 ? heatBgClass : "bg-[var(--surface)]"} font-bold shadow-xs ring-1 ring-[var(--primary)]/30`
                    : isSelected
                      ? `border border-[var(--primary)] ${heatLevel > 0 ? heatBgClass : "bg-[var(--surface)]"} ring-1 ring-[var(--primary)]/20`
                      : `border border-transparent ${heatBgClass} hover:border-[var(--control-border)] ${heatLevel === 0 ? "hover:bg-[var(--surface)]" : ""}`
                }`}
              >
                <span
                  className={`text-[11px] tabular-nums font-mono ${
                    item.isToday || heatLevel >= 2
                      ? "text-[var(--foreground)] font-extrabold"
                      : "text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]"
                  }`}
                >
                  {dayNumber}
                </span>

                {/* Expense indicator dot */}
                <div className="flex h-2.5 items-center justify-center">
                  {hasExpense ? (
                    <span
                      className={`rounded-full ${
                        isMasked
                          ? "bg-[var(--muted-foreground)]"
                          : "bg-[var(--destructive)]"
                      } ${heatLevel === 3 ? "h-2 w-2" : "h-1.5 w-1.5"}`}
                    />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-transparent" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Heatmap Legend Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--muted-foreground)]">
        <span>Ketuk tanggal untuk rincian belanja</span>
        <div className="flex items-center gap-1.5">
          <span>Ringan</span>
          <span
            className="h-3 w-3 rounded-[4px] border border-[var(--border)] bg-rose-50/90 dark:bg-rose-950/35"
            aria-hidden="true"
          />
          <span
            className="h-3 w-3 rounded-[4px] border border-[var(--border)] bg-rose-100/95 dark:bg-rose-900/50"
            aria-hidden="true"
          />
          <span
            className="h-3 w-3 rounded-[4px] border border-[var(--border)] bg-rose-200/90 dark:bg-rose-800/65"
            aria-hidden="true"
          />
          <span>Tinggi</span>
        </div>
      </div>
    </div>
  );
}
