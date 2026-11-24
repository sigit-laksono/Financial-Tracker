import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type WalletDto } from "../lib/api";
import { formatRupiah, formatSignedDigitsInput, jakartaToday, parseSignedInt } from "../lib/format";
import { AlertIcon } from "./Icons";
import { Button, ModalSheet } from "./UI";

export function ReconcileModal({
  wallet,
  onClose,
  onSuccess,
}: {
  wallet: WalletDto | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [actualInput, setActualInput] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!wallet) return;
    setActualInput(wallet.balance.toLocaleString("id-ID"));
    setNote("");
    setError("");
  }, [wallet]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!wallet) return;
      if (actualInput.trim() === "" || actualInput.trim() === "-") {
        throw new Error("Masukkan saldo aktual yang valid.");
      }
      const actualBalance = parseSignedInt(actualInput);
      return api.reconcileWallet(wallet.id, {
        actualBalance,
        date: jakartaToday(),
        note: note.trim() || undefined,
      });
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      if (res?.adjusted) {
        onSuccess(`Saldo ${wallet?.name} disesuaikan (${formatRupiah(res.delta)})`);
      } else {
        onSuccess(`Saldo ${wallet?.name} sudah sesuai`);
      }
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyesuaikan saldo.",
      );
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    mutation.mutate();
  };

  const actualValue = parseSignedInt(actualInput);
  const delta = wallet ? actualValue - wallet.balance : 0;

  return (
    <ModalSheet
      open={Boolean(wallet)}
      onClose={onClose}
      title={wallet ? `Cocokkan Saldo ${wallet.name}` : "Cocokkan Saldo Dompet"}
      subtitle="Bandingkan saldo di m-banking dengan aplikasi agar angka pencatatan tetap sinkron tanpa repot."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5 text-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">Saldo Tercatat di Aplikasi</span>
            <strong className="tabular-nums text-base font-black text-neutral-900 dark:text-white">{formatRupiah(wallet?.balance ?? 0)}</strong>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rec-actual" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            Saldo Riil di M-Banking / Dompet Saat Ini (Rp)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
              Rp
            </span>
            <input
              id="rec-actual"
              inputMode="text"
              value={actualInput}
              onChange={(e) => setActualInput(formatSignedDigitsInput(e.target.value))}
              className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-xl font-black text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rec-note" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            Keterangan Penyesuaian (Opsional)
          </label>
          <input
            id="rec-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: Cek mutasi m-banking pagi ini"
            className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
          />
        </div>

        <div className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5 text-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">Selisih Penyesuaian</span>
            <strong className="tabular-nums text-base font-black text-neutral-900 dark:text-white">
              {delta > 0 ? `+${formatRupiah(delta)}` : formatRupiah(delta)}
            </strong>
          </div>
          <p className="text-xs text-neutral-400">
            {delta === 0
              ? "Saldo sudah cocok sempurna dengan m-banking."
              : `Terdapat selisih ${formatRupiah(Math.abs(delta))} (${
                  delta > 0 ? "saldo m-banking lebih tinggi" : "saldo m-banking lebih rendah"
                }).`}
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
            {mutation.isPending
              ? "Menyimpan..."
              : delta === 0
                ? "Saldo Sudah Sesuai"
                : `Sesuaikan Otomatis (${delta > 0 ? `+${formatRupiah(delta)}` : formatRupiah(delta)})`}
          </button>
        </div>
      </form>
    </ModalSheet>
  );
}
