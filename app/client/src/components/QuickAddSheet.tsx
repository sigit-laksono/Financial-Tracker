import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type CategoryDto,
  type DebtsDto,
  type TransactionDto,
  type WalletDto,
} from "../lib/api";
import {
  formatCompactRupiah,
  formatDigitsInput,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  parsePositiveInt,
  spellOutRupiah,
} from "../lib/format";
import { budgetKeys } from "../lib/queryKeys";
import { AlertIcon, SplitPayIcon, TrashIcon } from "./Icons";
import { Badge, Button, ModalSheet } from "./UI";

export type QuickAddMode = "expense" | "income" | "transfer" | "settle";

const MODE_TABS: ReadonlyArray<readonly [QuickAddMode, string]> = [
  ["expense", "Pengeluaran"],
  ["income", "Pemasukan"],
  ["transfer", "Transfer"],
  ["settle", "Bayar Kewajiban"],
];

type SplitItemState = {
  keyId: string;
  category: string;
  amountInput: string;
  note: string;
};

export function QuickAddSheet({
  open,
  onClose,
  wallets,
  categories,
  debts,
  initialMode = "expense",
  editingTx = null,
  preselectedInstallmentIds = [],
  preselectedCcCycleKey = "",
  preselectedCcWalletId,
  onSuccessMessage,
  onRequestSplitPay,
}: {
  open: boolean;
  onClose: () => void;
  wallets: WalletDto[];
  categories: CategoryDto[];
  debts: DebtsDto | undefined;
  initialMode?: QuickAddMode;
  editingTx?: TransactionDto | null;
  preselectedInstallmentIds?: number[];
  preselectedCcCycleKey?: string;
  preselectedCcWalletId?: number;
  onSuccessMessage: (msg: string) => void;
  onRequestSplitPay?: (tx: TransactionDto) => void;
}) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { data: presets } = useQuery({
    queryKey: ["quick-presets"],
    queryFn: () => api.getQuickPresets(),
    enabled: open,
    staleTime: 30_000,
  });

  const activeWallets = useMemo(() => wallets.filter((w) => w.isActive), [wallets]);
  const cashWallets = useMemo(
    () => activeWallets.filter((w) => w.type !== "credit_card"),
    [activeWallets],
  );
  const expenseCategories = useMemo(
    () => categories.filter((c) => !c.isArchived && c.type === "expense"),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((c) => !c.isArchived && c.type === "income"),
    [categories],
  );
  const upcomingInstallments = useMemo(
    () =>
      (debts?.installments ?? []).filter(
        (i) => !i.accountClosed && i.accountKind !== "payroll" && i.status === "upcoming",
      ),
    [debts],
  );
  const unpaidCcCycles = useMemo(() => {
    if (debts?.cards && debts.cards.length > 0) {
      return debts.cards.flatMap((card) =>
        card.cycleSummaries
          .filter((c) => !c.settled && c.totalBill > 0)
          .map((c) => ({
            ...c,
            walletId: card.walletId,
            walletName: card.walletName,
            key: `cc:${card.walletId}:${c.cycleKey}`,
          })),
      );
    }
    return (debts?.cycleSummaries ?? [])
      .filter((c) => !c.settled && c.totalBill > 0)
      .map((c) => ({
        ...c,
        walletId: undefined as number | undefined,
        walletName: "Kartu Kredit",
        key: `cc:0:${c.cycleKey}`,
      }));
  }, [debts]);

  const [mode, setMode] = useState<QuickAddMode>(initialMode);
  const [merchant, setMerchant] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const amountInputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(jakartaToday);
  const [walletId, setWalletId] = useState<number>(cashWallets[0]?.id ?? 1);
  const [toWalletId, setToWalletId] = useState<number>(
    cashWallets[1]?.id ?? cashWallets[0]?.id ?? 1,
  );
  const [adminFeeInput, setAdminFeeInput] = useState("");
  const [category, setCategory] = useState("Makanan & Minuman");
  const [note, setNote] = useState("");
  const [settleTarget, setSettleTarget] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);
  const [error, setError] = useState("");

  // Split Category states
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<SplitItemState[]>([
    { keyId: "split-1", category: "Makanan & Minuman", amountInput: "", note: "" },
    { keyId: "split-2", category: "Belanja", amountInput: "", note: "" },
  ]);

  const preselectedInstKey = preselectedInstallmentIds.join(",");

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);

    if (editingTx) {
      if (editingTx.type === "transfer") {
        setMode("transfer");
        setMerchant(editingTx.merchant);
        setAmountInput(editingTx.amount.toLocaleString("id-ID"));
        setDate(editingTx.transactionDate);
        setWalletId(editingTx.walletId);
        setToWalletId(editingTx.toWalletId ?? cashWallets[0]?.id ?? 1);
        setAdminFeeInput(
          editingTx.linkedFeeTransaction?.amount
            ? editingTx.linkedFeeTransaction.amount.toLocaleString("id-ID")
            : "",
        );
        setNote(editingTx.note ?? "");
        setIsSplit(false);
        return;
      }

      setMode(editingTx.type === "income" ? "income" : "expense");
      setMerchant(editingTx.merchant);
      setAmountInput(editingTx.amount.toLocaleString("id-ID"));
      setDate(editingTx.transactionDate);
      setWalletId(editingTx.walletId);
      setCategory(editingTx.category);
      setNote(editingTx.note ?? "");

      if (editingTx.splits && editingTx.splits.length > 0) {
        setIsSplit(true);
        setSplits(
          editingTx.splits.map((s, i) => ({
            keyId: `split-${s.id ?? i}`,
            category: s.category,
            amountInput: s.amount.toLocaleString("id-ID"),
            note: s.note ?? "",
          })),
        );
      } else {
        setIsSplit(false);
      }
      return;
    }

    setMode(initialMode);
    setMerchant("");
    setAmountInput("");
    setAdminFeeInput("");
    setDate(jakartaToday());
    const savedWalletId = Number(localStorage.getItem("ft-last-wallet-id"));
    const rememberedWallet =
      activeWallets.find(
        (w) => w.id === savedWalletId && (initialMode !== "transfer" || w.type !== "credit_card"),
      ) ??
      cashWallets[0] ??
      activeWallets[0];
    setWalletId(rememberedWallet?.id ?? 1);
    setToWalletId(cashWallets[1]?.id ?? cashWallets[0]?.id ?? 1);
    setNote("");
    setIsSplit(false);
    setSplits([
      {
        keyId: "split-1",
        category: expenseCategories[0]?.name ?? "Makanan & Minuman",
        amountInput: "",
        note: "",
      },
      {
        keyId: "split-2",
        category: expenseCategories[1]?.name ?? "Belanja",
        amountInput: "",
        note: "",
      },
    ]);

    if (initialMode === "income") {
      setCategory(incomeCategories[0]?.name ?? "Gaji");
    } else {
      setCategory(expenseCategories[0]?.name ?? "Makanan & Minuman");
    }

    if (preselectedCcCycleKey) {
      const matched =
        unpaidCcCycles.find(
          (c) =>
            c.cycleKey === preselectedCcCycleKey &&
            (preselectedCcWalletId === undefined || c.walletId === preselectedCcWalletId),
        ) ?? unpaidCcCycles.find((c) => c.cycleKey === preselectedCcCycleKey);
      setSettleTarget(matched?.key ?? `cc:${preselectedCcWalletId ?? 0}:${preselectedCcCycleKey}`);
    } else if (preselectedInstKey) {
      setSettleTarget(`inst:${preselectedInstKey}`);
    } else if (upcomingInstallments[0]) {
      setSettleTarget(`inst:${upcomingInstallments[0].id}`);
    } else if (unpaidCcCycles[0]) {
      setSettleTarget(unpaidCcCycles[0].key);
    } else {
      setSettleTarget("");
    }
  }, [
    open,
    editingTx,
    initialMode,
    preselectedCcCycleKey,
    preselectedCcWalletId,
    preselectedInstKey,
    cashWallets,
    activeWallets,
    incomeCategories,
    expenseCategories,
    upcomingInstallments,
    unpaidCcCycles,
  ]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      amountInputRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  const parsedTotalAmount = parsePositiveInt(amountInput);
  const parsedSplitSum = useMemo(
    () => splits.reduce((sum, s) => sum + parsePositiveInt(s.amountInput), 0),
    [splits],
  );
  const splitDelta = parsedTotalAmount - parsedSplitSum;

  const selectedSettleBillAmount = useMemo(() => {
    if (settleTarget.startsWith("cc:")) {
      const cycle = unpaidCcCycles.find((c) => c.key === settleTarget);
      return cycle?.totalBill ?? 0;
    }
    const instId = Number(settleTarget.slice(5));
    const inst = upcomingInstallments.find((i) => i.id === instId);
    return inst?.plannedAmount ?? 0;
  }, [settleTarget, unpaidCcCycles, upcomingInstallments]);

  const selectedExpenseWallet = useMemo(
    () => activeWallets.find((w) => w.id === walletId) ?? null,
    [activeWallets, walletId],
  );

  const selectedCcCard = useMemo(() => {
    if (!selectedExpenseWallet || selectedExpenseWallet.type !== "credit_card") return null;
    return debts?.cards?.find((c) => c.walletId === selectedExpenseWallet.id) ?? null;
  }, [debts, selectedExpenseWallet]);

  const effectiveCcAvailableLimit = useMemo(() => {
    if (!selectedExpenseWallet || selectedExpenseWallet.type !== "credit_card") return 0;
    let available = selectedExpenseWallet.balance;
    if (
      editingTx &&
      editingTx.type === "expense" &&
      editingTx.walletId === selectedExpenseWallet.id &&
      !editingTx.isConvertedToInstallment
    ) {
      const oldCycle = selectedCcCard?.cycleSummaries.find(
        (c) => c.cycleKey === editingTx.ccCycleKey,
      );
      if (!oldCycle?.dailySettled) {
        available += editingTx.amount;
      }
    }
    return available;
  }, [selectedExpenseWallet, selectedCcCard, editingTx]);

  const isCcLimitExceeded = Boolean(
    mode === "expense" &&
      selectedExpenseWallet?.type === "credit_card" &&
      parsedTotalAmount > 0 &&
      parsedTotalAmount > effectiveCcAvailableLimit,
  );

  const selectedSettleWallet = useMemo(() => {
    return cashWallets.find((w) => w.id === walletId) ?? cashWallets[0] ?? null;
  }, [cashWallets, walletId]);

  const isSettleInsufficient = Boolean(
    mode === "settle" &&
      selectedSettleWallet &&
      selectedSettleBillAmount > 0 &&
      selectedSettleWallet.balance < selectedSettleBillAmount,
  );

  const selectedTransferWallet = useMemo(() => {
    return cashWallets.find((w) => w.id === walletId) ?? cashWallets[0] ?? null;
  }, [cashWallets, walletId]);

  const transferTotalNeeded = parsedTotalAmount + parsePositiveInt(adminFeeInput);
  const isTransferInsufficient = Boolean(
    mode === "transfer" &&
      selectedTransferWallet &&
      transferTotalNeeded > 0 &&
      selectedTransferWallet.balance < transferTotalNeeded,
  );

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    await queryClient.invalidateQueries({ queryKey: ["debts"] });
    await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
    await queryClient.invalidateQueries({ queryKey: ["quick-presets"] });
    await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === "expense" || mode === "income") {
        const amount = parsePositiveInt(amountInput);
        if (amount <= 0) throw new Error("Masukkan nominal lebih dari Rp0.");
        if (!merchant.trim()) throw new Error("Nama merchant atau keterangan wajib diisi.");
        if (isCcLimitExceeded && selectedExpenseWallet) {
          throw new Error(
            `Transaksi melebihi sisa limit ${selectedExpenseWallet.name} (${formatRupiah(effectiveCcAvailableLimit)}). Tambah limit kartu terlebih dahulu jika ada kenaikan limit dari bank.`,
          );
        }

        let payloadSplits:
          | Array<{ category: string; amount: number; note?: string | null }>
          | undefined;
        if (mode === "expense" && isSplit) {
          if (splits.length < 2) throw new Error("Pecahan struk minimal terdiri dari 2 kategori.");
          if (splitDelta !== 0) {
            throw new Error(
              `Total pecahan belum sesuai (${formatRupiah(parsedSplitSum)} dari ${formatRupiah(amount)}). Sisa: ${formatRupiah(Math.abs(splitDelta))}.`,
            );
          }
          for (const s of splits) {
            const splitAmt = parsePositiveInt(s.amountInput);
            if (splitAmt <= 0)
              throw new Error(`Nominal pecahan untuk ${s.category} harus lebih dari Rp0.`);
          }
          payloadSplits = splits.map((s) => ({
            category: s.category,
            amount: parsePositiveInt(s.amountInput),
            note: s.note.trim() || null,
          }));
        }

        if (editingTx) {
          return api.updateTransaction(editingTx.id, {
            type: mode,
            merchant: merchant.trim(),
            amount,
            transactionDate: date,
            category: payloadSplits ? payloadSplits[0]!.category : category,
            walletId,
            note: note.trim() || null,
            splits: payloadSplits,
          });
        }

        return api.createTransaction({
          type: mode,
          merchant: merchant.trim(),
          amount,
          transactionDate: date,
          category: payloadSplits ? payloadSplits[0]!.category : category,
          walletId,
          note: note.trim() || undefined,
          splits: payloadSplits,
        });
      }

      if (mode === "transfer") {
        if (isTransferInsufficient) {
          throw new Error(
            `Saldo dompet ${selectedTransferWallet?.name ?? "asal"} tidak mencukupi untuk transfer (Saldo: ${formatRupiah(selectedTransferWallet?.balance ?? 0)}, Dibutuhkan: ${formatRupiah(transferTotalNeeded)}).`,
          );
        }
        const amount = parsePositiveInt(amountInput);
        const adminFee = parsePositiveInt(adminFeeInput);
        if (amount <= 0) throw new Error("Masukkan nominal transfer lebih dari Rp0.");
        if (walletId === toWalletId) throw new Error("Dompet asal dan tujuan harus berbeda.");

        if (editingTx) {
          return api.updateTransaction(editingTx.id, {
            type: "transfer",
            merchant: merchant.trim() || undefined,
            amount,
            transactionDate: date,
            walletId,
            toWalletId,
            adminFee: Math.max(adminFee, 0),
            note: note.trim() || null,
          });
        }

        return api.createTransfer({
          fromWalletId: walletId,
          toWalletId,
          amount,
          adminFee: adminFee > 0 ? adminFee : undefined,
          transactionDate: date,
          merchant: merchant.trim() || undefined,
          note: note.trim() || undefined,
          preventOverdraft: true,
        });
      }

      if (!settleTarget) throw new Error("Pilih cicilan atau tagihan CC yang ingin dibayar.");
      if (isSettleInsufficient) {
        throw new Error(
          `Saldo dompet ${selectedSettleWallet?.name ?? "pilihan"} tidak mencukupi untuk membayar tagihan (Saldo: ${formatRupiah(selectedSettleWallet?.balance ?? 0)}, Tagihan: ${formatRupiah(selectedSettleBillAmount)}).`,
        );
      }
      if (settleTarget.startsWith("cc:")) {
        const parts = settleTarget.split(":");
        const targetWalletId = Number(parts[1]) || undefined;
        const cycleKey = parts.slice(2).join(":");
        const cycle = unpaidCcCycles.find((c) => c.key === settleTarget);
        return api.settleInstallments({
          ccWalletId: cycle?.walletId ?? targetWalletId,
          ccCycleKey: cycleKey,
          installmentIds: cycle?.unpaidInstallmentIds ?? [],
          fromWalletId: walletId,
          paymentDate: date,
          note: note.trim() || undefined,
          preventOverdraft: true,
        });
      }
      const ids = settleTarget
        .slice(5)
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      return api.settleInstallments({
        installmentIds: ids,
        fromWalletId: walletId,
        paymentDate: date,
        note: note.trim() || undefined,
        preventOverdraft: true,
      });
    },
    onSuccess: async () => {
      setIsSavedSuccess(true);
      if (walletId) {
        localStorage.setItem("ft-last-wallet-id", String(walletId));
      }
      await invalidateAll();
      const labels: Record<QuickAddMode, string> = {
        expense: editingTx ? "Transaksi diperbarui" : "Pengeluaran dicatat",
        income: editingTx ? "Pemasukan diperbarui" : "Pemasukan dicatat",
        transfer: editingTx ? "Transfer diperbarui" : "Transfer antar dompet dicatat",
        settle: "Tagihan berhasil dilunasi",
      };
      onSuccessMessage(labels[mode]);
      window.setTimeout(() => {
        setIsSavedSuccess(false);
        onClose();
      }, 400);
    },
    onError: (err) => {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyimpan.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editingTx) return;
      await api.deleteTransaction(editingTx.id);
    },
    onSuccess: async () => {
      await invalidateAll();
      onSuccessMessage("Transaksi dihapus");
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus transaksi.");
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    saveMutation.mutate();
  };

  const selectMode = (nextMode: QuickAddMode) => {
    setMode(nextMode);
    setError("");
    if (nextMode === "income") {
      setCategory(incomeCategories[0]?.name ?? "Gaji");
      if (activeWallets.find((w) => w.id === walletId)?.type === "credit_card") {
        setWalletId(cashWallets[0]?.id ?? 1);
      }
    } else if (nextMode === "expense") {
      setCategory(expenseCategories[0]?.name ?? "Makanan & Minuman");
    } else if (nextMode === "transfer" || nextMode === "settle") {
      if (activeWallets.find((w) => w.id === walletId)?.type === "credit_card") {
        setWalletId(cashWallets[0]?.id ?? 1);
      }
    }
  };

  // Merchant suggestion matching
  const matchingSuggestions = useMemo(() => {
    if (!merchant.trim() || editingTx) return [];
    const query = merchant.trim().toLowerCase();
    return (presets?.merchantSuggestions ?? []).filter(
      (m) => m.merchant.toLowerCase().includes(query) && m.merchant.toLowerCase() !== query,
    );
  }, [merchant, presets, editingTx]);

  const handleMerchantChange = (val: string) => {
    setMerchant(val);
    if (!editingTx && presets?.merchantSuggestions) {
      const match = presets.merchantSuggestions.find(
        (m) => m.merchant.toLowerCase() === val.trim().toLowerCase(),
      );
      if (match) {
        setCategory(match.category);
        setWalletId(match.walletId);
        if (!amountInput && match.lastUsedAmount > 0) {
          setAmountInput(match.lastUsedAmount.toLocaleString("id-ID"));
        }
      }
    }
  };

  const selectableWallets = mode === "expense" ? activeWallets : cashWallets;
  const currentCategories = useMemo(() => {
    const base = mode === "income" ? incomeCategories : expenseCategories;
    if (
      editingTx?.category &&
      !base.some((c) => c.name.toLowerCase() === editingTx.category.toLowerCase())
    ) {
      return [
        {
          id: -1,
          name: editingTx.category,
          type: mode === "income" ? ("income" as const) : ("expense" as const),
          isMandatory: false,
          color: "#566361",
          sortOrder: 999,
          isArchived: true,
        },
        ...base,
      ];
    }
    return base;
  }, [mode, incomeCategories, expenseCategories, editingTx]);

  const needsCategories = useMemo(
    () =>
      currentCategories.filter((c) => c.bucket === "needs" || (!c.bucket && c.type === "expense")),
    [currentCategories],
  );
  const wantsCategories = useMemo(
    () => currentCategories.filter((c) => c.bucket === "wants"),
    [currentCategories],
  );
  const savingsCategories = useMemo(
    () => currentCategories.filter((c) => c.bucket === "savings"),
    [currentCategories],
  );

  const activeTabId = `${baseId}-tab-${mode}`;
  const panelId = `${baseId}-panel`;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={
        editingTx
          ? editingTx.type === "transfer"
            ? "Edit Transfer"
            : "Edit Transaksi"
          : "Catat Transaksi"
      }
      subtitle={editingTx ? "Perbarui detail mutasi atau hapus jika salah catat." : undefined}
    >
      {!editingTx && (
        <div
          role="tablist"
          aria-label="Jenis pencatatan"
          className="mb-4 grid grid-cols-4 gap-1.5 rounded-[14px] bg-[var(--surface)] p-1 border border-[var(--border)]"
        >
          {MODE_TABS.map(([key, label], index) => {
            const active = mode === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`${baseId}-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={panelId}
                tabIndex={active ? 0 : -1}
                onClick={() => selectMode(key)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const delta = e.key === "ArrowRight" ? 1 : -1;
                  const nextIndex = (index + delta + MODE_TABS.length) % MODE_TABS.length;
                  const nextTab = MODE_TABS[nextIndex]![0];
                  selectMode(nextTab);
                  tabRefs.current[nextIndex]?.focus();
                }}
                className={`min-h-[44px] rounded-[10px] px-2 text-xs font-bold transition-colors sm:text-sm ${
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "text-[var(--foreground)] hover:bg-[var(--card)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Template Cepat Bar (Quick Presets) - Hanya tampilkan sesuai mode aktif */}
      {!editingTx &&
        (mode === "expense" || mode === "income") &&
        (() => {
          const contextualTemplates = (presets?.frequentTemplates ?? []).filter(
            (t) => t.type === mode,
          );
          if (contextualTemplates.length === 0) return null;
          return (
            <div className="mb-4 space-y-1.5">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                {mode === "expense" ? "Template Pengeluaran Sering" : "Template Pemasukan Sering"}
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {contextualTemplates.map((t) => (
                  <button
                    key={`${t.merchant}-${t.suggestedAmount}`}
                    type="button"
                    onClick={() => {
                      selectMode(t.type);
                      setMerchant(t.merchant);
                      setAmountInput(t.suggestedAmount.toLocaleString("id-ID"));
                      setCategory(t.category);
                      setWalletId(t.walletId);
                    }}
                    className="min-h-[40px] shrink-0 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-3.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:border-[var(--primary)] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
                  >
                    <span className="font-bold">{t.merchant}</span>
                    <span className="text-neutral-400">
                      · {formatCompactRupiah(t.suggestedAmount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

      <div
        id={panelId}
        {...(!editingTx ? { role: "tabpanel", "aria-labelledby": activeTabId } : {})}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "settle" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="settle-target" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                  Tagihan atau Cicilan yang Dibayar
                </label>
                <select
                  id="settle-target"
                  value={settleTarget}
                  onChange={(e) => setSettleTarget(e.target.value)}
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                >
                  {unpaidCcCycles.length > 0 && (
                    <optgroup label="Tagihan Kartu Kredit">
                      {unpaidCcCycles.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.walletName} · Siklus {c.cycleKey} ({formatRupiah(c.totalBill)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {upcomingInstallments.length > 0 && (
                    <optgroup label="Cicilan Utang Mendatang">
                      {upcomingInstallments.map((i) => (
                        <option key={`inst:${i.id}`} value={`inst:${i.id}`}>
                          {i.accountName} ({formatShortDate(i.dueDate)}) -{" "}
                          {formatRupiah(i.plannedAmount)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {unpaidCcCycles.length === 0 && upcomingInstallments.length === 0 && (
                  <p className="text-xs text-neutral-400">
                    Tidak ada cicilan atau tagihan CC yang menunggu pembayaran.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="settle-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                  Bayar Dari Dompet
                </label>
                <select
                  id="settle-wallet"
                  value={walletId}
                  onChange={(e) => setWalletId(Number(e.target.value))}
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                >
                  {cashWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({formatRupiah(w.balance)})
                    </option>
                  ))}
                </select>
                {isSettleInsufficient && selectedSettleWallet && (
                  <div className="rounded-[14px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                    <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <div>
                      <p className="font-bold">Saldo Dompet Tidak Mencukupi!</p>
                      <p className="mt-0.5">
                        Saldo {selectedSettleWallet.name} saat ini{" "}
                        {formatRupiah(selectedSettleWallet.balance)}, sedangkan tagihan sebesar{" "}
                        {formatRupiah(selectedSettleBillAmount)}. Pembayaran tidak dapat diproses.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Nominal Input & Quick Preset Buttons */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="tx-amount" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                    Nominal (Rp)
                  </label>
                  {parsedTotalAmount > 0 && (
                    <span className="tabular-nums text-xs font-semibold text-neutral-400">
                      {formatRupiah(parsedTotalAmount)}
                    </span>
                  )}
                </div>
                <input
                  ref={amountInputRef}
                  id="tx-amount"
                  inputMode="numeric"
                  value={amountInput}
                  onChange={(e) => setAmountInput(formatDigitsInput(e.target.value))}
                  onFocus={(e) => {
                    window.setTimeout(() => {
                      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 150);
                  }}
                  placeholder="0"
                  className="tabular-nums min-h-[50px] w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-2xl font-black text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                />

                {/* Spell-out nominal otomatis */}
                {parsedTotalAmount > 0 && (
                  <p className="text-xs font-semibold text-[var(--primary)] transition-all">
                    {spellOutRupiah(parsedTotalAmount)}
                  </p>
                )}

                {/* Preset Nominal Cepat Buttons (Zero-CLS 5-Column Grid) */}
                <div className="grid grid-cols-5 gap-1.5 pt-1">
                  {[
                    [10_000, "+10rb"],
                    [25_000, "+25rb"],
                    [50_000, "+50rb"],
                    [100_000, "+100rb"],
                  ].map(([addVal, label]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        const current = parsePositiveInt(amountInput);
                        setAmountInput((current + (addVal as number)).toLocaleString("id-ID"));
                      }}
                      className="min-h-[40px] rounded-[12px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-1 text-xs font-bold text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition-all text-center"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!amountInput}
                    onClick={() => setAmountInput("")}
                    className="min-h-[40px] rounded-[12px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-1 text-xs font-semibold text-neutral-400 hover:text-[var(--destructive)] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-center"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {mode === "transfer" ? (
                <div className="space-y-4">
                  {/* Chip Rute Transfer Cepat */}
                  {presets?.frequentTransferRoutes && presets.frequentTransferRoutes.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                        Rute Transfer Cepat
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {presets.frequentTransferRoutes.map((route) => {
                          const isSelected =
                            walletId === route.fromWalletId && toWalletId === route.toWalletId;
                          return (
                            <button
                              key={`${route.fromWalletId}->${route.toWalletId}`}
                              type="button"
                              onClick={() => {
                                setWalletId(route.fromWalletId);
                                setToWalletId(route.toWalletId);
                                if (route.adminFee !== undefined) {
                                  setAdminFeeInput(
                                    route.adminFee > 0
                                      ? route.adminFee.toLocaleString("id-ID")
                                      : "",
                                  );
                                }
                              }}
                              className={`min-h-[40px] rounded-[12px] border px-3.5 text-xs font-semibold transition-all ${
                                isSelected
                                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                                  : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              }`}
                            >
                              {route.fromWalletName} &rarr; {route.toWalletName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="tx-from-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                        Dari Dompet
                      </label>
                      <select
                        id="tx-from-wallet"
                        value={walletId}
                        onChange={(e) => setWalletId(Number(e.target.value))}
                        className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                      >
                        {cashWallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({formatRupiah(w.balance)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="tx-to-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                        Ke Dompet
                      </label>
                      <select
                        id="tx-to-wallet"
                        value={toWalletId}
                        onChange={(e) => setToWalletId(Number(e.target.value))}
                        className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                      >
                        {cashWallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({formatRupiah(w.balance)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="tx-admin-fee" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                          Biaya Admin (Opsional)
                        </label>
                        <div className="flex items-center gap-1">
                          {[
                            [0, "Gratis"],
                            [2500, "2.500"],
                            [6500, "6.500"],
                          ].map(([feeVal, label]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                setAdminFeeInput(
                                  feeVal === 0 ? "" : (feeVal as number).toLocaleString("id-ID"),
                                )
                              }
                              className="rounded-[8px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-2 py-0.5 text-[11px] font-bold text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        id="tx-admin-fee"
                        inputMode="numeric"
                        value={adminFeeInput}
                        onChange={(e) => setAdminFeeInput(formatDigitsInput(e.target.value))}
                        placeholder="Contoh: 2.500 (kosongkan jika gratis)"
                        className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="tx-transfer-label" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                        Keterangan (Opsional)
                      </label>
                      <input
                        id="tx-transfer-label"
                        type="text"
                        value={merchant}
                        onChange={(e) => setMerchant(e.target.value)}
                        placeholder="Otomatis: Transfer ke ..."
                        className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                      />
                    </div>
                  </div>
                  {isTransferInsufficient && selectedTransferWallet && (
                    <div className="rounded-[14px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                      <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                      <div>
                        <p className="font-bold">Saldo Dompet Tidak Mencukupi!</p>
                        <p className="mt-0.5">
                          Saldo {selectedTransferWallet.name} saat ini{" "}
                          {formatRupiah(selectedTransferWallet.balance)}, sedangkan kebutuhan
                          transfer + admin sebesar {formatRupiah(transferTotalNeeded)}.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <label htmlFor="tx-merchant" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                      {mode === "income" ? "Sumber Pemasukan" : "Merchant / Keterangan"}
                    </label>
                    <input
                      id="tx-merchant"
                      type="text"
                      value={merchant}
                      onChange={(e) => handleMerchantChange(e.target.value)}
                      onFocus={(e) => {
                        window.setTimeout(() => {
                          e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 150);
                      }}
                      placeholder={
                        mode === "income"
                          ? "Contoh: Gaji, Pengembalian pinjaman"
                          : "Contoh: Warung Agus, Indomaret, Kopi Kenangan"
                      }
                      className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                    />
                  </div>

                  {/* Merchant auto-suggestions */}
                  {matchingSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {matchingSuggestions.slice(0, 3).map((s) => (
                        <button
                          key={s.merchant}
                          type="button"
                          onClick={() => {
                            setMerchant(s.merchant);
                            setCategory(s.category);
                            setWalletId(s.walletId);
                            if (!amountInput && s.lastUsedAmount > 0) {
                              setAmountInput(s.lastUsedAmount.toLocaleString("id-ID"));
                            }
                          }}
                          className="min-h-[38px] rounded-[10px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-3 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:border-[var(--primary)]"
                        >
                          Pernah dicatat: <strong>{s.merchant}</strong> ({s.category})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(mode === "expense" || mode === "income") && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="tx-wallet" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                        {mode === "income" ? "Masuk ke Dompet" : "Sumber Dana"}
                      </label>
                      <select
                        id="tx-wallet"
                        value={walletId}
                        onChange={(e) => setWalletId(Number(e.target.value))}
                        className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                      >
                        {selectableWallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            [{w.provider ? w.provider.toUpperCase() : w.type.toUpperCase()}]{" "}
                            {w.name} ({w.type === "credit_card" ? `Sisa Limit ${formatRupiah(w.balance)}` : formatRupiah(w.balance)})
                          </option>
                        ))}
                      </select>
                    </div>

                    {!isSplit && (
                      <div className="space-y-1.5">
                        <label htmlFor="tx-category" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                          Kategori
                        </label>
                        <select
                          id="tx-category"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
                        >
                          {mode === "expense" ? (
                            <>
                              {needsCategories.length > 0 && (
                                <optgroup label="Kebutuhan (50% - Needs)">
                                  {needsCategories.map((cat) => (
                                    <option key={`${cat.id}-${cat.name}`} value={cat.name}>
                                      {cat.isArchived ? `${cat.name} (Diarsipkan)` : cat.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {wantsCategories.length > 0 && (
                                <optgroup label="Keinginan (30% - Wants)">
                                  {wantsCategories.map((cat) => (
                                    <option key={`${cat.id}-${cat.name}`} value={cat.name}>
                                      {cat.isArchived ? `${cat.name} (Diarsipkan)` : cat.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {savingsCategories.length > 0 && (
                                <optgroup label="Tabungan & Hutang (20% - Savings & Debt)">
                                  {savingsCategories.map((cat) => (
                                    <option key={`${cat.id}-${cat.name}`} value={cat.name}>
                                      {cat.isArchived ? `${cat.name} (Diarsipkan)` : cat.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </>
                          ) : (
                            currentCategories.map((cat) => (
                              <option key={`${cat.id}-${cat.name}`} value={cat.name}>
                                {cat.isArchived ? `${cat.name} (Diarsipkan)` : cat.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Credit Card Remaining Limit Guard & Live Status */}
                  {mode === "expense" && selectedExpenseWallet?.type === "credit_card" && (
                    <div
                      className={`rounded-[14px] border p-3 text-xs flex items-start gap-2 ${
                        isCcLimitExceeded
                          ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
                          : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-700 dark:text-neutral-300"
                      }`}
                    >
                      {isCcLimitExceeded && (
                        <AlertIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                      )}
                      <div className="flex-1 space-y-0.5">
                        {isCcLimitExceeded ? (
                          <>
                            <p className="font-bold">Melebihi Sisa Limit Kartu Kredit!</p>
                            <p>
                              Sisa limit tersedia {selectedExpenseWallet.name} saat ini{" "}
                              <strong>{formatRupiah(effectiveCcAvailableLimit)}</strong>
                              {selectedCcCard && selectedCcCard.installmentLimitUsed > 0
                                ? ` (Rp ${selectedCcCard.installmentLimitUsed.toLocaleString("id-ID")} terkunci cicilan aktif)`
                                : ""}
                              . Transaksi tidak dapat disimpan kecuali ada penambahan limit kartu.
                            </p>
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              Sisa limit tersedia{" "}
                              <strong className="font-mono text-neutral-900 dark:text-white">
                                {formatRupiah(effectiveCcAvailableLimit)}
                              </strong>{" "}
                              dari{" "}
                              {formatCompactRupiah(
                                selectedExpenseWallet.creditLimit ?? 0,
                              )}
                            </span>
                            {selectedCcCard && selectedCcCard.installmentLimitUsed > 0 && (
                              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                Terkunci cicilan: {formatCompactRupiah(selectedCcCard.installmentLimitUsed)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Toggle Pecah Kategori (Split Struk) for expense */}
                  {mode === "expense" && (
                    <div className="space-y-3 rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 p-3.5">
                      <div className="flex items-center justify-between">
                        <label className="inline-flex min-h-[40px] items-center gap-2 text-xs font-bold text-neutral-800 dark:text-neutral-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSplit}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setIsSplit(checked);
                              if (checked && splits.length < 2) {
                                setSplits([
                                  {
                                    keyId: `split-1`,
                                    category,
                                    amountInput: "",
                                    note: "",
                                  },
                                  {
                                    keyId: `split-2`,
                                    category:
                                      expenseCategories.find((c) => c.name !== category)?.name ??
                                      "Belanja",
                                    amountInput: "",
                                    note: "",
                                  },
                                ]);
                              }
                            }}
                            className="h-4 w-4 rounded accent-[var(--primary)]"
                          />
                          Pecah Kategori (Split Struk)
                        </label>
                        {isSplit && (
                          <Badge
                            tone={
                              splitDelta === 0 ? "soft" : splitDelta > 0 ? "highlight" : "danger"
                            }
                          >
                            {splitDelta === 0
                              ? "Total Pas"
                              : splitDelta > 0
                                ? `Sisa: ${formatRupiah(splitDelta)}`
                                : `Kelebihan: ${formatRupiah(Math.abs(splitDelta))}`}
                          </Badge>
                        )}
                      </div>

                      {isSplit && (
                        <div className="space-y-2.5 pt-1">
                          {splits.map((s, idx) => (
                            <div
                              key={s.keyId}
                              className="flex flex-wrap items-center gap-2 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2.5 shadow-2xs"
                            >
                              <div className="w-full sm:w-auto sm:flex-1">
                                <label htmlFor={`split-cat-${s.keyId}`} className="sr-only">
                                  Kategori Pecahan {idx + 1}
                                </label>
                                <select
                                  id={`split-cat-${s.keyId}`}
                                  value={s.category}
                                  onChange={(e) => {
                                    const next = [...splits];
                                    next[idx]!.category = e.target.value;
                                    setSplits(next);
                                  }}
                                  className="w-full rounded-[10px] bg-[#f8f9fa] dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[var(--primary)]"
                                >
                                  {expenseCategories.map((cat) => (
                                    <option key={cat.id} value={cat.name}>
                                      {cat.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="w-full sm:w-36">
                                <label htmlFor={`split-amt-${s.keyId}`} className="sr-only">
                                  Nominal Pecahan {idx + 1}
                                </label>
                                <input
                                  id={`split-amt-${s.keyId}`}
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Nominal"
                                  value={s.amountInput}
                                  onChange={(e) => {
                                    const next = [...splits];
                                    next[idx]!.amountInput = formatDigitsInput(e.target.value);
                                    setSplits(next);
                                  }}
                                  className="tabular-nums w-full rounded-[10px] bg-[#f8f9fa] dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[var(--primary)]"
                                />
                              </div>

                              <div className="flex-1 min-w-[120px]">
                                <label htmlFor={`split-note-${s.keyId}`} className="sr-only">
                                  Catatan Pecahan {idx + 1}
                                </label>
                                <input
                                  id={`split-note-${s.keyId}`}
                                  type="text"
                                  placeholder="Catatan struk"
                                  value={s.note}
                                  onChange={(e) => {
                                    const next = [...splits];
                                    next[idx]!.note = e.target.value;
                                    setSplits(next);
                                  }}
                                  className="w-full rounded-[10px] bg-[#f8f9fa] dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[var(--primary)]"
                                />
                              </div>

                              {splits.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => setSplits(splits.filter((_, i) => i !== idx))}
                                  aria-label={`Hapus pecahan ${idx + 1}`}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--destructive)] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setSplits([
                                  ...splits,
                                  {
                                    keyId: `split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                    category: expenseCategories[0]?.name ?? "Lainnya",
                                    amountInput: "",
                                    note: "",
                                  },
                                ])
                              }
                              className="inline-flex items-center px-2 py-1 text-xs font-bold text-[var(--primary)] hover:underline"
                            >
                              + Tambah Kategori Struk
                            </button>

                            {splitDelta > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = [...splits];
                                  const lastIdx = next.length - 1;
                                  const currentVal = parsePositiveInt(next[lastIdx]!.amountInput);
                                  next[lastIdx]!.amountInput = (
                                    currentVal + splitDelta
                                  ).toLocaleString("id-ID");
                                  setSplits(next);
                                }}
                                className="inline-flex items-center px-2 py-1 text-xs font-bold text-[var(--highlight)] hover:underline"
                              >
                                Isi sisa ({formatRupiah(splitDelta)}) ke baris terakhir
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="tx-date" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                  Tanggal
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDate(jakartaToday())}
                    className={`rounded-[8px] px-2.5 py-0.5 text-[11px] font-bold border transition-colors ${
                      date === jakartaToday()
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                    }`}
                  >
                    Hari Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setDate(d.toISOString().slice(0, 10));
                    }}
                    className={`rounded-[8px] px-2.5 py-0.5 text-[11px] font-bold border transition-colors ${
                      date !== jakartaToday()
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                    }`}
                  >
                    Kemarin
                  </button>
                </div>
              </div>
              <input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tx-note" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Catatan (Opsional)
              </label>
              <input
                id="tx-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Detail tambahan"
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
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

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex flex-wrap gap-2">
              {editingTx && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-bold text-[var(--destructive)] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Hapus</span>
                </button>
              )}
              {editingTx && confirmDelete && (
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  className="inline-flex min-h-[44px] items-center px-4 py-2.5 rounded-[14px] bg-[var(--destructive)] text-[var(--destructive-foreground)] text-xs font-bold hover:opacity-90 active:scale-95 transition-all"
                >
                  {deleteMutation.isPending ? "Menghapus..." : "Konfirmasi Hapus"}
                </button>
              )}
              {editingTx &&
                editingTx.walletType === "credit_card" &&
                editingTx.type === "expense" &&
                !editingTx.isConvertedToInstallment &&
                onRequestSplitPay && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onRequestSplitPay(editingTx);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
                  >
                    <SplitPayIcon className="w-4 h-4" />
                    <span>Ubah Jadi Cicilan</span>
                  </button>
                )}
            </div>

            <button
              type="submit"
              disabled={
                saveMutation.isPending ||
                isSavedSuccess ||
                (mode === "settle" && (!settleTarget || isSettleInsufficient)) ||
                (mode === "transfer" && isTransferInsufficient) ||
                isCcLimitExceeded
              }
              className="ml-auto min-h-[44px] px-6 py-3 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
            >
              {isSavedSuccess
                ? "Tersimpan"
                : saveMutation.isPending
                  ? "Menyimpan..."
                  : mode === "settle"
                    ? "Konfirmasi Bayar"
                    : editingTx
                      ? "Simpan Perubahan"
                      : "Simpan Transaksi"}
            </button>
          </div>
        </form>
      </div>
    </ModalSheet>
  );
}
