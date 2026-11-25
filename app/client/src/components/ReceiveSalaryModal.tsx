import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type DashboardDto } from "../lib/api";
import { formatDigitsInput, formatRupiah, formatShortDate, parsePositiveInt } from "../lib/format";
import { budgetKeys, goalKeys } from "../lib/queryKeys";
import { AlertIcon } from "./Icons";
import { Badge, Button, ModalSheet } from "./UI";

export function ReceiveSalaryModal({
  open,
  period,
  data,
  onClose,
  onSuccess,
}: {
  open: boolean;
  period: string;
  data: DashboardDto;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();

  const liquidWallets = useMemo(
    () => data.wallets.filter((w) => w.isActive && w.type !== "credit_card"),
    [data.wallets],
  );

  const defaultWalletId = useMemo(() => {
    if (data.settings.defaultSalaryWalletId) {
      const match = liquidWallets.find((w) => w.id === data.settings.defaultSalaryWalletId);
      if (match) return match.id;
    }
    const defaultBank = liquidWallets.find((w) => w.type === "bank");
    return defaultBank?.id ?? liquidWallets[0]?.id ?? 1;
  }, [data.settings.defaultSalaryWalletId, liquidWallets]);

  const [grossSalaryInput, setGrossSalaryInput] = useState(
    data.settings.grossSalary.toLocaleString("id-ID"),
  );
  const [selectedWalletId, setSelectedWalletId] = useState<number>(defaultWalletId);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setGrossSalaryInput(data.settings.grossSalary.toLocaleString("id-ID"));
      setSelectedWalletId(defaultWalletId);
      setError("");
    }
  }, [open, data.settings.grossSalary, defaultWalletId]);

  const parsedGross = parsePositiveInt(grossSalaryInput);

  const previewQuery = useQuery({
    queryKey: ["salary-preview", period, parsedGross, selectedWalletId],
    queryFn: () =>
      api.getSalaryPreview({
        period,
        grossSalary: parsedGross,
        walletId: selectedWalletId,
      }),
    enabled: open,
  });

  const preview = previewQuery.data;
  const totalPayrollDue = preview?.totalPayrollDue ?? 0;
  const netSalary = Math.max(0, parsedGross - totalPayrollDue);

  const receiveMutation = useMutation({
    mutationFn: () =>
      api.receiveSalary({
        period,
        grossSalary: parsedGross,
        walletId: selectedWalletId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["salary-preview"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: goalKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      onSuccess(`Gaji periode ${period} berhasil dicatat (${formatRupiah(netSalary)})`);
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Gagal memproses penerimaan gaji.",
      );
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (parsedGross <= 0) {
      setError("Gaji kotor harus lebih dari 0.");
      return;
    }
    if (parsedGross > 2_147_483_647) {
      setError("Nominal gaji maksimal Rp 2.147.483.647.");
      return;
    }
    receiveMutation.mutate();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Terima Gaji Siklus ${period}`}
      subtitle="Catat penerimaan gaji bulanan dan lunasi potongan cicilan kantor periode ini secara otomatis."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={receiveMutation.isPending || preview?.alreadyReceived}
            className="flex-1 sm:flex-none"
          >
            {receiveMutation.isPending
              ? "Menyimpan..."
              : `Catat Terima Gaji (${formatRupiah(netSalary)})`}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview?.alreadyReceived && (
          <div className="flex items-center gap-2 rounded-[14px] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs font-semibold text-amber-800 dark:text-amber-200">
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span>Gaji periode ini sudah pernah dicatat di sistem.</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="salary-gross"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Gaji Kotor (Rp)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
              Rp
            </span>
            <input
              id="salary-gross"
              inputMode="numeric"
              value={grossSalaryInput}
              onChange={(e) => setGrossSalaryInput(formatDigitsInput(e.target.value))}
              className="tabular-nums w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-3 text-xl font-black text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
              placeholder="10.000.000"
            />
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Bisa diubah bila ada tambahan bonus atau lembur pada slip gaji.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="salary-wallet"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Dompet Penerima Gaji
          </label>
          <select
            id="salary-wallet"
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(Number(e.target.value))}
            className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          >
            {liquidWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role === "savings" ? "Tabungan" : "Harian"}) · Saldo:{" "}
                {formatRupiah(w.balance)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Potongan Cicilan Kantor (Payroll)
            </span>
            <Badge tone={totalPayrollDue > 0 ? "highlight" : "soft"}>
              {totalPayrollDue > 0 ? `${preview?.payrollInstallments.length ?? 0} Cicilan` : "Rp0"}
            </Badge>
          </div>

          {preview?.payrollInstallments && preview.payrollInstallments.length > 0 ? (
            <div className="divide-y divide-[var(--border)] pt-1 text-xs">
              {preview.payrollInstallments.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <strong className="block text-[var(--foreground)]">{inst.accountName}</strong>
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      Jatuh tempo {formatShortDate(inst.dueDate)} · {inst.lender}
                    </span>
                  </div>
                  <span className="tabular-nums font-bold text-[var(--destructive)] shrink-0">
                    -{formatRupiah(inst.plannedAmount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">
              Tidak ada cicilan utang kantor yang jatuh tempo pada siklus ini.
            </p>
          )}
        </div>

        <div className="rounded-[16px] border border-dashed border-[var(--primary)]/50 bg-[var(--surface)] p-4 text-[var(--foreground)]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">
              Gaji Bersih Diterima (Net)
            </span>
            <Badge tone="soft">Masuk ke Kas</Badge>
          </div>
          <p className="tabular-nums mt-1 text-2xl font-black text-[var(--foreground)]">
            {formatRupiah(netSalary)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            {formatRupiah(parsedGross)} (Kotor) - {formatRupiah(totalPayrollDue)} (Potongan Kantor)
          </p>
        </div>
      </form>
    </ModalSheet>
  );
}
