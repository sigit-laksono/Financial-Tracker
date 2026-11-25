import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import {
  formatDigitsInput,
  formatMonthTitle,
  formatRupiah,
  jakartaToday,
  MAX_IDR_AMOUNT,
  parsePositiveInt,
  shiftMonth,
} from "../lib/format";
import { budgetKeys } from "../lib/queryKeys";
import { AlertIcon } from "./Icons";
import { Badge, Button, ModalSheet } from "./UI";

export type SplitPayTarget = {
  id: number;
  merchant: string;
  amount: number;
  transactionDate: string;
};

const MONTHS_ID = [
  { value: "01", label: "Januari" },
  { value: "02", label: "Februari" },
  { value: "03", label: "Maret" },
  { value: "04", label: "April" },
  { value: "05", label: "Mei" },
  { value: "06", label: "Juni" },
  { value: "07", label: "Juli" },
  { value: "08", label: "Agustus" },
  { value: "09", label: "September" },
  { value: "10", label: "Oktober" },
  { value: "11", label: "November" },
  { value: "12", label: "Desember" },
];

export function SplitPayModal({
  target,
  onClose,
  onSuccess,
}: {
  target: SplitPayTarget | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState("");
  const [count, setCount] = useState("6");
  const [amountInput, setAmountInput] = useState("");
  const [firstPeriod, setFirstPeriod] = useState(() => shiftMonth(jakartaToday().slice(0, 7), 1));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    setName(`${target.merchant} (Cicilan)`);
    setCount("6");
    const est = Math.ceil(target.amount / 6);
    setAmountInput(est.toLocaleString("id-ID"));
    setFirstPeriod(shiftMonth(target.transactionDate.slice(0, 7), 1));
    setError("");
  }, [target]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) return;
      const installmentCount = Number(count);
      const installmentAmount = parsePositiveInt(amountInput);
      if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 60) {
        throw new Error("Tenor harus antara 2 sampai 60 bulan.");
      }
      if (installmentAmount <= 0) {
        throw new Error("Nominal cicilan per bulan harus lebih dari Rp0.");
      }
      if (installmentAmount > MAX_IDR_AMOUNT) {
        throw new Error(`Nominal cicilan maksimal ${formatRupiah(MAX_IDR_AMOUNT)}.`);
      }
      if (installmentCount * installmentAmount > MAX_IDR_AMOUNT) {
        throw new Error(`Total nilai cicilan maksimal ${formatRupiah(MAX_IDR_AMOUNT)}.`);
      }
      return api.convertToSplitPay(target.id, {
        name: name.trim() || undefined,
        installmentCount,
        installmentAmount,
        firstPeriod,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      onSuccess("Transaksi berhasil diubah menjadi cicilan bulanan");
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal konversi.");
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    mutation.mutate();
  };

  const totalConverted = Number(count || 0) * parsePositiveInt(amountInput);
  const selectedYear = firstPeriod.slice(0, 4) || jakartaToday().slice(0, 4);
  const selectedMonth = firstPeriod.slice(5, 7) || "01";
  const currentYearNum = Number(jakartaToday().slice(0, 4));
  const yearOptions = Array.from(
    new Set([currentYearNum - 1, currentYearNum, currentYearNum + 1, currentYearNum + 2, Number(selectedYear)]),
  ).sort((a, b) => a - b);
  const formattedPeriod = /^\d{4}-\d{2}$/.test(firstPeriod)
    ? formatMonthTitle(firstPeriod)
    : "-";

  return (
    <ModalSheet
      open={Boolean(target)}
      onClose={onClose}
      title="Ubah Jadi Cicilan Bulanan"
      subtitle={
        target
          ? `${target.merchant} (${formatRupiah(target.amount)}) akan dikeluarkan dari tagihan penuh siklus ini dan dipecah bertahap.`
          : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending ? "Memproses..." : "Konfirmasi Ubah ke Cicilan"}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="sp-name"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Nama Akun Cicilan
          </label>
          <input
            id="sp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Cicilan Laptop"
            className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="sp-count"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Tenor (Bulan)
            </label>
            <input
              id="sp-count"
              type="number"
              min={2}
              max={60}
              value={count}
              onChange={(e) => {
                const next = e.target.value;
                setCount(next);
                if (target && Number(next) >= 2) {
                  setAmountInput(Math.ceil(target.amount / Number(next)).toLocaleString("id-ID"));
                }
              }}
              className="tabular-nums w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="sp-amount"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Cicilan / Bulan (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="sp-amount"
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => setAmountInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-3 text-sm font-bold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="sp-period-month"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Mulai Tagihan Bulan
            </label>
            <Badge tone="info">{formattedPeriod}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              id="sp-period-month"
              aria-label="Mulai tagihan bulan"
              value={selectedMonth}
              onChange={(e) => setFirstPeriod(`${selectedYear}-${e.target.value}`)}
              className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              {MONTHS_ID.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              id="sp-period-year"
              aria-label="Mulai tagihan tahun"
              value={selectedYear}
              onChange={(e) => setFirstPeriod(`${e.target.value}-${selectedMonth}`)}
              className="tabular-nums h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm space-y-1.5">
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Total Pokok + Bunga Cicilan
            </span>
            <strong className="tabular-nums font-black text-[var(--foreground)]">
              {formatRupiah(totalConverted)}
            </strong>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Angsuran pertama dimulai pada{" "}
            <strong className="text-[var(--foreground)]">{formattedPeriod}</strong>.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </ModalSheet>
  );
}
