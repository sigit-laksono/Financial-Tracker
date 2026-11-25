import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMonthsToDate, ccCycleForDate, isValidIsoDate } from "../../../shared/src/dates";
import type { DebtKind } from "../../../shared/src/types";
import {
  api,
  ApiError,
  type DebtAccountDto,
  type InstallmentDto,
  type WalletDto,
} from "../lib/api";
import {
  MAX_IDR_AMOUNT,
  formatDigitsInput,
  formatMonthTitle,
  formatRupiah,
  parsePositiveInt,
} from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { AlertIcon, CalendarIcon } from "./Icons";
import { Badge, Button, ModalSheet } from "./UI";

interface EditableRow {
  id: number;
  monthIndex: number;
  dueDate: string;
  amount: number;
  amountInput: string;
  status: "upcoming" | "paid";
  actualAmount: number | null;
}

export function EditDebtModal({
  account,
  installments,
  wallets,
  onClose,
  onSuccess,
}: {
  account: DebtAccountDto | null;
  installments: InstallmentDto[];
  wallets: WalletDto[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const formId = useId();

  const [name, setName] = useState("");
  const [lender, setLender] = useState("");
  const [kind, setKind] = useState<DebtKind>("loan");
  const [ccWalletId, setCcWalletId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Transfer");
  const [anchorDueDate, setAnchorDueDate] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [error, setError] = useState("");

  const creditCardWallets = useMemo(
    () => wallets.filter((w) => w.isActive && w.type === "credit_card"),
    [wallets],
  );

  const selectedCcWallet = useMemo(
    () => creditCardWallets.find((w) => w.id === ccWalletId) ?? creditCardWallets[0] ?? null,
    [creditCardWallets, ccWalletId],
  );

  const prevAccountIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!account) {
      prevAccountIdRef.current = null;
      return;
    }
    if (prevAccountIdRef.current === account.id) return;
    prevAccountIdRef.current = account.id;

    setName(account.name);
    setLender(account.lender);
    setKind(account.kind);
    setPaymentMethod(account.paymentMethod);

    const activeCcList = wallets.filter((w) => w.isActive && w.type === "credit_card");
    const defaultCc = activeCcList.find((w) => w.id === account.walletId) ?? activeCcList[0] ?? null;
    setCcWalletId(account.walletId ?? defaultCc?.id ?? null);

    const accountRows = installments
      .filter((i) => i.accountId === account.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id)
      .map((item, idx) => ({
        id: item.id,
        monthIndex: idx + 1,
        dueDate: item.dueDate,
        amount: item.plannedAmount,
        amountInput: item.plannedAmount.toLocaleString("id-ID"),
        status: item.status,
        actualAmount: item.actualAmount,
      }));

    setRows(accountRows);
    const firstUpcoming = accountRows.find((r) => r.status === "upcoming") ?? accountRows[0];
    setAnchorDueDate(firstUpcoming?.dueDate ?? "");
    setError("");
  }, [account, installments, wallets]);

  const upcomingCount = rows.filter((r) => r.status === "upcoming").length;

  const handleShiftDatesFromAnchor = () => {
    if (!anchorDueDate || !isValidIsoDate(anchorDueDate)) {
      setError("Format tanggal jatuh tempo patokan tidak valid.");
      return;
    }
    setError("");
    let upcomingIdx = 0;
    setRows((prev) =>
      prev.map((row) => {
        if (row.status === "paid") return row;
        const { dueDate } = addMonthsToDate(anchorDueDate, upcomingIdx);
        upcomingIdx += 1;
        return { ...row, dueDate };
      }),
    );
  };

  const handleRowDateChange = (id: number, nextDate: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, dueDate: nextDate } : r)));
  };

  const handleRowAmountChange = (id: number, raw: string) => {
    const formatted = formatDigitsInput(raw);
    const parsed = parsePositiveInt(formatted);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, amountInput: formatted, amount: parsed } : r)),
    );
  };

  const totalEditedRemaining = useMemo(
    () =>
      rows
        .filter((r) => r.status === "upcoming")
        .reduce((sum, r) => sum + Math.max(r.amount, 0), 0),
    [rows],
  );

  const totalEditedOverall = useMemo(
    () =>
      rows.reduce(
        (sum, r) =>
          sum + (r.status === "paid" ? (r.actualAmount ?? r.amount) : Math.max(r.amount, 0)),
        0,
      ),
    [rows],
  );

  const isCardInstallment = account?.direction !== "receivable" && kind === "card_installment";
  const missingCcWallet = isCardInstallment && creditCardWallets.length === 0;

  const effectiveAvailableLimit = useMemo(() => {
    if (!isCardInstallment || !selectedCcWallet || !account) return 0;
    const alreadyCountedOnTarget =
      !account.closed &&
      account.kind === "card_installment" &&
      (account.walletId === selectedCcWallet.id ||
        (creditCardWallets.length === 1 && account.walletId === null));
    return selectedCcWallet.balance + (alreadyCountedOnTarget ? account.remainingBalance : 0);
  }, [isCardInstallment, selectedCcWallet, account, creditCardWallets.length]);

  const isCardLimitExceeded = Boolean(
    isCardInstallment &&
      !account?.closed &&
      selectedCcWallet &&
      totalEditedRemaining > effectiveAvailableLimit,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!account) return;
      if (!name.trim() || !lender.trim()) {
        throw new Error(
          account.direction === "receivable"
            ? "Keterangan piutang dan nama peminjam wajib diisi."
            : "Nama utang dan pemberi pinjaman wajib diisi.",
        );
      }
      if (isCardInstallment && !selectedCcWallet) {
        throw new Error("Tambahkan dompet Kartu Kredit terlebih dahulu sebelum menautkan cicilan.");
      }
      if (isCardLimitExceeded && selectedCcWallet) {
        throw new Error(
          `Sisa cicilan (${formatRupiah(totalEditedRemaining)}) melebihi sisa limit ${selectedCcWallet.name} (${formatRupiah(effectiveAvailableLimit)}).`,
        );
      }

      for (const row of rows) {
        if (row.status === "upcoming") {
          if (!isValidIsoDate(row.dueDate)) {
            throw new Error(`Tanggal jatuh tempo bulan ke-${row.monthIndex} tidak valid.`);
          }
          if (row.amount <= 0) {
            throw new Error(`Nominal cicilan bulan ke-${row.monthIndex} harus lebih dari Rp0.`);
          }
          if (row.amount > MAX_IDR_AMOUNT) {
            throw new Error(
              `Nominal cicilan bulan ke-${row.monthIndex} maksimal Rp 2.147.483.647.`,
            );
          }
        }
      }

      return api.updateDebt(account.id, {
        name: name.trim(),
        lender: lender.trim(),
        kind: account.direction === "receivable" ? "receivable" : kind,
        paymentMethod: paymentMethod.trim() || "Transfer",
        walletId: isCardInstallment ? selectedCcWallet?.id ?? null : null,
        installments: rows.map((r) => ({
          id: r.id,
          dueDate: r.dueDate,
          plannedAmount: r.amount,
        })),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      onSuccess("Perubahan akun utang dan jadwal cicilan berhasil disimpan");
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

  if (!account) return null;

  const isSplitPayAccount = Boolean(account.sourceTransactionId);
  const isReceivable = account.direction === "receivable";
  const inputClass =
    "w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";
  const selectClass =
    "h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all disabled:opacity-60";
  const labelClass =
    "block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]";

  return (
    <ModalSheet
      open={Boolean(account)}
      onClose={onClose}
      title={isReceivable ? `Edit Piutang: ${account.name}` : `Edit Utang & Cicilan: ${account.name}`}
      subtitle="Ubah detail akun, tautkan ke kartu kredit, atau perbaiki tanggal & nominal cicilan yang belum lunas."
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
            {mutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="edit-debt-name" className={labelClass}>
            {isReceivable ? "Keterangan Piutang" : "Nama Utang / Cicilan"}
          </label>
          <input
            id="edit-debt-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="edit-debt-lender" className={labelClass}>
              {isReceivable ? "Peminjam" : "Pemberi Pinjaman"}
            </label>
            <input
              id="edit-debt-lender"
              type="text"
              value={lender}
              onChange={(e) => setLender(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-debt-kind" className={labelClass}>
              Jenis
            </label>
            {isReceivable ? (
              <input
                id="edit-debt-kind"
                type="text"
                disabled
                value="Piutang Pribadi / Talangan"
                className="w-full rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] cursor-not-allowed"
              />
            ) : (
              <select
                id="edit-debt-kind"
                value={kind}
                disabled={isSplitPayAccount}
                onChange={(e) => {
                  const nextKind = e.target.value as DebtKind;
                  setKind(nextKind);
                  if (nextKind === "card_installment" && selectedCcWallet && lender === account.lender && !account.walletId) {
                    setPaymentMethod("Tagihan kartu");
                  }
                }}
                className={selectClass}
              >
                <option value="loan">Pinjaman Tunai</option>
                <option value="card_installment">Cicilan Kartu Kredit</option>
                <option value="payroll">Potongan Gaji Kantor</option>
              </select>
            )}
          </div>
        </div>

        {/* Link / Change Credit Card for card_installment */}
        {isCardInstallment && (
          <div className="space-y-2.5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <label htmlFor="edit-debt-cc-wallet" className={labelClass}>
              Kartu Kredit Penanggung Cicilan
            </label>
            {missingCcWallet ? (
              <div className="flex items-start gap-2 rounded-[12px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200">
                <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <span>
                  Belum ada dompet Kartu Kredit aktif. Tambahkan dompet Kartu Kredit di menu Dompet
                  terlebih dahulu agar cicilan ini bisa ditautkan.
                </span>
              </div>
            ) : (
              <>
                <select
                  id="edit-debt-cc-wallet"
                  value={selectedCcWallet?.id ?? ""}
                  disabled={isSplitPayAccount}
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    const nextCard = creditCardWallets.find((w) => w.id === nextId);
                    setCcWalletId(nextId);
                    if (nextCard && (!account.walletId || lender === selectedCcWallet?.name)) {
                      setLender(nextCard.name);
                    }
                  }}
                  className={selectClass}
                >
                  {creditCardWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — Sisa Limit: {formatRupiah(w.balance, isMasked)} (dari{" "}
                      {formatRupiah(w.creditLimit ?? 0, isMasked)})
                    </option>
                  ))}
                </select>
                {selectedCcWallet && (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-[10px] bg-[var(--card)] px-3 py-2 border border-dashed border-[var(--border)]">
                      <span className="text-[var(--muted-foreground)] block">Kapasitas Limit Tersedia</span>
                      <strong className="font-mono text-xs text-[var(--foreground)]">
                        {formatRupiah(effectiveAvailableLimit, isMasked)}
                      </strong>
                    </div>
                    <div className="rounded-[10px] bg-[var(--card)] px-3 py-2 border border-dashed border-[var(--border)]">
                      <span className="text-[var(--muted-foreground)] block">Sisa Limit Setelah Simpan</span>
                      <strong
                        className={`font-mono text-xs ${
                          isCardLimitExceeded
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {formatRupiah(Math.max(0, effectiveAvailableLimit - totalEditedRemaining), isMasked)}
                      </strong>
                    </div>
                  </div>
                )}
                {isCardLimitExceeded && selectedCcWallet && (
                  <div className="flex items-start gap-2 rounded-[12px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2.5 text-xs text-rose-800 dark:text-rose-200">
                    <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span>
                      Sisa cicilan ({formatRupiah(totalEditedRemaining, isMasked)}) melebihi kapasitas limit{" "}
                      {selectedCcWallet.name} ({formatRupiah(effectiveAvailableLimit, isMasked)}).
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="edit-debt-method" className={labelClass}>
            Metode Bayar
          </label>
          <input
            id="edit-debt-method"
            type="text"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Installment Schedule Editor (Preserves Custom Amounts when shifting dates!) */}
        {rows.length > 0 && (
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="block text-xs font-bold text-[var(--foreground)]">
                  Jadwal Angsuran ({rows.length} Bulan)
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  Ubah tanggal jatuh tempo atau nominal per bulan tanpa kehilangan custom cicilan.
                </span>
              </div>
              <strong className="font-mono text-xs text-[var(--primary)]">
                Total: {formatRupiah(totalEditedOverall, isMasked)}
              </strong>
            </div>

            {upcomingCount > 0 && (
              <div className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-2.5 space-y-2">
                <label
                  htmlFor="edit-debt-anchor-date"
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--muted-foreground)]"
                >
                  <CalendarIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span>Geser Semua Jatuh Tempo Belum Lunas Mulai Tanggal:</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="edit-debt-anchor-date"
                    type="date"
                    value={anchorDueDate}
                    onChange={(e) => setAnchorDueDate(e.target.value)}
                    className="tabular-nums flex-1 min-w-[150px] rounded-[10px] bg-[var(--surface)] border border-[var(--control-border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleShiftDatesFromAnchor}
                    className="min-h-[44px] px-3 text-xs font-bold"
                  >
                    Geser Tanggal (Nominal Tetap)
                  </Button>
                </div>
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 pt-1 border-t border-[var(--border)]">
              {rows.map((row) => {
                const isPaid = row.status === "paid";
                return (
                  <div
                    key={row.id}
                    className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[10px] border ${
                      isPaid
                        ? "bg-[var(--surface)] border-[var(--border)] opacity-80"
                        : "bg-[var(--card)] border-[var(--border)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] text-[10px] font-extrabold text-[var(--foreground)] shrink-0">
                        {row.monthIndex}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--foreground)]">
                            Bulan ke-{row.monthIndex}
                          </span>
                          <Badge tone={isPaid ? "soft" : "neutral"}>
                            {isPaid ? "Lunas" : "Belum Lunas"}
                          </Badge>
                          {isCardInstallment && selectedCcWallet && !isSplitPayAccount && isValidIsoDate(row.dueDate) && (
                            <span className="text-[10px] font-semibold text-[var(--primary)]">
                              · Siklus{" "}
                              {formatMonthTitle(
                                ccCycleForDate(row.dueDate, selectedCcWallet.cutoffDay ?? 20),
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      <input
                        type="date"
                        aria-label={`Tanggal jatuh tempo bulan ke-${row.monthIndex}`}
                        disabled={isPaid}
                        value={row.dueDate}
                        onChange={(e) => handleRowDateChange(row.id, e.target.value)}
                        className="tabular-nums rounded-[8px] bg-[var(--surface)] border border-[var(--control-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--foreground)] disabled:opacity-60"
                      />
                      <div className="relative w-32">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted-foreground)] select-none">
                          Rp
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Nominal bulan ke-${row.monthIndex}`}
                          disabled={isPaid}
                          value={
                            isPaid
                              ? (row.actualAmount ?? row.amount).toLocaleString("id-ID")
                              : row.amountInput
                          }
                          onChange={(e) => handleRowAmountChange(row.id, e.target.value)}
                          className="tabular-nums font-mono w-full rounded-[8px] bg-[var(--surface)] border border-[var(--control-border)] pl-8 pr-2 py-1.5 text-xs font-bold text-[var(--foreground)] text-right disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
