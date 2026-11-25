import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AccountGroup,
  WalletProvider,
  WalletRole,
  WalletType,
} from "../../../shared/src/types";
import { api, ApiError, type WalletDto } from "../lib/api";
import {
  formatDigitsInput,
  formatRupiah,
  formatSignedDigitsInput,
  parsePositiveInt,
  parseSignedInt,
} from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { budgetKeys } from "../lib/queryKeys";
import { AlertIcon, TrashIcon } from "./Icons";
import { Button, ModalSheet } from "./UI";

const MAX_IDR_AMOUNT = 2_147_483_647;

export type WalletUiType = "bank" | "ewallet" | "credit_card" | "paylater" | "cash";
// Backwards compatibility alias
export type BudggtWalletType = WalletUiType;

interface ProviderItem {
  id: WalletProvider;
  name: string;
  color: string;
}

const WALLET_UI_TYPES: { id: WalletUiType; label: string }[] = [
  { id: "bank", label: "Bank" },
  { id: "ewallet", label: "E-Wallet" },
  { id: "credit_card", label: "Kartu Kredit" },
  { id: "paylater", label: "PayLater" },
  { id: "cash", label: "Tunai" },
];

const BANK_PROVIDERS: ProviderItem[] = [
  { id: "bca", name: "BCA", color: "#00529C" },
  { id: "mandiri", name: "Bank Mandiri", color: "#003D79" },
  { id: "bri", name: "BRI", color: "#00529F" },
  { id: "bni", name: "BNI", color: "#005E6A" },
  { id: "btn", name: "BTN", color: "#003A70" },
  { id: "cimb", name: "CIMB Niaga", color: "#ED1B2D" },
  { id: "bsi", name: "Bank Syariah Indonesia (BSI)", color: "#00A39D" },
  { id: "permata", name: "Permata Bank", color: "#78BE20" },
  { id: "danamon", name: "Bank Danamon", color: "#003366" },
  { id: "jago", name: "Bank Jago", color: "#FFD500" },
  { id: "seabank", name: "SeaBank", color: "#FE5D26" },
  { id: "blu", name: "blu by BCA Digital", color: "#00C2FF" },
  { id: "jenius", name: "Jenius (BTPN)", color: "#00A4E4" },
  { id: "other", name: "Bank Lainnya", color: "#475569" },
];

const EWALLET_PROVIDERS: ProviderItem[] = [
  { id: "gopay", name: "GoPay", color: "#00AED6" },
  { id: "ovo", name: "OVO", color: "#4C2A86" },
  { id: "dana", name: "DANA", color: "#118EEA" },
  { id: "shopeepay", name: "ShopeePay", color: "#EE4D2D" },
  { id: "linkaja", name: "LinkAja", color: "#ED1C24" },
  { id: "astrapay", name: "AstraPay", color: "#004B93" },
  { id: "isaku", name: "i.saku", color: "#0072CE" },
  { id: "other", name: "E-Wallet Lainnya", color: "#475569" },
];

const CREDIT_CARD_PROVIDERS: ProviderItem[] = [
  { id: "bca", name: "BCA Card", color: "#00529C" },
  { id: "mandiri", name: "Mandiri Card", color: "#003D79" },
  { id: "bni", name: "BNI Card", color: "#005E6A" },
  { id: "bri", name: "BRI Card", color: "#00529F" },
  { id: "cimb", name: "CIMB Niaga Card", color: "#ED1B2D" },
  { id: "jenius", name: "Jenius Card", color: "#00A4E4" },
  { id: "mega", name: "Bank Mega Card", color: "#F7941D" },
  { id: "danamon", name: "Danamon Card", color: "#003366" },
  { id: "permata", name: "Permata Card", color: "#78BE20" },
  { id: "other", name: "Kartu Kredit Lainnya", color: "#475569" },
];

const PAYLATER_PROVIDERS: ProviderItem[] = [
  { id: "spaylater", name: "SPayLater (Shopee)", color: "#EE4D2D" },
  { id: "gopaylater", name: "GoPay Later", color: "#00AED6" },
  { id: "kredivo", name: "Kredivo", color: "#FF5722" },
  { id: "akulaku", name: "Akulaku", color: "#E51C23" },
  { id: "traveloka_paylater", name: "Traveloka PayLater", color: "#0264D6" },
  { id: "indodana", name: "Indodana", color: "#00A859" },
  { id: "atome", name: "Atome", color: "#FFFF00" },
  { id: "other", name: "PayLater Lainnya", color: "#475569" },
];

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

interface DueCalculationResult {
  paymentDay: number;
  isNextMonth: boolean;
  daysDiff: number;
}

function computeFromOffset(cutoff: number, daysAfter: number): DueCalculationResult {
  const c = Math.max(1, Math.min(28, Math.round(cutoff) || 1));
  const d = Math.max(1, Math.round(daysAfter) || 1);
  const sum = c + d;
  if (sum <= 30) {
    return {
      paymentDay: Math.min(28, sum),
      isNextMonth: false,
      daysDiff: d,
    };
  }
  const nextDay = Math.min(28, Math.max(1, sum - 30));
  return {
    paymentDay: nextDay,
    isNextMonth: true,
    daysDiff: d,
  };
}

function computeFromDates(cutoff: number, payment: number): DueCalculationResult {
  const c = Math.max(1, Math.min(28, Math.round(cutoff) || 1));
  const p = Math.max(1, Math.min(28, Math.round(payment) || 1));
  if (p > c) {
    return {
      paymentDay: p,
      isNextMonth: false,
      daysDiff: p - c,
    };
  }
  return {
    paymentDay: p,
    isNextMonth: true,
    daysDiff: 30 - c + p,
  };
}

export function WalletFormModal({
  open,
  onClose,
  wallet,
  onSuccess,
  onOpenReconcile,
}: {
  open: boolean;
  onClose: () => void;
  wallet: WalletDto | null;
  onSuccess: (msg: string) => void;
  onOpenReconcile?: (wallet: WalletDto) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const formId = useId();

  // Core Form State
  const [uiType, setUiType] = useState<WalletUiType>("bank");
  const [provider, setProvider] = useState<WalletProvider>("bca");
  const [role, setRole] = useState<"spending" | "savings">("spending");
  const [name, setName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [balance, setBalance] = useState("0");
  const [creditLimit, setCreditLimit] = useState("0");
  const [pemakaian, setPemakaian] = useState("0");
  const [cutoffDay, setCutoffDay] = useState("21");
  const [statementDay, setStatementDay] = useState<number | null>(null);
  const [paymentDay, setPaymentDay] = useState("7");
  const [dueMode, setDueMode] = useState<"days" | "date">("days");
  const [daysAfterCutoff, setDaysAfterCutoff] = useState("16");
  const [color, setColor] = useState("#00529C");
  const [isActive, setIsActive] = useState(true);

  // Dropdown UI State
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");

  // Error & Confirmation State
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cascadeRequired, setCascadeRequired] = useState(false);
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);

  const dueInfo = useMemo<DueCalculationResult>(() => {
    const c = Number(cutoffDay) || 21;
    if (dueMode === "days") {
      const d = Number(daysAfterCutoff) || 16;
      return computeFromOffset(c, d);
    } else {
      const p = Number(paymentDay) || 7;
      return computeFromDates(c, p);
    }
  }, [cutoffDay, dueMode, daysAfterCutoff, paymentDay]);

  const isEditing = Boolean(wallet);
  const typeRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
      if (providerRef.current && !providerRef.current.contains(e.target as Node)) {
        setProviderDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Initialize form state
  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setCascadeRequired(false);
      setCascadeConfirmed(false);
      setTypeDropdownOpen(false);
      setProviderDropdownOpen(false);
      setProviderSearch("");
      return;
    }

    setError("");
    setConfirmDelete(false);
    setCascadeRequired(false);
    setCascadeConfirmed(false);
    setTypeDropdownOpen(false);
    setProviderDropdownOpen(false);
    setProviderSearch("");

    if (wallet) {
      // Map existing wallet to uiType
      const isPaylaterProvider =
        wallet.provider !== "other" && PAYLATER_PROVIDERS.some((p) => p.id === wallet.provider);
      let initialUiType: WalletUiType = "bank";
      if (wallet.type === "credit_card") {
        initialUiType =
          isPaylaterProvider || wallet.name.toLowerCase().includes("paylater")
            ? "paylater"
            : "credit_card";
      } else if (wallet.type === "cash") {
        initialUiType = "cash";
      } else if (wallet.type === "ewallet") {
        initialUiType = "ewallet";
      } else {
        initialUiType = "bank";
      }

      setUiType(initialUiType);
      setProvider(wallet.provider || "other");
      setRole(wallet.role === "savings" ? "savings" : "spending");
      setName(wallet.name);
      setAccountNumber(wallet.accountNumber ?? "");
      setBalance(formatSignedDigitsInput(String(wallet.openingBalance)));
      setCreditLimit((wallet.creditLimit ?? 0).toLocaleString("id-ID"));
      setPemakaian((wallet.limitUsed ?? 0).toLocaleString("id-ID"));
      const c = wallet.cutoffDay ?? 21;
      const p = wallet.paymentDay ?? 7;
      setCutoffDay(String(c));
      setStatementDay(wallet.statementDay ?? null);
      setPaymentDay(String(p));
      const res = computeFromDates(c, p);
      setDaysAfterCutoff(String(res.daysDiff || 16));
      setDueMode("days");
      setColor(wallet.color || "#00529C");
      setIsActive(wallet.isActive);
    } else {
      // Fresh new wallet state
      setUiType("bank");
      setProvider("bca");
      setRole("spending");
      setName("BCA");
      setAccountNumber("");
      setBalance("0");
      setCreditLimit("0");
      setPemakaian("0");
      setCutoffDay("21");
      setStatementDay(null);
      setPaymentDay("7");
      setDaysAfterCutoff("16");
      setDueMode("days");
      setColor("#00529C");
      setIsActive(true);
    }
  }, [open, wallet]);

  // Provider List by Type
  const currentProviderList = (() => {
    switch (uiType) {
      case "bank":
        return BANK_PROVIDERS;
      case "ewallet":
        return EWALLET_PROVIDERS;
      case "credit_card":
        return CREDIT_CARD_PROVIDERS;
      case "paylater":
        return PAYLATER_PROVIDERS;
      default:
        return [];
    }
  })();

  const filteredProviders = currentProviderList.filter((p) =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase()),
  );

  const selectedProviderMeta = currentProviderList.find((p) => p.id === provider);

  // Type change handler
  const handleSelectType = (selectedType: WalletUiType) => {
    setUiType(selectedType);
    setTypeDropdownOpen(false);
    setProviderSearch("");

    if (selectedType === "bank") {
      setProvider("bca");
      setColor("#00529C");
      if (!isEditing || !name.trim()) setName("BCA");
    } else if (selectedType === "ewallet") {
      setProvider("gopay");
      setColor("#00AED6");
      if (!isEditing || !name.trim()) setName("GoPay");
    } else if (selectedType === "credit_card") {
      setProvider("bca");
      setColor("#00529C");
      setCutoffDay("21");
      setDaysAfterCutoff("16");
      setPaymentDay("7");
      if (!isEditing || !name.trim()) setName("BCA Card");
    } else if (selectedType === "paylater") {
      setProvider("spaylater");
      setColor("#EE4D2D");
      setCutoffDay("25");
      setDaysAfterCutoff("10");
      setPaymentDay("5");
      if (!isEditing || !name.trim()) setName("SPayLater");
    } else if (selectedType === "cash") {
      setProvider("cash");
      setColor("#10B981");
      if (!isEditing || !name.trim()) setName("Tunai");
    }
  };

  // Provider change handler
  const handleSelectProvider = (item: ProviderItem) => {
    setProvider(item.id);
    setColor(item.color);
    setProviderDropdownOpen(false);
    setProviderSearch("");

    // Auto update suggested name if default or empty
    const previousLabel = selectedProviderMeta?.name ?? "";
    if (!name.trim() || name === previousLabel) {
      setName(item.name);
    }
  };

  // Mutation Save
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nama dompet wajib diisi.");

      const isCreditType = uiType === "credit_card" || uiType === "paylater";
      const actualType: WalletType = isCreditType
        ? "credit_card"
        : uiType === "cash"
          ? "cash"
          : uiType === "ewallet"
            ? "ewallet"
            : "bank";

      const actualAccountGroup: AccountGroup = isCreditType
        ? "credit"
        : uiType === "cash"
          ? "cash"
          : uiType === "ewallet"
            ? "ewallet"
            : "bank";

      const actualRole: WalletRole = isCreditType ? "credit_card" : role;
      const parsedBalance = parseSignedInt(balance);
      const parsedLimit = isCreditType ? parsePositiveInt(creditLimit) : null;
      const parsedInitialUsage = isCreditType && !isEditing ? parsePositiveInt(pemakaian) : 0;
      const parsedCutoff = isCreditType ? Number(cutoffDay) || 1 : null;
      const parsedPayment = isCreditType ? dueInfo.paymentDay : null;

      if (!isCreditType && Math.abs(parsedBalance) > MAX_IDR_AMOUNT) {
        throw new Error("Nominal saldo maksimal Rp 2.147.483.647.");
      }
      if (isCreditType && parsedLimit !== null && parsedLimit > MAX_IDR_AMOUNT) {
        throw new Error("Limit kartu maksimal Rp 2.147.483.647.");
      }
      if (isCreditType && !isEditing && parsedInitialUsage > MAX_IDR_AMOUNT) {
        throw new Error("Pemakaian awal maksimal Rp 2.147.483.647.");
      }

      if (isEditing && wallet) {
        const syncedStatementDay = isCreditType
          ? parsedCutoff !== wallet.cutoffDay
            ? parsedCutoff
              ? Math.min(28, parsedCutoff + 1)
              : null
            : statementDay
          : null;
        return api.updateWallet(wallet.id, {
          name: name.trim(),
          role: actualRole,
          accountGroup: actualAccountGroup,
          provider,
          openingBalance: isCreditType ? 0 : parsedBalance,
          accountNumber: accountNumber.trim() || null,
          creditLimit: parsedLimit,
          cutoffDay: parsedCutoff,
          statementDay: syncedStatementDay,
          paymentDay: parsedPayment,
          color,
          isActive,
        });
      }

      return api.createWallet({
        name: name.trim(),
        type: actualType,
        accountGroup: actualAccountGroup,
        provider,
        role: actualRole,
        openingBalance: isCreditType ? 0 : parsedBalance,
        initialUsage: isCreditType ? parsedInitialUsage : undefined,
        accountNumber: accountNumber.trim() || null,
        creditLimit: parsedLimit,
        cutoffDay: parsedCutoff,
        statementDay: isCreditType && parsedCutoff ? Math.min(28, parsedCutoff + 1) : null,
        paymentDay: parsedPayment,
        color,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      onSuccess(
        isEditing ? `Dompet ${name} berhasil diperbarui` : `Dompet ${name} berhasil ditambahkan`,
      );
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyimpan dompet.",
      );
    },
  });

  // Mutation Delete
  const deleteMutation = useMutation({
    mutationFn: async (cascade: boolean) => {
      if (!wallet) return;
      return api.deleteWallet(wallet.id, cascade);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      onSuccess(`Dompet ${wallet?.name} berhasil dihapus.`);
      onClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && (err.data as { requiresCascade?: boolean })?.requiresCascade) {
        setCascadeRequired(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Gagal menghapus dompet.");
      }
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    saveMutation.mutate();
  };

  const isCreditOrPaylater = uiType === "credit_card" || uiType === "paylater";
  const inputClass =
    "w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";
  const labelClass =
    "block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]";

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit Dompet: ${wallet?.name}` : "Tambah Dompet"}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isEditing && !confirmDelete ? (
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                setConfirmDelete(true);
              }}
              className="text-xs text-[var(--destructive)]"
            >
              <TrashIcon className="w-4 h-4" />
              <span>Hapus</span>
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={saveMutation.isPending || deleteMutation.isPending}
            >
              {saveMutation.isPending
                ? "Menyimpan..."
                : isEditing
                  ? "Simpan Perubahan"
                  : "Tambah Dompet"}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. TIPE SELECTOR */}
        <div className="relative space-y-1.5" ref={typeRef}>
          <span className={labelClass}>TIPE</span>
          <button
            type="button"
            disabled={isEditing}
            onClick={() => {
              setTypeDropdownOpen((prev) => !prev);
              setProviderDropdownOpen(false);
            }}
            className={`min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] flex items-center justify-between transition-all disabled:opacity-60 ${
              typeDropdownOpen
                ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                : "border-[var(--control-border)]"
            }`}
          >
            <span>{WALLET_UI_TYPES.find((t) => t.id === uiType)?.label}</span>
            {typeDropdownOpen ? (
              <ChevronUpIcon className="text-[var(--muted-foreground)]" />
            ) : (
              <ChevronDownIcon className="text-[var(--muted-foreground)]" />
            )}
          </button>
          {isEditing && (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Tipe dompet tidak dapat diubah setelah dibuat.
            </p>
          )}

          {!isEditing && typeDropdownOpen && (
            <div className="absolute left-0 right-0 top-full z-40 mt-1.5 rounded-[18px] border border-[var(--control-border)] bg-[var(--card)] shadow-2xl p-1.5 space-y-1">
              {WALLET_UI_TYPES.map((t) => {
                const isSelected = uiType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectType(t.id)}
                    className={`w-full px-4 py-2.5 rounded-[12px] text-sm flex items-center justify-between transition-colors ${
                      isSelected
                        ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] font-bold shadow-sm"
                        : "text-[var(--foreground)] font-medium hover:bg-[var(--surface)]"
                    }`}
                  >
                    <span>{t.label}</span>
                    {isSelected && (
                      <CheckIcon className="w-4 h-4 text-[var(--primary-solid-foreground)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. PENYEDIA DROPDOWN (Hidden for Cash/Tunai) */}
        {uiType !== "cash" && (
          <div className="relative space-y-1.5" ref={providerRef}>
            <span className={labelClass}>
              {uiType === "ewallet" ? "PENYEDIA DOMPET" : "PENYEDIA"}
            </span>
            <button
              type="button"
              onClick={() => {
                setProviderDropdownOpen((prev) => !prev);
                setTypeDropdownOpen(false);
              }}
              className={`min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border px-4 py-2.5 text-sm font-semibold flex items-center justify-between transition-all ${
                providerDropdownOpen
                  ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                  : "border-[var(--control-border)]"
              }`}
            >
              <span
                className={
                  selectedProviderMeta
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)]"
                }
              >
                {selectedProviderMeta?.name ?? "Pilih penyedia..."}
              </span>
              {providerDropdownOpen ? (
                <ChevronUpIcon className="text-[var(--muted-foreground)]" />
              ) : (
                <ChevronDownIcon className="text-[var(--muted-foreground)]" />
              )}
            </button>

            {providerDropdownOpen && (
              <div className="absolute left-0 right-0 top-full z-40 mt-1.5 rounded-[18px] border border-[var(--control-border)] bg-[var(--card)] shadow-2xl p-2 space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 border border-[var(--primary)] ring-1 ring-[var(--primary)]/30 rounded-[12px] bg-[var(--surface)]">
                  <SearchIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                  <input
                    type="text"
                    value={providerSearch}
                    onChange={(e) => setProviderSearch(e.target.value)}
                    placeholder="Cari penyedia..."
                    className="min-h-0 w-full bg-transparent text-sm font-medium outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
                  />
                </div>

                <div className="max-h-[190px] overflow-y-auto space-y-0.5 pr-1">
                  {filteredProviders.length === 0 ? (
                    <div className="p-3 text-center text-xs text-[var(--muted-foreground)]">
                      Penyedia tidak ditemukan
                    </div>
                  ) : (
                    filteredProviders.map((p) => {
                      const isSelected = provider === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectProvider(p)}
                          className={`w-full px-3.5 py-2 rounded-[10px] text-sm text-left flex items-center justify-between transition-colors ${
                            isSelected
                              ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                              : "text-[var(--foreground)] font-medium hover:bg-[var(--surface)]"
                          }`}
                        >
                          <span>{p.name}</span>
                          {isSelected && <CheckIcon className="w-4 h-4" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. NAMA DOMPET */}
        <div className="space-y-1.5">
          <label htmlFor="wallet-name-input" className={labelClass}>
            NAMA
          </label>
          <input
            id="wallet-name-input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              uiType === "bank"
                ? "Contoh: BCA"
                : uiType === "ewallet"
                  ? "Contoh: GoPay"
                  : isCreditOrPaylater
                    ? "Contoh: BCA Card"
                    : "Contoh: Tunai"
            }
            className={inputClass}
          />
        </div>

        {/* 4. NOMOR REKENING (OPSIONAL) - For Bank & E-Wallet */}
        {(uiType === "bank" || uiType === "ewallet") && (
          <div className="space-y-1.5">
            <label htmlFor="wallet-account-number" className={labelClass}>
              NOMOR REKENING (OPSIONAL)
            </label>
            <input
              id="wallet-account-number"
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={uiType === "ewallet" ? "No. HP / Rekening" : "No. Rekening"}
              className={`${inputClass} font-mono`}
            />
          </div>
        )}

        {/* 5. PERAN DOMPET & SALDO - For Bank, E-Wallet, Tunai */}
        {!isCreditOrPaylater && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="wallet-role-select" className={labelClass}>
                PERAN DOMPET
              </label>
              <select
                id="wallet-role-select"
                value={role}
                onChange={(e) => setRole(e.target.value as "spending" | "savings")}
                className="min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              >
                <option value="spending">Kas Harian (Safe to Spend)</option>
                <option value="savings">Tabungan / Simpanan (Dana Darurat)</option>
              </select>
            </div>

            {isEditing && wallet && (
              <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={labelClass}>SALDO SAAT INI</span>
                  <strong className="tabular-nums font-mono text-base font-black text-[var(--foreground)]">
                    {formatRupiah(wallet.balance, isMasked)}
                  </strong>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {onOpenReconcile
                      ? "Ingin menyamakan saldo dengan m-banking tanpa mengubah saldo awal?"
                      : "Gunakan Cocokkan Saldo di halaman Dompet untuk menyesuaikan saldo saat ini."}
                  </p>
                  {onOpenReconcile && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenReconcile(wallet);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--primary)] hover:border-[var(--primary)] transition-colors"
                    >
                      Cocokkan Saldo
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="wallet-balance-input" className={labelClass}>
                {isEditing ? "SALDO AWAL" : "SALDO SAAT INI"}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                  Rp
                </span>
                <input
                  id="wallet-balance-input"
                  type="text"
                  inputMode={isEditing ? "text" : "numeric"}
                  value={balance}
                  onChange={(e) =>
                    setBalance(
                      isEditing
                        ? formatSignedDigitsInput(e.target.value)
                        : formatDigitsInput(e.target.value),
                    )
                  }
                  placeholder="0"
                  className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
                />
              </div>
            </div>
          </>
        )}

        {/* 6. CREDIT LIMIT & PEMAKAIAN - For Kartu Kredit & PayLater */}
        {isCreditOrPaylater && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="wallet-credit-limit" className={labelClass}>
                {uiType === "paylater" ? "LIMIT PAYLATER" : "LIMIT"}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                  Rp
                </span>
                <input
                  id="wallet-credit-limit"
                  type="text"
                  inputMode="numeric"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label htmlFor="wallet-pemakaian" className={labelClass}>
                  PEMAKAIAN
                </label>
                <span
                  title="Tagihan atau pemakaian kartu kredit/paylater saat ini"
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--control-border)] text-[10px] text-[var(--muted-foreground)] cursor-help"
                >
                  ?
                </span>
              </div>
              {isEditing ? (
                <>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                      Rp
                    </span>
                    <input
                      id="wallet-pemakaian"
                      type="text"
                      readOnly
                      aria-readonly="true"
                      value={pemakaian}
                      className="w-full rounded-[14px] bg-[var(--surface)] border border-[var(--border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] font-mono cursor-default"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Pemakaian dihitung otomatis dari transaksi dan cicilan aktif kartu ini.
                  </p>
                </>
              ) : (
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                    Rp
                  </span>
                  <input
                    id="wallet-pemakaian"
                    type="text"
                    inputMode="numeric"
                    value={pemakaian}
                    onChange={(e) => setPemakaian(formatDigitsInput(e.target.value))}
                    placeholder="0"
                    className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
                  />
                </div>
              )}
            </div>

            {/* SIKLUS TAGIHAN & JATUH TEMPO */}
            <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={labelClass}>Siklus Tagihan & Jatuh Tempo</span>
                <div className="flex items-center rounded-lg bg-[var(--card)] p-0.5 border border-[var(--border)] text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setDueMode("days");
                      setDaysAfterCutoff(String(dueInfo.daysDiff));
                    }}
                    className={`px-2 py-1 rounded-[6px] transition-colors ${
                      dueMode === "days"
                        ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    Hitung Hari (+Hari)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDueMode("date");
                      setPaymentDay(String(dueInfo.paymentDay));
                    }}
                    className={`px-2 py-1 rounded-[6px] transition-colors ${
                      dueMode === "date"
                        ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    Tanggal Tetap
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Tanggal Cetak Tagihan */}
                <div className="space-y-1">
                  <label
                    htmlFor="wallet-cutoff-day"
                    className="block text-[11px] font-bold text-[var(--foreground)]"
                  >
                    Tgl Cetak Tagihan
                  </label>
                  <input
                    id="wallet-cutoff-day"
                    type="number"
                    min={1}
                    max={28}
                    value={cutoffDay}
                    onChange={(e) => setCutoffDay(e.target.value)}
                    className="w-full rounded-[12px] bg-[var(--card)] border border-[var(--control-border)] px-3 py-2.5 text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono text-center"
                  />
                  <span className="text-[10px] text-[var(--muted-foreground)] block text-center">
                    Tiap tgl {cutoffDay || 1}
                  </span>
                </div>

                {/* Jatuh Tempo */}
                <div className="space-y-1">
                  <label
                    htmlFor="wallet-due-input"
                    className="block text-[11px] font-bold text-[var(--foreground)]"
                  >
                    {dueMode === "days" ? "Jatuh Tempo (+Hari)" : "Tgl Jatuh Tempo"}
                  </label>
                  {dueMode === "days" ? (
                    <>
                      <input
                        id="wallet-due-input"
                        type="number"
                        min={1}
                        max={60}
                        value={daysAfterCutoff}
                        onChange={(e) => setDaysAfterCutoff(e.target.value)}
                        className="w-full rounded-[12px] bg-[var(--card)] border border-[var(--control-border)] px-3 py-2.5 text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono text-center"
                      />
                      <span className="text-[10px] text-[var(--primary)] font-bold block text-center">
                        = Tgl {dueInfo.paymentDay} (
                        {dueInfo.isNextMonth ? "bln depan" : "bln yg sama"})
                      </span>
                    </>
                  ) : (
                    <>
                      <input
                        id="wallet-due-input"
                        type="number"
                        min={1}
                        max={28}
                        value={paymentDay}
                        onChange={(e) => setPaymentDay(e.target.value)}
                        className="w-full rounded-[12px] bg-[var(--card)] border border-[var(--control-border)] px-3 py-2.5 text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono text-center"
                      />
                      <span className="text-[10px] text-[var(--primary)] font-bold block text-center">
                        ~{dueInfo.daysDiff} hari (
                        {dueInfo.isNextMonth ? "bln depan" : "bln yg sama"})
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Live Simulation Card */}
              <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--card)] p-2.5 text-[11px] text-[var(--muted-foreground)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--foreground)]">
                  <span>Simulasi Tagihan:</span>
                  <span className="text-[var(--primary)] font-mono font-bold">
                    Selang {dueInfo.daysDiff} Hari
                  </span>
                </div>
                <p>
                  Tagihan dicetak tiap{" "}
                  <strong className="text-[var(--foreground)]">Tgl {cutoffDay || 1}</strong>, dan
                  jatuh tempo pembayaran pada{" "}
                  <strong className="text-[var(--foreground)]">Tgl {dueInfo.paymentDay}</strong>{" "}
                  {dueInfo.isNextMonth ? "bulan berikutnya" : "di bulan yang sama"} (
                  {dueInfo.daysDiff} hari setelah tagihan dicetak).
                </p>
              </div>
            </div>
          </>
        )}

        {/* 7. ACTIVE TOGGLE IF EDITING */}
        {isEditing && (
          <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--primary)]"
            />
            <span className="text-xs font-semibold text-[var(--foreground)]">
              Dompet Aktif (Tampilkan di pilihan transaksi)
            </span>
          </label>
        )}

        {/* 8. DELETE CONFIRMATION BOX IF EDITING */}
        {isEditing && confirmDelete && (
          <div className="rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/5 p-4 space-y-3">
            <div className="flex items-start gap-2.5 text-[var(--destructive)]">
              <AlertIcon className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-[var(--foreground)]">
                  Hapus Dompet {wallet?.name}?
                </h4>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {cascadeRequired
                    ? "Dompet ini memiliki riwayat transaksi atau kewajiban aktif. Menghapusnya akan menghapus seluruh data transaksi terkait secara permanen."
                    : "Apakah Anda yakin ingin menghapus dompet ini? Tindakan ini tidak dapat dibatalkan."}
                </p>
              </div>
            </div>

            {cascadeRequired && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--foreground)] font-semibold bg-[var(--card)] p-2.5 rounded-[10px] border border-[var(--border)]">
                <input
                  type="checkbox"
                  checked={cascadeConfirmed}
                  onChange={(e) => setCascadeConfirmed(e.target.checked)}
                  className="h-4 w-4 rounded accent-[var(--destructive)]"
                />
                <span>
                  Saya mengerti & setuju menghapus dompet ini beserta seluruh transaksinya
                </span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirmDelete(false);
                  setCascadeRequired(false);
                  setCascadeConfirmed(false);
                  setError("");
                }}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleteMutation.isPending || (cascadeRequired && !cascadeConfirmed)}
                onClick={() => deleteMutation.mutate(cascadeConfirmed || cascadeRequired)}
              >
                {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus Permanen"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </ModalSheet>
  );
}
