import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DebtDirection, DebtKind } from "../../../shared/src/types";
import { addMonthsToDate, ccCycleForDate, isValidIsoDate } from "../../../shared/src/dates";
import { api, ApiError } from "../lib/api";
import {
  formatDigitsInput,
  formatMonthTitle,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  parsePositiveInt,
} from "../lib/format";
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
  initialDirection = "payable",
  initialKind = "loan",
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  initialDirection?: DebtDirection;
  initialKind?: DebtKind;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [direction, setDirection] = useState<DebtDirection>(initialDirection);
  const [name, setName] = useState("");
  const [lender, setLender] = useState("");
  const [kind, setKind] = useState<DebtKind>(initialKind);
  const [count, setCount] = useState("6");
  const [amountInput, setAmountInput] = useState("");
  const [firstDueDate, setFirstDueDate] = useState(jakartaToday);
  const [paymentMethod, setPaymentMethod] = useState("Transfer");
  const [ccWalletId, setCcWalletId] = useState<number | null>(null);

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

  const liquidWallets = useMemo(
    () => (walletsData?.wallets ?? []).filter((w) => w.isActive && w.type !== "credit_card"),
    [walletsData?.wallets],
  );
  const creditCardWallets = useMemo(
    () => (walletsData?.wallets ?? []).filter((w) => w.isActive && w.type === "credit_card"),
    [walletsData?.wallets],
  );
  const selectedCcWallet =
    creditCardWallets.find((w) => w.id === ccWalletId) ?? creditCardWallets[0] ?? null;

  const installmentCount = Math.max(1, Math.min(120, parseInt(count, 10) || 1));
  const standardAmount = parsePositiveInt(amountInput);

  const defaultLiquidWalletId = liquidWallets[0]?.id ?? null;
  const defaultCcWalletId = creditCardWallets[0]?.id ?? null;
  const defaultCcWalletName = creditCardWallets[0]?.name ?? "";

  useEffect(() => {
    if (!open) return;
    const resolvedDir = initialDirection;
    const resolvedKind =
      resolvedDir === "receivable"
        ? "receivable"
        : initialKind === "receivable"
          ? "loan"
          : initialKind;
    setDirection(resolvedDir);
    setName("");
    setKind(resolvedKind);
    setCount(resolvedDir === "receivable" ? "1" : "6");
    setAmountInput("");
    setFirstDueDate(jakartaToday());
    setPaymentMethod(
      resolvedKind === "card_installment"
        ? "Tagihan kartu"
        : resolvedKind === "payroll"
          ? "Potong gaji"
          : "Transfer",
    );
    setCcWalletId(defaultCcWalletId);
    setLender(resolvedKind === "card_installment" ? defaultCcWalletName : "");
    setRecordDisbursement(false);
    setDisburseWalletId(defaultLiquidWalletId);
    setSplitPrincipalInterest(false);
    setPrincipalInput("");
    setInterestInput("");
    setScheduleRows([]);
    setShowScheduleDetails(false);
    setError("");
  }, [
    open,
    initialDirection,
    initialKind,
    defaultLiquidWalletId,
    defaultCcWalletId,
    defaultCcWalletName,
  ]);

  // Sync / generate schedule when count, amountInput, or firstDueDate changes
  useEffect(() => {
    if (!open || !firstDueDate || !isValidIsoDate(firstDueDate)) return;
    setScheduleRows((prev) => {
      return Array.from({ length: installmentCount }, (_, i) => {
        const { period, dueDate } = addMonthsToDate(firstDueDate, i);
        const existing = prev[i];
        if (existing?.isModified) {
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

  const isCardInstallment = direction === "payable" && kind === "card_installment";
  const isCardLimitExceeded = Boolean(
    isCardInstallment && selectedCcWallet && totalCalculated > selectedCcWallet.balance,
  );
  const missingCcWallet = isCardInstallment && creditCardWallets.length === 0;

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

  const handleKindChange = (nextKind: DebtKind) => {
    setKind(nextKind);
    setError("");
    if (nextKind === "card_installment") {
      setRecordDisbursement(false);
      if (paymentMethod === "Transfer" || paymentMethod === "Potong gaji") {
        setPaymentMethod("Tagihan kartu");
      }
      if (!lender.trim() && selectedCcWallet) {
        setLender(selectedCcWallet.name);
      }
    } else if (nextKind === "payroll") {
      if (paymentMethod === "Transfer" || paymentMethod === "Tagihan kartu") {
        setPaymentMethod("Potong gaji");
      }
    } else if (paymentMethod === "Tagihan kartu" || paymentMethod === "Potong gaji") {
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

      if (isCardInstallment) {
        if (!selectedCcWallet) {
          throw new Error(
            "Tambahkan dompet Kartu Kredit terlebih dahulu sebelum mencatat cicilan kartu kredit.",
          );
        }
        const checkTotal = hasModifiedSchedule
          ? scheduleRows.reduce((sum, r) => sum + (r.amount > 0 ? r.amount : installmentAmount), 0)
          : installmentCount * installmentAmount;
        if (checkTotal > selectedCcWallet.balance) {
          throw new Error(
            `Total cicilan (${formatRupiah(checkTotal)}) melebihi sisa limit ${selectedCcWallet.name} (${formatRupiah(selectedCcWallet.balance)}).`,
          );
        }
      }

      if (!isCardInstallment && recordDisbursement && !disburseWalletId) {
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
        walletId: isCardInstallment ? selectedCcWallet?.id ?? null : null,
        disburseWalletId: !isCardInstallment && recordDisbursement ? disburseWalletId : null,
        recordDisbursement: !isCardInstallment && recordDisbursement,
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

  const inputClass =
    "w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";
  const selectClass =
    "h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";
  const labelClass =
    "block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]";

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      size="lg"
      title={
        direction === "receivable"
          ? "Tambah Piutang (Tagih Balik)"
          : "Tambah Akun Utang & Cicilan"
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={mutation.isPending || missingCcWallet || isCardLimitExceeded}
          >
            {mutation.isPending
              ? "Menyimpan..."
              : direction === "receivable"
                ? "Simpan Piutang"
                : "Simpan Akun Utang"}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {/* Direction Switcher (Utang vs Piutang) */}
        <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[var(--surface)] p-1 border border-[var(--border)]">
          <button
            type="button"
            onClick={() => handleDirectionChange("payable")}
            className={`min-h-[44px] whitespace-nowrap rounded-[10px] px-2 text-xs font-bold transition-all ${
              direction === "payable"
                ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            Utang Saya (Pinjam)
          </button>
          <button
            type="button"
            onClick={() => handleDirectionChange("receivable")}
            className={`min-h-[44px] whitespace-nowrap rounded-[10px] px-2 text-xs font-bold transition-all ${
              direction === "receivable"
                ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            Piutang (Meminjamkan)
          </button>
        </div>

        {/* Name / Keterangan */}
        <div className="space-y-1.5">
          <label htmlFor="debt-name" className={labelClass}>
            {direction === "receivable" ? "Keterangan Piutang" : "Nama Utang / Cicilan"}
          </label>
          <input
            id="debt-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              direction === "receivable"
                ? "Contoh: Talangan tiket Budi"
                : "Contoh: Flexi Cash Renovasi"
            }
            className={inputClass}
          />
        </div>

        {/* Counterparty & Kind */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-lender" className={labelClass}>
              {direction === "receivable" ? "Peminjam" : "Pemberi Pinjaman"}
            </label>
            <input
              id="debt-lender"
              type="text"
              value={lender}
              onChange={(e) => setLender(e.target.value)}
              placeholder={
                direction === "receivable"
                  ? "Contoh: Budi"
                  : "Contoh: Bank BCA"
              }
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-kind" className={labelClass}>
              Jenis
            </label>
            {direction === "receivable" ? (
              <input
                id="debt-kind"
                type="text"
                disabled
                value="Piutang Pribadi / Talangan"
                className="w-full rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] cursor-not-allowed"
              />
            ) : (
              <select
                id="debt-kind"
                value={kind}
                onChange={(e) => handleKindChange(e.target.value as DebtKind)}
                className={selectClass}
              >
                <option value="loan">Pinjaman Tunai</option>
                <option value="card_installment">Cicilan Kartu Kredit</option>
                <option value="payroll">Potongan Gaji Kantor</option>
              </select>
            )}
          </div>
        </div>

        {/* Credit Card Target Selector for card_installment */}
        {isCardInstallment && (
          <div className="space-y-2.5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <label htmlFor="debt-cc-wallet" className={labelClass}>
              Kartu Kredit Penanggung Cicilan
            </label>
            {missingCcWallet ? (
              <div className="flex items-start gap-2 rounded-[12px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200">
                <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <div>
                  <p className="font-bold">Belum Ada Dompet Kartu Kredit</p>
                  <p className="mt-0.5">
                    Tambahkan dompet bertipe <strong>Kartu Kredit</strong> di menu Dompet terlebih
                    dahulu agar cicilan dapat memotong limit kartu secara otomatis.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <select
                  id="debt-cc-wallet"
                  value={selectedCcWallet?.id ?? ""}
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    const prevName = selectedCcWallet?.name;
                    const nextCard = creditCardWallets.find((w) => w.id === nextId);
                    setCcWalletId(nextId);
                    if (nextCard && (!lender.trim() || lender === prevName)) {
                      setLender(nextCard.name);
                    }
                  }}
                  className={selectClass}
                >
                  {creditCardWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — Sisa Limit: {formatRupiah(w.balance)} (dari{" "}
                      {formatRupiah(w.creditLimit ?? 0)})
                    </option>
                  ))}
                </select>
                {selectedCcWallet && (
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div className="rounded-[10px] bg-[var(--card)] px-3 py-2 border border-dashed border-[var(--border)]">
                      <span className="text-[var(--muted-foreground)] block">Sisa Limit Saat Ini</span>
                      <strong className="font-mono text-xs text-[var(--foreground)]">
                        {formatRupiah(selectedCcWallet.balance)}
                      </strong>
                    </div>
                    <div className="rounded-[10px] bg-[var(--card)] px-3 py-2 border border-dashed border-[var(--border)]">
                      <span className="text-[var(--muted-foreground)] block">Sisa Limit Setelah Cicilan</span>
                      <strong
                        className={`font-mono text-xs ${
                          isCardLimitExceeded
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {formatRupiah(Math.max(0, selectedCcWallet.balance - totalCalculated))}
                      </strong>
                    </div>
                  </div>
                )}
                {isCardLimitExceeded && selectedCcWallet && (
                  <div className="flex items-start gap-2 rounded-[12px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2.5 text-xs text-rose-800 dark:text-rose-200">
                    <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span>
                      Total cicilan ({formatRupiah(totalCalculated)}) melebihi sisa limit{" "}
                      {selectedCcWallet.name} ({formatRupiah(selectedCcWallet.balance)}).
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Installment count & amount */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-count" className={labelClass}>
              {direction === "receivable" ? "Jumlah Kali Bayar (Bulan)" : "Jumlah Cicilan (Bulan)"}
            </label>
            <input
              id="debt-count"
              type="number"
              min={1}
              max={120}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className={`tabular-nums ${inputClass}`}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-amount" className={labelClass}>
              Nominal per Bulan (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="debt-amount"
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => setAmountInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-bold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        {/* Total Preview */}
        {totalCalculated > 0 && (
          <div className="rounded-[14px] bg-[var(--surface)] border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>Total Nilai {direction === "receivable" ? "Piutang" : "Utang"}:</span>
              {hasModifiedSchedule && (
                <span className="rounded-md bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-extrabold text-[var(--primary)]">
                  Jadwal Kustom
                </span>
              )}
            </div>
            <span className="tabular-nums text-sm font-black text-[var(--foreground)]">
              {formatRupiah(totalCalculated)}
            </span>
          </div>
        )}

        {/* Due date & payment method */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="debt-due" className={labelClass}>
              Jatuh Tempo Pertama
            </label>
            <input
              id="debt-due"
              type="date"
              value={firstDueDate}
              onChange={(e) => setFirstDueDate(e.target.value)}
              className={`tabular-nums ${inputClass}`}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="debt-method" className={labelClass}>
              Metode Bayar
            </label>
            <input
              id="debt-method"
              type="text"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="Contoh: Transfer BCA"
              className={inputClass}
            />
          </div>
        </div>

        {/* Rincian Angsuran per Bulan (Customizable Schedule) */}
        {installmentCount > 1 && standardAmount > 0 && (
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs font-bold text-[var(--foreground)]">
                  Rincian Angsuran per Bulan ({scheduleRows.length} Bulan)
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)]">
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
                  className="rounded-[8px] border border-[var(--control-border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
                >
                  {showScheduleDetails ? "Tutup Rincian" : "Lihat / Edit Rincian"}
                </button>
              </div>
            </div>

            {hasModifiedSchedule && !showScheduleDetails && (
              <div className="flex items-center gap-2 p-2 rounded-[10px] bg-[var(--primary)]/10 text-xs text-[var(--primary)] font-semibold">
                <span>Ada cicilan kustom yang berbeda dari nominal standar.</span>
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
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1 pt-1 border-t border-[var(--border)]">
                {scheduleRows.map((row, idx) => (
                  <div
                    key={row.monthIndex}
                    className={`flex items-center justify-between gap-2.5 p-2 rounded-[10px] border transition-all ${
                      row.isModified
                        ? "bg-[var(--card)] border-[var(--primary)] shadow-xs"
                        : "bg-[var(--card)] border-[var(--border)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] text-[10px] font-extrabold text-[var(--foreground)] shrink-0">
                        {row.monthIndex}
                      </span>
                      <div className="min-w-0">
                        <span className="block text-xs font-bold text-[var(--foreground)] truncate">
                          Bulan ke-{row.monthIndex}
                        </span>
                        <span className="block text-[10px] text-[var(--muted-foreground)]">
                          Jatuh tempo: {formatShortDate(row.dueDate)}
                          {isCardInstallment && selectedCcWallet && (
                            <>
                              {" "}
                              ·{" "}
                              <strong className="text-[var(--primary)]">
                                Siklus{" "}
                                {formatMonthTitle(
                                  ccCycleForDate(row.dueDate, selectedCcWallet.cutoffDay ?? 20),
                                )}
                              </strong>
                            </>
                          )}
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
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted-foreground)] select-none">
                          Rp
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.amountInput}
                          onChange={(e) => handleRowAmountChange(idx, e.target.value)}
                          placeholder="0"
                          className="tabular-nums font-mono w-full rounded-[8px] bg-[var(--card)] border border-[var(--control-border)] pl-8 pr-2 py-1.5 text-xs font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] text-right"
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
          <div className="space-y-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] cursor-pointer">
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
                  <label htmlFor="debt-principal" className={labelClass}>
                    Pokok per Bulan (Rp)
                  </label>
                  <input
                    id="debt-principal"
                    inputMode="numeric"
                    value={principalInput}
                    onChange={(e) => setPrincipalInput(formatDigitsInput(e.target.value))}
                    placeholder="0"
                    className="tabular-nums w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 py-2 text-xs font-bold text-[var(--foreground)]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="debt-interest" className={labelClass}>
                    Bunga per Bulan (Rp)
                  </label>
                  <input
                    id="debt-interest"
                    inputMode="numeric"
                    value={interestInput}
                    onChange={(e) => setInterestInput(formatDigitsInput(e.target.value))}
                    placeholder="0"
                    className="tabular-nums w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 py-2 text-xs font-bold text-[var(--foreground)]"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Disbursement Flow Section (not applicable for CC installment since it locks card limit) */}
        {!isCardInstallment && (
          <div className="space-y-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] cursor-pointer">
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
                <label htmlFor="disburse-wallet" className={labelClass}>
                  {direction === "receivable"
                    ? "Pilih Dompet Sumber Dana (Saldo akan berkurang):"
                    : "Pilih Dompet Penerima Dana (Saldo akan bertambah):"}
                </label>
                <select
                  id="disburse-wallet"
                  value={disburseWalletId ?? ""}
                  onChange={(e) => setDisburseWalletId(Number(e.target.value))}
                  className={selectClass}
                >
                  {liquidWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({formatRupiah(w.balance)})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {direction === "receivable"
                    ? "Transaksi ini akan menurunkan saldo dompet tanpa dihitung sebagai pengeluaran belanja (tidak memotong anggaran)."
                    : "Transaksi ini akan menambah saldo dompet tanpa dihitung sebagai income gaji."}
                </p>
              </div>
            )}
          </div>
        )}

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
