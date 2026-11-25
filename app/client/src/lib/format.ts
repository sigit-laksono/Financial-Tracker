import { jakartaToday, periodForDate, shiftMonth } from "../../../shared/src/dates";
import type { CycleMode } from "../../../shared/src/types";

export { jakartaToday, shiftMonth };

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(amount: number, isMasked = false): string {
  if (isMasked) return "Rp\u00A0•••••••";
  return rupiahFormatter.format(amount).replace("-", "\u2212").replace(/\s+/g, "\u00A0");
}

function terbilang(n: number): string {
  const units = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];
  n = Math.floor(Math.abs(n));
  if (n === 0) return "nol";
  if (n < 12) return units[n]!;
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) {
    const sisa = n % 10;
    return `${terbilang(Math.floor(n / 10))} puluh${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 200) {
    const sisa = n - 100;
    return `seratus${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 1000) {
    const sisa = n % 100;
    return `${terbilang(Math.floor(n / 100))} ratus${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 2000) {
    const sisa = n - 1000;
    return `seribu${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 1_000_000) {
    const sisa = n % 1000;
    return `${terbilang(Math.floor(n / 1000))} ribu${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 1_000_000_000) {
    const sisa = n % 1_000_000;
    return `${terbilang(Math.floor(n / 1_000_000))} juta${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  if (n < 1_000_000_000_000) {
    const sisa = n % 1_000_000_000;
    return `${terbilang(Math.floor(n / 1_000_000_000))} miliar${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
  }
  const sisa = n % 1_000_000_000_000;
  return `${terbilang(Math.floor(n / 1_000_000_000_000))} triliun${sisa > 0 ? ` ${terbilang(sisa)}` : ""}`;
}

export function spellOutRupiah(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "Nol rupiah";
  const prefix = amount < 0 ? "Minus " : "";
  const words = terbilang(Math.abs(amount));
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${prefix}${capitalized} rupiah`;
}

function formatUnit(val: number): string {
  const rounded = Number(val.toFixed(1));
  return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)).replace(".", ",");
}

export function formatCompactRupiah(amount: number, isMasked = false): string {
  if (isMasked) return "Rp\u00A0•••••••";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) {
    return `${sign}Rp\u00A0${formatUnit(abs / 1_000_000_000_000)}\u00A0T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}Rp\u00A0${formatUnit(abs / 1_000_000_000)}\u00A0M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}Rp\u00A0${formatUnit(abs / 1_000_000)}\u00A0jt`;
  }
  if (abs >= 1_000) {
    const val = Math.round(abs / 1_000);
    return `${sign}Rp\u00A0${val}\u00A0rb`;
  }
  return formatRupiah(amount);
}

export function formatShortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDayHeader(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatMonthTitle(period: string): string {
  const date = new Date(`${period}-01T00:00:00Z`);
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function currentPeriodForCycle(
  cycle: CycleMode,
  gajianStartDay = 25,
  cardCutoffDay = 20,
  today = jakartaToday(),
): string {
  return periodForDate(today, cycle, gajianStartDay, cardCutoffDay);
}

export function formatPeriodRangeLabel(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startStr = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(start);
  const endStr = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startStr} - ${endStr}`;
}

export type WeekSlice = {
  index: number;
  label: string;
  start: string;
  end: string;
};

export function buildWeekSlices(startIso: string, endIso: string): WeekSlice[] {
  const slices: WeekSlice[] = [];
  const end = new Date(`${endIso}T00:00:00Z`);
  let cursor = new Date(`${startIso}T00:00:00Z`);
  let index = 1;

  while (cursor <= end) {
    const sliceEnd = new Date(cursor);
    sliceEnd.setUTCDate(sliceEnd.getUTCDate() + 6);
    if (sliceEnd > end) sliceEnd.setTime(end.getTime());
    const startKey = cursor.toISOString().slice(0, 10);
    const endKey = sliceEnd.toISOString().slice(0, 10);
    slices.push({
      index,
      label: `Minggu ${index}`,
      start: startKey,
      end: endKey,
    });
    cursor = new Date(sliceEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }
  return slices;
}

export function parsePositiveInt(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

export function formatDigitsInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("id-ID");
}

export function parseSignedInt(raw: string): number {
  const trimmed = raw.trim();
  const isNeg = trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  return isNeg ? -value : value;
}

export function formatSignedDigitsInput(raw: string): string {
  const trimmed = raw.trim();
  const isNeg = trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return isNeg ? "-" : "";
  const formatted = Number(digits).toLocaleString("id-ID");
  return isNeg ? `-${formatted}` : formatted;
}
