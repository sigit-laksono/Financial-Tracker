import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type WalletDto } from "../lib/api";
import { formatRupiah, formatSignedDigitsInput, jakartaToday, parseSignedInt } from "../lib/format";
import { budgetKeys } from "../lib/queryKeys";
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
  const formId = useId();
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
      if (Math.abs(actualBalance) > 2_147_483_647) {
        throw new Error("Nominal saldo maksimal Rp 2.147.483.647.");
      }
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
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
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
      title={wallet ? `Cocokkan Saldo ${wallet.name}` : "Cocokkan Saldo"}
      subtitle="Bandingkan saldo di m-banking dengan aplikasi agar angka pencatatan tetap sinkron tanpa repot."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending
              ? "Menyimpan..."
              : delta === 0
                ? "Saldo Sudah Sesuai"
                : `Sesuaikan (${delta > 0 ? `+${formatRupiah(delta)}` : formatRupiah(delta)})`}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm space-y-2">
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Saldo Tercatat di Aplikasi
            </span>
            <strong className="tabular-nums text-base font-black text-[var(--foreground)]">
              {formatRupiah(wallet?.balance ?? 0)}
            </strong>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="rec-actual"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Saldo Riil di M-Banking / Dompet Saat Ini (Rp)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
              Rp
            </span>
            <input
              id="rec-actual"
              inputMode="text"
              value={actualInput}
              onChange={(e) => setActualInput(formatSignedDigitsInput(e.target.value))}
              className="tabular-nums w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-3 text-xl font-black text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="rec-note"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Keterangan Penyesuaian (Opsional)
          </label>
          <input
            id="rec-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: Cek mutasi m-banking"
            className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          />
        </div>

        <div className="rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm space-y-1">
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Selisih Penyesuaian
            </span>
            <strong className="tabular-nums text-base font-black text-[var(--foreground)]">
              {delta > 0 ? `+${formatRupiah(delta)}` : formatRupiah(delta)}
            </strong>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
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
      </form>
    </ModalSheet>
  );
}
