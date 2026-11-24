import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DebtDirection, DebtKind } from "../../../shared/src/types";
import { addMonthsToDate, isValidIsoDate } from "../../../shared/src/dates";
import { api, ApiError } from "../lib/api";
import { formatDigitsInput, formatRupiah, formatShortDate, jakartaToday, parsePositiveInt } from "../lib/format";
import { AlertIcon } from "./Icons";
import { Button, ModalSheet } from "./UI";

interface ScheduleRow {
  monthIndex: number;
  period: string;
  dueDate: string;
  amount: number;
  amountInput: string;
  isModified: boolean;
}

export function AddDebtModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<DebtDirection>("payable");
  const [name, setName] = useState("");
  const [lender, setLender] = useState("");
  const [kind, setKind] = useState<DebtKind>("loan");
  const [count, setCount] = useState("6");
  const [amountInput, setAmountInput] = useState("");
  const [firstDueDate, setFirstDueDate] = useState(jakartaToday);
  const [paymentMethod, setPaymentMethod] = useState("Transfer");

  // Disbursement toggle & wallet selection
  const [recordDisbursement, setRecordDisbursement] = useState(false);
  const [disburseWalletId, setDisburseWalletId] = useState<number | null>(null);

  // Pokok & Bunga optional breakdown
  const [splitPrincipalInterest, setSplitPrincipalInterest] = useState(false);
  const [principalInput, setPrincipalInput] = useState("");
  const [interestInput, setInterestInput] = useState("");

  // Custom schedule per bulan
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [showScheduleDetails, setShowScheduleDetails] = useState(false);

  const [error, setError] = useState("");

  const { data: walletsData } = useQuery({
    queryKey: ["wallets"],
    queryFn: api.getWallets,
    enabled: open,
  });

  const liquidWallets = (walletsData?.wallets ?? []).filter(
    (w) => w.isActive && w.type !== "credit_card",
  );

  const installmentCount = Math.max(1, Math.min(120, parseInt(count, 10) || 1));
  const standardAmount = parsePositiveInt(amountInput);

  useEffect(() => {
    if (!open) return;
    setDirection("payable");
    setName("");
    setLender("");
    setKind("loan");
    setCount("6");
    setAmountInput("");
    setFirstDueDate(jakartaToday());
    setPaymentMethod("Transfer");
    setRecordDisbursement(false);
    setDisburseWalletId(liquidWallets[0]?.id ?? null);
    setSplitPrincipalInterest(false);
    setPrincipalInput("");
    setInterestInput("");
    setScheduleRows([]);
    setShowScheduleDetails(false);
    setError("");
  }, [open, liquidWallets[0]?.id]);

  // Sync / generate schedule when count, amountInput, or firstDueDate changes
  useEffect(() => {
    if (!open || !firstDueDate || !isValidIsoDate(firstDueDate)) return;
    setScheduleRows((prev) => {
      return Array.from({ length: installmentCount }, (_, i) => {
        const { period, dueDate } = addMonthsToDate(firstDueDate, i);
        const existing = prev[i];
        if (existing && existing.isModified) {
          return {
            ...existing,
            period,
            dueDate,
            monthIndex: i + 1,
          };
        }
        return {
          monthIndex: i + 1,
          period,
          dueDate,
          amount: standardAmount,
          amountInput: standardAmount > 0 ? standardAmount.toLocaleString("id-ID") : "",
          isModified: false,
        };
      });
    });
  }, [open, installmentCount, standardAmount, firstDueDate]);

  const handleRowAmountChange = (index: number, val: string) => {
    const formatted = formatDigitsInput(val);
    const parsed = parsePositiveInt(formatted);
    setScheduleRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return {
          ...row,
          amount: parsed,
          amountInput: formatted,
          isModified: parsed !== standardAmount,
        };
      }),
    );
  };

  const handleResetAllToStandard = () => {
    setScheduleRows((prev) =>
      prev.map((row) => ({
        ...row,
        amount: standardAmount,
        amountInput: standardAmount > 0 ? standardAmount.toLocaleString("id-ID") : "",
        isModified: false,
      })),
    );
  };

  const hasModifiedSchedule = scheduleRows.some((r) => r.isModified);
  const totalCalculated =
    scheduleRows.length > 0
      ? scheduleRows.reduce((sum, r) => sum + r.amount, 0)
      : Number(count || 0) * parsePositiveInt(amountInput);

  // Sync default lender & kind when direction switches
  const handleDirectionChange = (newDir: DebtDirection) => {
    setDirection(newDir);
    setError("");
    if (newDir === "receivable") {
      setKind("receivable");
      setLender("");
      setName("");
      setCount("1");
      setPaymentMethod("Transfer");
    } else {
      setKind("loan");
      setLender("");
      setName("");
      setCount("6");
      setPaymentMethod("Transfer");
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const installmentCount = Number(count);
      const installmentAmount = parsePositiveInt(amountInput);
      if (!name.trim() || !lender.trim()) {
        throw new Error(
          direction === "receivable"
            ? "Keterangan piutang dan nama peminjam wajib diisi."
            : "Nama utang dan pemberi pinjaman wajib diisi.",
        );
      }
      if (!Number.isInteger(installmentCount) || installmentCount < 1) {
        throw new Error("Jumlah cicilan minimal 1.");
      }
      if (installmentAmount <= 0) throw new Error("Nominal cicilan harus lebih dari Rp0.");

      if (recordDisbursement && !disburseWalletId) {
        throw new Error("Pilih dompet untuk mutasi pencairan / pemotongan dana.");
      }

      let principalAmount: number | undefined;
      let interestAmount: number | undefined;
      if (splitPrincipalInterest) {
        principalAmount = parsePositiveInt(principalInput);
        interestAmount = parsePositiveInt(interestInput);
      }

      const customSchedule = hasModifiedSchedule
        ? scheduleRows.map((r) => ({
            monthIndex: r.monthIndex,
            period: r.period,
            dueDate: r.dueDate,
            plannedAmount: r.amount > 0 ? r.amount : installmentAmount,
          }))
        : undefined;

      const totalBalance = customSchedule
        ? customSchedule.reduce((sum, r) => sum + r.plannedAmount, 0)
        : installmentCount * installmentAmount;

      return api.createDebt({
        name: name.trim(),
        lender: lender.trim(),
        kind,
        direction,
        initialBalance: totalBalance,
        installmentCount,
        installmentAmount,
        principalAmount,
        interestAmount,
        firstDueDate,
        paymentMethod: paymentMethod.trim() || "Transfer",
        disburseWalletId: recordDisbursement ? disburseWalletId : null,
        recordDisbursement,
        customSchedule,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      onSuccess(
        direction === "receivable"
          ? "Akun piutang dan jadwal tagihan berhasil ditambahkan"
          : "Akun utang dan jadwal cicilan berhasil ditambahkan",
      );
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyimpan.");
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    mutation.mutate();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={
        direction === "receivable"
          ? "Tambah Piutang (Tagih Balik / Talangan)"
          : "Tambah Akun Utang & Cicilan"
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Direction Switcher (Utang vs Piutang) */}
        <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[var(--surface)] p-1 border border-[var(--border)]">
          <button
            type="button"
            onClick={() => handleDirectionChange("payable")}
            className={`min-h-[44px] rounded-[10px] text-xs font-bold transition-all ${
              direction === "payable"
                ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            Hutang Saya (Saya Pinjam)
          </button>
          <button
            type="button"
            onClick={() => handleDirectionChange("receivable")}
            className={`min-h-[44px] rounded-[10px] text-xs font-bold transition-all ${
              direction === "receivable"
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            Piutang (Saya Meminjamkan)
          </button>
        </div>

        {/* Name / Keterangan */}
        <div className="space-y-1.5">
          <label htmlFor="debt-name" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            {direction === "receivable" ? "Keterangan Piutang / Talangan" : "Nama Utang / Cicilan"}
          </label>
          <input
            id="debt-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              direction === "receivable"
                ? "Contoh: Talangan Tiket Konser Budi"
                : "Contoh: Flexi Cash Renovasi"
            }
            className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
          />
        </div>

        {/* Counterparty & Kind */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-lender" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              {direction === "receivable" ? "Peminjam / Pihak Berutang" : "Pemberi Pinjaman"}
            </label>
            <input
              id="debt-lender"
              type="text"
              value={lender}
              onChange={(e) => setLender(e.target.value)}
              placeholder={
                direction === "receivable"
                  ? "Contoh: Budi (Teman)"
                  : "Contoh: Bank BCA, Teman, dsb."
              }
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-kind" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Jenis
            </label>
            {direction === "receivable" ? (
              <input
                id="debt-kind"
                type="text"
                disabled
                value="Piutang Pribadi / Talangan"
                className="w-full rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-4 py-3 text-sm font-semibold text-neutral-400 cursor-not-allowed"
              />
            ) : (
              <select
                id="debt-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as DebtKind)}
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              >
                <option value="loan">Pinjaman Tunai</option>
                <option value="card_installment">Cicilan Kartu Kredit</option>
                <option value="payroll">Potongan Gaji Kantor</option>
              </select>
            )}
          </div>
        </div>

        {/* Installment count & amount */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-count" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              {direction === "receivable" ? "Jumlah Kali Bayar (Bulan)" : "Jumlah Cicilan (Bulan)"}
            </label>
            <input
              id="debt-count"
              type="number"
              min={1}
              max={120}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-amount" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Nominal per Bulan (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
                Rp
              </span>
              <input
                id="debt-amount"
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => setAmountInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-bold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        {/* Total Preview */}
        {totalCalculated > 0 && (
          <div className="rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 p-3 text-xs text-neutral-500 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Total Nilai {direction === "receivable" ? "Piutang" : "Utang"}:</span>
              {hasModifiedSchedule && (
                <span className="rounded-md bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-extrabold text-[var(--primary)]">
                  Jadwal Kustom
                </span>
              )}
            </div>
            <span className="tabular-nums text-sm font-black text-neutral-900 dark:text-white">
              {formatRupiah(totalCalculated)}
            </span>
          </div>
        )}

        {/* Due date & payment method */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-due" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Jatuh Tempo Pertama
            </label>
            <input
              id="debt-due"
              type="date"
              value={firstDueDate}
              onChange={(e) => setFirstDueDate(e.target.value)}
              className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-method" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Metode Bayar
            </label>
            <input
              id="debt-method"
              type="text"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="Contoh: Transfer BCA"
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>
        </div>

        {/* Rincian Angsuran per Bulan (Customizable Schedule) */}
        {installmentCount > 1 && standardAmount > 0 && (
          <div className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs font-bold text-neutral-800 dark:text-neutral-200">
                  Rincian Angsuran per Bulan ({scheduleRows.length} Bulan)
                </span>
                <span className="text-[11px] text-neutral-500">
                  Sesuaikan nominal jika cicilan bulan awal/tertentu berbeda.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasModifiedSchedule && (
                  <button
                    type="button"
                    onClick={handleResetAllToStandard}
                    className="text-[11px] font-bold text-[var(--primary)] hover:underline"
                  >
                    Reset Rata
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowScheduleDetails((prev) => !prev)}
                  className="rounded-[8px] bg-neutral-200 dark:bg-neutral-700 px-2.5 py-1 text-[11px] font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                >
                  {showScheduleDetails ? "Tutup Rincian" : "Lihat / Edit Rincian"}
                </button>
              </div>
            </div>

            {hasModifiedSchedule && !showScheduleDetails && (
              <div className="flex items-center gap-2 p-2 rounded-[10px] bg-[var(--primary)]/10 text-xs text-[var(--primary)] font-semibold">
                <span>⚠️ Ada cicilan kustom yang berbeda dari nominal standar.</span>
                <button
                  type="button"
                  onClick={() => setShowScheduleDetails(true)}
                  className="underline ml-auto font-bold"
                >
                  Buka Rincian
                </button>
              </div>
            )}

            {showScheduleDetails && (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1 pt-1 border-t border-neutral-200 dark:border-neutral-700">
                {scheduleRows.map((row, idx) => (
                  <div
                    key={row.monthIndex}
                    className={`flex items-center justify-between gap-2.5 p-2 rounded-[10px] border transition-all ${
                      row.isModified
                        ? "bg-white dark:bg-neutral-900 border-[var(--primary)] shadow-xs"
                        : "bg-white/60 dark:bg-neutral-900/40 border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] font-extrabold text-neutral-800 dark:text-neutral-200 shrink-0">
                        {row.monthIndex}
                      </span>
                      <div className="min-w-0">
                        <span className="block text-xs font-bold text-neutral-800 dark:text-neutral-200 truncate">
                          Bulan ke-{row.monthIndex}
                        </span>
                        <span className="block text-[10px] text-neutral-400">
                          Jatuh tempo: {formatShortDate(row.dueDate)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {row.isModified && (
                        <span className="rounded-md bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-extrabold text-[var(--primary)] uppercase">
                          Kustom
                        </span>
                      )}
                      <div className="relative w-32 sm:w-36">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 select-none">
                          Rp
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.amountInput}
                          onChange={(e) => handleRowAmountChange(idx, e.target.value)}
                          placeholder="0"
                          className="tabular-nums font-mono w-full rounded-[8px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 pl-8 pr-2 py-1.5 text-xs font-bold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] text-right"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Optional Pokok vs Bunga Breakdown for Loans */}
        {direction === "payable" && kind === "loan" && (
          <div className="space-y-2 rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 cursor-pointer">
              <input
                type="checkbox"
                checked={splitPrincipalInterest}
                onChange={(e) => setSplitPrincipalInterest(e.target.checked)}
                className="rounded h-4 w-4 accent-[var(--primary)]"
              />
              <span>Rincikan Pokok vs Bunga per Cicilan (Opsional)</span>
            </label>

            {splitPrincipalInterest && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <label
                    htmlFor="debt-principal"
                    className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
                  >
                    Pokok per Bulan (Rp)
                  </label>
                  <input
                    id="debt-principal"
                    inputMode="numeric"
                    value={principalInput}
                    onChange={(e) => setPrincipalInput(formatDigitsInput(e.target.value))}
                    placeholder="0"
                    className="tabular-nums w-full rounded-[10px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-xs font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="debt-interest"
                    className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
                  >
                    Bunga per Bulan (Rp)
                  </label>
                  <input
                    id="debt-interest"
                    inputMode="numeric"
                    value={interestInput}
                    onChange={(e) => setInterestInput(formatDigitsInput(e.target.value))}
                    placeholder="0"
                    className="tabular-nums w-full rounded-[10px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-xs font-bold"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Disbursement Flow Section */}
        <div className="space-y-2 rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 cursor-pointer">
            <input
              type="checkbox"
              checked={recordDisbursement}
              onChange={(e) => setRecordDisbursement(e.target.checked)}
              className="rounded h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              {direction === "receivable"
                ? "Potong Saldo Dompet Sekarang (Saya kirim uangnya hari ini)"
                : "Catat Pencairan Dana ke Dompet Sekarang (Dana pinjaman sudah cair)"}
            </span>
          </label>

          {recordDisbursement && (
            <div className="space-y-2 pt-1">
              <label htmlFor="disburse-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                {direction === "receivable"
                  ? "Pilih Dompet Sumber Dana (Saldo akan berkurang):"
                  : "Pilih Dompet Penerima Dana (Saldo akan bertambah):"}
              </label>
              <select
                id="disburse-wallet"
                value={disburseWalletId ?? ""}
                onChange={(e) => setDisburseWalletId(Number(e.target.value))}
                className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              >
                {liquidWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({formatRupiah(w.balance)})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-neutral-400">
                {direction === "receivable"
                  ? "Transaksi ini akan menurunkan saldo dompet tanpa dihitung sebagai pengeluaran belanja (tidak memotong budget)."
                  : "Transaksi ini akan menambah saldo dompet tanpa dihitung sebagai income gaji."}
              </p>
            </div>
          )}
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
              : direction === "receivable"
                ? "Simpan Piutang"
                : "Simpan Akun Utang"}
          </button>
        </div>
      </form>
    </ModalSheet>
  );
}
