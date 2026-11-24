import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import {
  formatDigitsInput,
  formatRupiah,
  jakartaToday,
  parsePositiveInt,
  shiftMonth,
} from "../lib/format";
import { AlertIcon } from "./Icons";
import { Button, ModalSheet } from "./UI";

export type SplitPayTarget = {
  id: number;
  merchant: string;
  amount: number;
  transactionDate: string;
};

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
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="sp-name" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            Nama Akun Cicilan
          </label>
          <input
            id="sp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="sp-count" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
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
              className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sp-amount" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Cicilan / Bulan (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
                Rp
              </span>
              <input
                id="sp-amount"
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => setAmountInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-bold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sp-period" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            Mulai Tagihan Bulan (YYYY-MM)
          </label>
          <input
            id="sp-period"
            type="month"
            value={firstPeriod}
            onChange={(e) => setFirstPeriod(e.target.value)}
            className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
          />
        </div>

        <div className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">Total Pokok + Bunga Cicilan</span>
            <strong className="tabular-nums font-black text-neutral-900 dark:text-white">{formatRupiah(totalConverted)}</strong>
          </div>
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

        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center px-4 py-2.5 rounded-[14px] text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="min-h-[44px] px-6 py-3 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
          >
            {mutation.isPending ? "Memproses..." : "Konfirmasi Ubah ke Cicilan"}
          </button>
        </div>
      </form>
    </ModalSheet>
  );
}
