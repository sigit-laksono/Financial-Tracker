import { useMemo, useState } from "react";
import {
  ccCycleForDate,
  ccDueDateForCycle,
  ccPostingDateInCycle,
  isValidIsoDate,
  shiftMonth,
} from "../../../shared/src/dates";
import { formatMonthTitle, formatShortDate, jakartaToday } from "../lib/format";

/**
 * Picks which credit-card statement a card installment first lands on. The value stored is a
 * posting date inside that cycle (how the bank books "INSTALLMENT x/12"); the due date is only
 * shown, derived from the card's cut-off and payment day.
 */
export function CcFirstBillPicker({
  id,
  label,
  value,
  onChange,
  cutoffDay,
  paymentDay,
  labelClass,
  selectClass,
}: {
  id: string;
  label: string;
  /** Posting date (YYYY-MM-DD) of the first installment, or "" when invalid. */
  value: string;
  onChange: (postingDate: string) => void;
  cutoffDay: number;
  paymentDay: number;
  labelClass: string;
  selectClass: string;
}) {
  const initialCycle = isValidIsoDate(value)
    ? ccCycleForDate(value, cutoffDay)
    : ccCycleForDate(jakartaToday(), cutoffDay);
  const [cycleKey, setCycleKey] = useState(initialCycle);
  const [postingDayInput, setPostingDayInput] = useState(() =>
    isValidIsoDate(value) ? String(Number(value.slice(8, 10))) : "",
  );

  const cycleOptions = useMemo(() => {
    const current = ccCycleForDate(jakartaToday(), cutoffDay);
    const first = [initialCycle, shiftMonth(current, -1)].sort()[0] ?? current;
    const options: string[] = [];
    for (let key = first; key <= shiftMonth(current, 12); key = shiftMonth(key, 1)) {
      options.push(key);
    }
    return options;
  }, [cutoffDay, initialCycle]);

  const postingDay = Number(postingDayInput) || null;
  const postingDate = ccPostingDateInCycle(cycleKey, cutoffDay, postingDay);

  const emit = (nextCycle: string, nextDayInput: string) => {
    const next = ccPostingDateInCycle(nextCycle, cutoffDay, Number(nextDayInput) || null);
    onChange(next ?? "");
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={cycleKey}
        onChange={(e) => {
          setCycleKey(e.target.value);
          emit(e.target.value, postingDayInput);
        }}
        className={selectClass}
      >
        {cycleOptions.map((key) => (
          <option key={key} value={key}>
            {formatMonthTitle(key)} · jatuh tempo{" "}
            {formatShortDate(ccDueDateForCycle(key, cutoffDay, paymentDay))}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-day`} className="shrink-0 text-xs text-[var(--muted-foreground)]">
          Tanggal posting di invoice (opsional)
        </label>
        <input
          id={`${id}-day`}
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={postingDayInput}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
            const clamped = digits && Number(digits) > 31 ? "31" : digits;
            setPostingDayInput(clamped);
            emit(cycleKey, clamped);
          }}
          placeholder="29"
          className="tabular-nums h-10 w-16 rounded-[12px] border border-[var(--control-border)] bg-[var(--card)] px-2 text-center text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
        />
      </div>

      {postingDate ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Cicilan diposting {formatShortDate(postingDate)}, masuk tagihan{" "}
          {formatMonthTitle(cycleKey)}, dibayar{" "}
          {formatShortDate(ccDueDateForCycle(cycleKey, cutoffDay, paymentDay))}.
        </p>
      ) : (
        <p role="alert" className="text-[11px] font-semibold text-[var(--destructive)]">
          Tanggal {postingDayInput} tidak ada di siklus tagihan {formatMonthTitle(cycleKey)}.
        </p>
      )}
    </div>
  );
}
