import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WalletProvider } from "../../../shared/src/types";
import { api, ApiError, type SettingsDto, type WalletDto } from "../lib/api";
import {
  formatDigitsInput,
  jakartaToday,
  parsePositiveInt,
} from "../lib/format";
import { budgetKeys } from "../lib/queryKeys";
import { BankBadge } from "./BankBadge";
import { SparkIcon } from "./Icons";
import { Button, ModalSheet } from "./UI";

const POPULAR_PROVIDERS: Array<{ id: WalletProvider; name: string }> = [
  { id: "bca", name: "BCA" },
  { id: "mandiri", name: "Bank Mandiri" },
  { id: "bri", name: "BRI" },
  { id: "bni", name: "BNI" },
  { id: "jago", name: "Bank Jago" },
  { id: "seabank", name: "SeaBank" },
  { id: "jenius", name: "Jenius (BTPN)" },
  { id: "cash", name: "Tunai / Dompet Fisik" },
  { id: "gopay", name: "GoPay" },
  { id: "ovo", name: "OVO" },
  { id: "dana", name: "DANA" },
];

const CC_PROVIDERS: Array<{ id: WalletProvider; name: string }> = [
  { id: "bca", name: "BCA" },
  { id: "mandiri", name: "Mandiri" },
  { id: "bni", name: "BNI" },
  { id: "bri", name: "BRI" },
  { id: "jenius", name: "Jenius" },
  { id: "other", name: "Lainnya" },
];

const PROVIDER_COLORS: Partial<Record<WalletProvider, string>> = {
  bca: "#00529C",
  mandiri: "#003D79",
  bri: "#00529F",
  bni: "#005E6A",
  btn: "#003A70",
  cimb: "#ED1B2D",
  bsi: "#00A39D",
  permata: "#78BE20",
  danamon: "#003366",
  jago: "#FFD500",
  seabank: "#FE5D26",
  blu: "#00C2FF",
  jenius: "#00A4E4",
  cash: "#10B981",
  gopay: "#00AED6",
  ovo: "#4C2A86",
  dana: "#118EEA",
  shopeepay: "#EE4D2D",
  linkaja: "#ED1C24",
  astrapay: "#004B93",
  isaku: "#0072CE",
  mega: "#F7941D",
  spaylater: "#EE4D2D",
  gopaylater: "#00AED6",
  kredivo: "#FF5722",
  akulaku: "#E51C23",
  traveloka_paylater: "#0264D6",
  indodana: "#00A859",
  atome: "#FFFF00",
  other: "#475569",
};

export function OnboardingModal({
  open,
  settings,
  existingWallets = [],
  onClose,
  onComplete,
}: {
  open: boolean;
  settings?: SettingsDto;
  existingWallets?: WalletDto[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Siklus Gajian & Rekening Utama
  const [gajianDay, setGajianDay] = useState(settings?.gajianStartDay ?? 25);
  const [selectedProvider, setSelectedProvider] = useState<WalletProvider>("bca");
  const [walletName, setWalletName] = useState("BCA");
  const [selectedWalletId, setSelectedWalletId] = useState<number | null>(
    existingWallets.length > 0 ? (existingWallets[0]?.id ?? null) : null,
  );
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(existingWallets.length === 0);

  // Step 2: Saldo Awal & Kartu Kredit
  const [initialBalanceInput, setInitialBalanceInput] = useState("");
  const [hasCc, setHasCc] = useState(false);
  const [ccProvider, setCcProvider] = useState<WalletProvider>("bca");
  const [ccName, setCcName] = useState("Kartu Kredit BCA");
  const [ccLimitInput, setCcLimitInput] = useState("10.000.000");
  const [ccCutoffDay, setCcCutoffDay] = useState(20);
  const [ccPaymentDay, setCcPaymentDay] = useState(10);

  // Step 3: Estimasi Gaji & Penghasilan Bulanan
  const [incomeEstimateInput, setIncomeEstimateInput] = useState(
    settings?.netSalary && settings.netSalary > 0
      ? settings.netSalary.toLocaleString("id-ID")
      : "8.000.000",
  );
  const [error, setError] = useState("");
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    if (!prevOpenRef.current) {
      prevOpenRef.current = true;
      const liquidExisting = existingWallets.filter((w) => w.type !== "credit_card");
      setStep(1);
      setGajianDay(settings?.gajianStartDay ?? 25);
      setSelectedWalletId(liquidExisting[0]?.id ?? null);
      setIsCreatingNew(liquidExisting.length === 0);
      setIncomeEstimateInput(
        settings?.netSalary && settings.netSalary > 0
          ? settings.netSalary.toLocaleString("id-ID")
          : "8.000.000",
      );
      setError("");
    }
  }, [open, settings, existingWallets]);

  const estimatedIncome = parsePositiveInt(incomeEstimateInput);

  const activePrimaryWalletName =
    isCreatingNew || existingWallets.length === 0
      ? walletName.trim() ||
        POPULAR_PROVIDERS.find((p) => p.id === selectedProvider)?.name ||
        "Rekening Utama"
      : existingWallets.find((w) => w.id === selectedWalletId)?.name || "Rekening Utama";

  const activePrimaryProvider: WalletProvider =
    isCreatingNew || existingWallets.length === 0
      ? selectedProvider
      : existingWallets.find((w) => w.id === selectedWalletId)?.provider ?? "other";

  const completeMutation = useMutation({
    mutationFn: async () => {
      // 1. Buat atau sesuaikan rekening utama
      const initialBalance = parsePositiveInt(initialBalanceInput);
      const ccLimit = hasCc ? parsePositiveInt(ccLimitInput) : 0;
      if (
        initialBalance > 2_147_483_647 ||
        ccLimit > 2_147_483_647 ||
        estimatedIncome > 2_147_483_647
      ) {
        throw new Error("Nominal maksimal Rp 2.147.483.647.");
      }
      let primaryWalletId: number | null = null;

      if (isCreatingNew || existingWallets.length === 0) {
        const isCash = selectedProvider === "cash";
        const isEwallet =
          selectedProvider === "gopay" || selectedProvider === "ovo" || selectedProvider === "dana";
        const walletColor = PROVIDER_COLORS[selectedProvider] || "#00797a";
        const res = await api.createWallet({
          name: walletName.trim() || "Rekening Utama",
          type: isCash ? "cash" : isEwallet ? "ewallet" : "bank",
          provider: selectedProvider,
          openingBalance: initialBalance,
          color: walletColor,
          role: "spending",
        });
        primaryWalletId = res.wallet.id;
      } else if (selectedWalletId) {
        primaryWalletId = selectedWalletId;
        if (initialBalance > 0) {
          await api.reconcileWallet(selectedWalletId, {
            actualBalance: initialBalance,
            date: jakartaToday(),
            note: "Saldo awal setup onboarding",
          });
        }
      }

      // 2. Simpan pengaturan siklus gajian, rekening payroll, dan estimasi gaji bulanan
      await api.updateSettings({
        gajianStartDay: gajianDay,
        defaultSalaryWalletId: primaryWalletId ?? undefined,
        ...(estimatedIncome > 0
          ? {
              netSalary: estimatedIncome,
              grossSalary: estimatedIncome,
              payrollDeduction: 0,
            }
          : {}),
      });

      if (primaryWalletId) {
        localStorage.setItem("ft-last-wallet-id", String(primaryWalletId));
      }

      // 3. Buat Kartu Kredit jika user mencentang
      if (hasCc) {
        const validCutoff = Math.min(28, Math.max(1, ccCutoffDay));
        const validPayment = Math.min(28, Math.max(1, ccPaymentDay));
        const validStatement = Math.min(28, validCutoff + 1);
        const ccColor = PROVIDER_COLORS[ccProvider] || "#e16c10";

        await api.createWallet({
          name: ccName.trim() || "Kartu Kredit",
          type: "credit_card",
          provider: ccProvider,
          openingBalance: 0,
          color: ccColor,
          creditLimit: ccLimit > 0 ? ccLimit : 10_000_000,
          cutoffDay: validCutoff,
          statementDay: validStatement,
          paymentDay: validPayment,
          role: "credit_card",
        });
      }

      // 4. Tandai selesai di localStorage
      localStorage.setItem("ft-onboarding-completed", "true");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["budgets"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onComplete();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Gagal menyelesaikan setup.",
      );
    },
  });

  const handleNext = () => {
    setError("");
    if (step === 1) {
      if (gajianDay < 1 || gajianDay > 28) {
        setError("Tanggal gajian harus antara 1 sampai 28.");
        return;
      }
      if ((isCreatingNew || existingWallets.length === 0) && !walletName.trim()) {
        setError("Silakan isi nama rekening utama.");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      completeMutation.mutate();
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title="Selamat Datang di Financial Tracker! 👋"
      subtitle={`Langkah ${step} dari 3: ${
        step === 1
          ? "Siklus Gajian & Rekening Utama"
          : step === 2
            ? "Saldo Awal & Kartu Kredit"
            : "Estimasi Penghasilan & Gaji Bulanan"
      }`}
      footer={
        <div className="flex items-center justify-between gap-3">
          {step > 1 ? (
            <Button
              variant="secondary"
              onClick={() => setStep((s) => (s - 1) as 1 | 2)}
              className="px-4"
            >
              ← Kembali
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("ft-onboarding-completed", "true");
                onClose();
              }}
              className="min-h-[44px] px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
            >
              Lewati Setup
            </button>
          )}

          <Button
            disabled={completeMutation.isPending}
            onClick={handleNext}
            className="px-5 ml-auto"
          >
            {completeMutation.isPending
              ? "Menyimpan..."
              : step === 3
                ? "Selesai & Mulai Mencatat"
                : "Lanjut →"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pt-1">
        {/* Step Indicator Progress Bar */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                s <= step
                  ? "bg-[var(--primary)]"
                  : "bg-[var(--surface)] border border-[var(--border)]"
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="rounded-[10px] border border-[var(--destructive)] bg-[var(--surface)] p-3 text-xs text-[var(--destructive)]">
            {error}
          </div>
        )}

        {/* STEP 1: Siklus Gajian & Rekening Utama */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-1">
              <p className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                <SparkIcon className="w-4 h-4 text-[var(--primary)]" />
                <span>Kenapa tanggal gajian penting?</span>
              </p>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Aplikasi ini menghitung sisa jatah belanja harian berdasarkan siklus dari hari
                gajian ke hari gajian berikutnya, bukan sekadar kalender kaku.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="ob-gajian-day"
                className="block text-sm font-semibold text-[var(--foreground)]"
              >
                Tanggal Anda Menerima Gaji Bulanan (1–28)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="ob-gajian-day"
                  type="number"
                  min={1}
                  max={28}
                  value={gajianDay}
                  onChange={(e) => setGajianDay(Number(e.target.value))}
                  className="tabular-nums min-h-[44px] w-24 rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-center text-lg font-bold text-[var(--foreground)]"
                />
                <span className="text-xs text-[var(--muted-foreground)]">
                  {gajianDay === 1
                    ? "Siklus Bulanan (Tgl 1 – Akhir Bulan)"
                    : `Siklus Gajian (Tgl ${gajianDay} – Tgl ${gajianDay - 1} bln depan)`}
                </span>
              </div>
            </div>

            {/* Pilihan Rekening Utama */}
            <div className="space-y-3 pt-2 border-t border-[var(--border)]">
              <div className="flex items-center justify-between">
                <p className="block text-sm font-semibold text-[var(--foreground)]">
                  Pilih Bank / Dompet Operasional Utama
                </p>
                {existingWallets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingNew((prev) => !prev)}
                    className="text-xs font-bold text-[var(--primary)] hover:underline"
                  >
                    {isCreatingNew ? "Gunakan Dompet yang Ada" : "+ Tambah Rekening Baru"}
                  </button>
                )}
              </div>

              {existingWallets.length > 0 && !isCreatingNew ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Pilih rekening yang menjadi pusat penerima gaji & pengeluaran utama Anda:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
                    {existingWallets
                      .filter((w) => w.type !== "credit_card")
                      .map((w) => {
                        const isSelected = selectedWalletId === w.id;
                        return (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => setSelectedWalletId(w.id)}
                            className={`flex min-h-[48px] items-center gap-2.5 rounded-[10px] border p-2.5 text-left text-xs transition-all ${
                              isSelected
                                ? "border-[var(--primary)] bg-[var(--surface)] ring-1 ring-[var(--primary)] font-bold text-[var(--foreground)]"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--control-border)] hover:text-[var(--foreground)]"
                            }`}
                          >
                            <BankBadge provider={w.provider} size="sm" />
                            <div className="truncate">
                              <p className="font-bold text-[var(--foreground)] truncate">{w.name}</p>
                              <p className="text-[10px] text-[var(--muted-foreground)]">
                                Saldo: Rp {w.balance.toLocaleString("id-ID")}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Pilih bank atau dompet yang paling sering Anda gunakan untuk transaksi harian:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                    {POPULAR_PROVIDERS.map((p) => {
                      const isSelected = selectedProvider === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedProvider(p.id);
                            setWalletName(p.name);
                          }}
                          className={`flex min-h-[44px] items-center gap-2 rounded-[10px] border p-2 text-left text-xs transition-all ${
                            isSelected
                              ? "border-[var(--primary)] bg-[var(--surface)] ring-1 ring-[var(--primary)] font-bold text-[var(--foreground)]"
                              : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--control-border)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          <BankBadge provider={p.id} size="sm" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label
                      htmlFor="ob-wallet-name"
                      className="block text-xs font-semibold text-[var(--muted-foreground)]"
                    >
                      Label Nama Rekening
                    </label>
                    <input
                      id="ob-wallet-name"
                      type="text"
                      value={walletName}
                      onChange={(e) => setWalletName(e.target.value)}
                      placeholder="Contoh: BCA Payroll"
                      className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Saldo Awal & Kartu Kredit */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <BankBadge provider={activePrimaryProvider} size="sm" />
                <label
                  htmlFor="ob-initial-balance"
                  className="block text-sm font-bold text-[var(--foreground)]"
                >
                  Saldo Saat Ini di {activePrimaryWalletName} (Rp)
                </label>
              </div>
              <input
                id="ob-initial-balance"
                inputMode="numeric"
                value={initialBalanceInput}
                onChange={(e) => setInitialBalanceInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums min-h-[48px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3.5 text-xl font-extrabold text-[var(--foreground)]"
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Masukkan saldo riil di rekening/m-banking Anda saat ini agar uang aman belanja langsung akurat.
              </p>
            </div>

            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasCc}
                  onChange={(e) => setHasCc(e.target.checked)}
                  className="h-4 w-4 rounded accent-[var(--primary)]"
                />
                <span className="text-xs font-bold text-[var(--foreground)]">
                  Saya memiliki Kartu Kredit (Opsional)
                </span>
              </label>

              {hasCc && (
                <div className="space-y-3 pt-2 border-t border-[var(--border)] animate-in fade-in duration-200">
                  <div className="space-y-1.5">
                    <p className="block text-xs font-semibold text-[var(--muted-foreground)]">
                      Penyedia Kartu Kredit
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {CC_PROVIDERS.map((c) => {
                        const isSelected = ccProvider === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setCcProvider(c.id);
                              setCcName(c.id === "other" ? "Kartu Kredit" : `Kartu Kredit ${c.name}`);
                            }}
                            className={`flex min-h-[38px] items-center gap-1.5 rounded-[8px] border p-2 text-left text-xs transition-all ${
                              isSelected
                                ? "border-[var(--primary)] bg-[var(--surface)] ring-1 ring-[var(--primary)] font-bold text-[var(--foreground)]"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--control-border)]"
                            }`}
                          >
                            <BankBadge provider={c.id} size="sm" />
                            <span className="truncate">{c.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="ob-cc-name"
                      className="block text-xs font-semibold text-[var(--muted-foreground)]"
                    >
                      Nama / Label Kartu Kredit
                    </label>
                    <input
                      id="ob-cc-name"
                      type="text"
                      value={ccName}
                      onChange={(e) => setCcName(e.target.value)}
                      className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm text-[var(--foreground)]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="ob-cc-limit"
                      className="block text-xs font-semibold text-[var(--muted-foreground)]"
                    >
                      Limit Kartu Kredit (Rp)
                    </label>
                    <input
                      id="ob-cc-limit"
                      inputMode="numeric"
                      value={ccLimitInput}
                      onChange={(e) => setCcLimitInput(formatDigitsInput(e.target.value))}
                      className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--foreground)]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label htmlFor="ob-cc-cutoff" className="block text-xs font-semibold text-[var(--muted-foreground)]">
                        Tgl Cetak Tagihan (Cutoff, 1–28)
                      </label>
                      <input
                        id="ob-cc-cutoff"
                        type="number"
                        min={1}
                        max={28}
                        value={ccCutoffDay}
                        onChange={(e) => setCcCutoffDay(Number(e.target.value))}
                        className="min-h-[40px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm text-center font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="ob-cc-payment" className="block text-xs font-semibold text-[var(--muted-foreground)]">
                        Tgl Jatuh Tempo Bayar (1–28)
                      </label>
                      <input
                        id="ob-cc-payment"
                        type="number"
                        min={1}
                        max={28}
                        value={ccPaymentDay}
                        onChange={(e) => setCcPaymentDay(Number(e.target.value))}
                        className="min-h-[40px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm text-center font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Estimasi Gaji & Penghasilan Bulanan */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="ob-income-estimate"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Perkiraan Penghasilan / Gaji Bulanan (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--muted-foreground)]">
                  Rp
                </span>
                <input
                  id="ob-income-estimate"
                  inputMode="numeric"
                  value={incomeEstimateInput}
                  onChange={(e) => setIncomeEstimateInput(formatDigitsInput(e.target.value))}
                  placeholder="Contoh: 8.000.000"
                  className="w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-3 text-lg font-bold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Estimasi gaji bersih ini akan digunakan sebagai dasar perhitungan anggaran per siklus dan acuan arus kas harian Anda.
              </p>
            </div>

            <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--muted-foreground)] leading-relaxed space-y-1">
              <p className="font-bold text-[var(--foreground)]">Anggaran Kategori Kustom</p>
              <p>
                Anda bebas menentukan batas anggaran sesuai kebutuhan untuk masing-masing kategori
                belanja (custom budget) kapan saja melalui menu{" "}
                <strong className="text-[var(--foreground)]">Anggaran</strong>.
              </p>
            </div>
          </div>
        )}
      </div>
    </ModalSheet>
  );
}
