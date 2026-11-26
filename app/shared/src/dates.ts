import type { CycleMode } from "./types";

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidYearMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftMonth(period: string, delta: number): string {
  const [yearText = "1970", monthText = "01"] = period.split("-");
  const target = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonthsToDate(
  periodDate: string,
  offset: number,
): { period: string; dueDate: string } {
  const [yearText = "1970", monthText = "01", dayText = "01"] = periodDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const dueDay = Math.min(day, lastDay);
  const period = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
  return { period, dueDate: `${period}-${String(dueDay).padStart(2, "0")}` };
}

export function ccDueDateForCycle(
  cycleKey: string,
  cutoffDay = 20,
  paymentDay = 25,
): string {
  const isNextMonth = paymentDay <= cutoffDay;
  const dueCycle = isNextMonth ? shiftMonth(cycleKey, 1) : cycleKey;
  const [yearText = "1970", monthText = "01"] = dueCycle.split("-");
  const targetYear = Number(yearText);
  const targetMonth = Number(monthText);
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(Math.max(1, paymentDay), lastDay);
  return `${dueCycle}-${String(day).padStart(2, "0")}`;
}

/** Cut-off date that closes a CC cycle: transactions before it belong to `cycleKey`. */
export function ccClosingDateForCycle(cycleKey: string, cutoffDay = 20): string {
  const [yearText = "1970", monthText = "01"] = cycleKey.split("-");
  const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  const day = Math.min(Math.max(1, cutoffDay), lastDay);
  return `${cycleKey}-${String(day).padStart(2, "0")}`;
}

export function ccCycleForDate(dateValue: string, cardCutoffDay = 20): string {
  const [yearText = "1970", monthText = "01", dayText = "01"] = dateValue.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (day < cardCutoffDay) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return shiftMonth(`${year}-${String(month).padStart(2, "0")}`, 1);
}

export function gajianPeriodForDate(dateValue: string, gajianStartDay = 25): string {
  const [yearText = "1970", monthText = "01", dayText = "01"] = dateValue.split("-");
  const period = `${yearText}-${monthText}`;
  return Number(dayText) < gajianStartDay ? shiftMonth(period, -1) : period;
}

export function periodForDate(
  dateValue: string,
  cycle: CycleMode,
  gajianStartDay = 25,
  cardCutoffDay = 20,
): string {
  return cycle === "cc"
    ? ccCycleForDate(dateValue, cardCutoffDay)
    : gajianPeriodForDate(dateValue, gajianStartDay);
}

function clampDayForMonth(day: number, year: number, month1Based: number): number {
  const daysInMonth = new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
  return Math.min(Math.max(1, Math.trunc(day)), daysInMonth);
}

export function periodBounds(
  period: string,
  cycle: CycleMode,
  gajianStartDay = 25,
  cardCutoffDay = 20,
): { start: string; end: string } {
  const [yearText = "1970", monthText = "01"] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (cycle === "cc") {
    const prevMonth = shiftMonth(period, -1);
    const [pYear = "1970", pMonth = "01"] = prevMonth.split("-");
    const startDay = clampDayForMonth(cardCutoffDay, Number(pYear), Number(pMonth));
    const endCutoffDay = clampDayForMonth(cardCutoffDay, year, month);
    const start = `${pYear}-${pMonth}-${String(startDay).padStart(2, "0")}`;
    const endDate = new Date(Date.UTC(year, month - 1, endCutoffDay - 1));
    return { start, end: endDate.toISOString().slice(0, 10) };
  }

  const startDay = clampDayForMonth(gajianStartDay, year, month);
  const nextMonth = shiftMonth(period, 1);
  const [nYear = "1970", nMonth = "01"] = nextMonth.split("-");
  const nextStartDay = clampDayForMonth(gajianStartDay, Number(nYear), Number(nMonth));
  const start = `${period}-${String(startDay).padStart(2, "0")}`;
  const endDate = new Date(Date.UTC(Number(nYear), Number(nMonth) - 1, nextStartDay - 1));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function daysBetween(startIso: string, endIso: string): number {
  const d1 = new Date(`${startIso}T00:00:00.000Z`);
  const d2 = new Date(`${endIso}T00:00:00.000Z`);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function addDaysToDate(dateIso: string, days: number): string {
  const [yearText = "1970", monthText = "01", dayText = "01"] = dateIso.split("-");
  const target = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days),
  );
  return target.toISOString().slice(0, 10);
}
