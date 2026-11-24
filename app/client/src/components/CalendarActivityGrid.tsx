import { useMemo, useState } from "react";
import type { DashboardDto } from "../lib/api";
import { formatRupiah, formatShortDate } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";

const EMPTY_SLOT_KEYS = ["slot-0", "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"];

export function CalendarActivityGrid({
  calendarHeatmap = [],
  today,
}: {
  calendarHeatmap?: NonNullable<DashboardDto["calendarHeatmap"]>;
  today: string;
}) {
  const { isMasked } = usePrivacyMode();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthLabel = useMemo(() => {
    if (!today) return "";
    const date = new Date(`${today}T00:00:00Z`);
    return new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(date)
      .toUpperCase();
  }, [today]);

  // Compute offset of the 1st day of the month (Monday = 0 ... Sunday = 6)
  const emptyDaysBefore = useMemo(() => {
    if (!today) return 0;
    const firstDay = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    // getUTCDay: 0 = Sun, 1 = Mon, ..., 6 = Sat
    const dayOfWeek = firstDay.getUTCDay();
    // In Indonesia calendar starts Monday (SN): Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
    return (dayOfWeek + 6) % 7;
  }, [today]);

  const activeDetail = useMemo(() => {
    if (!selectedDay) return null;
    return calendarHeatmap.find((d) => d.date === selectedDay) ?? null;
  }, [selectedDay, calendarHeatmap]);

  const weekHeaders = ["SN", "SL", "RB", "KM", "JM", "SB", "MG"];

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 shadow-xs transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--foreground)]">Aktivitas Bulan Ini</h2>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
            {monthLabel}
          </span>
        </div>
        {selectedDay && activeDetail && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted-foreground)]">
              {formatShortDate(activeDetail.date)}:
            </span>
            {activeDetail.expense > 0 ? (
              <span className="tabular-nums font-mono font-bold text-[var(--destructive)]">
                {formatRupiah(activeDetail.expense, isMasked)}
              </span>
            ) : (
              <span className="text-[var(--chart-income)] font-semibold">Tidak ada belanja</span>
            )}
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 7-column weekday headers */}
      <div className="mt-3.5 grid grid-cols-7 gap-1 text-center">
        {weekHeaders.map((day) => (
          <div
            key={day}
            className="text-[10px] font-extrabold text-[var(--muted-foreground)] tracking-wider py-1"
          >
            {day}
          </div>
        ))}

        {/* Empty slots before day 1 */}
        {EMPTY_SLOT_KEYS.slice(0, emptyDaysBefore).map((slotKey) => (
          <div key={slotKey} className="h-10 sm:h-12" aria-hidden="true" />
        ))}

        {/* Days of the month */}
        {calendarHeatmap.map((item) => {
          const dayNumber = parseInt(item.date.split("-")[2]!, 10);
          const hasExpense = item.expense > 0;
          const isSelected = selectedDay === item.date;

          return (
            <button
              key={item.date}
              type="button"
              onClick={() => setSelectedDay(selectedDay === item.date ? null : item.date)}
              className={`group relative flex min-h-[44px] h-11 sm:h-12 flex-col items-center justify-between rounded-[10px] p-1 transition-all ${
                item.isToday
                  ? "border-2 border-[var(--primary)] bg-[var(--surface)] font-bold shadow-xs ring-1 ring-[var(--primary)]/30"
                  : isSelected
                    ? "border border-[var(--primary)] bg-[var(--surface)]"
                    : "border border-transparent hover:border-[var(--control-border)] hover:bg-[var(--surface)]"
              }`}
            >
              <span
                className={`text-[11px] tabular-nums font-mono ${
                  item.isToday
                    ? "text-[var(--foreground)] font-extrabold"
                    : "text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]"
                }`}
              >
                {dayNumber}
              </span>

              {/* Expense indicator dot / micro badge */}
              <div className="flex h-3 items-center justify-center">
                {hasExpense ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--destructive)]"
                    title={`Belanja: ${formatRupiah(item.expense, isMasked)}`}
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
  );
}
