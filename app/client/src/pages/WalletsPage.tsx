import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type WalletDto } from "../lib/api";
import {
  MAX_IDR_AMOUNT,
  formatCompactRupiah,
  formatDigitsInput,
  formatRupiah,
  parsePositiveInt,
} from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { BankBadge } from "../components/BankBadge";
import { EditIcon, PlusIcon, SettingsIcon, TrashIcon, WalletIcon } from "../components/Icons";
import { ReconcileModal } from "../components/ReconcileModal";
import { Badge, Button, ModalSheet, StateView } from "../components/UI";
import { WalletFormModal } from "../components/WalletFormModal";

function CreditCardRecurringFeesModal({
  wallet,
  onClose,
  onToast,
}: {
  wallet: WalletDto | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const [feeName, setFeeName] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [formError, setFormError] = useState("");

  const walletId = wallet?.id ?? 0;

  const { data: feesData, isLoading } = useQuery({
    queryKey: ["wallet-recurring-fees", walletId],
    queryFn: () => api.getWalletRecurringFees(walletId),
    enabled: Boolean(wallet),
  });

  const invalidateFees = async () => {
    await queryClient.invalidateQueries({ queryKey: ["wallet-recurring-fees", walletId] });
    await queryClient.invalidateQueries({ queryKey: ["debts"] });
    await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.createWalletRecurringFee(walletId, {
        name: feeName.trim(),
        amount: parsePositiveInt(feeAmount),
        isActive: true,
      }),
    onSuccess: async () => {
      await invalidateFees();
      setFeeName("");
      setFeeAmount("");
      setFormError("");
      onToast(`Biaya rutin untuk ${wallet?.name ?? "kartu"} ditambahkan`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambah biaya rutin.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ feeId, isActive }: { feeId: number; isActive: boolean }) =>
      api.updateWalletRecurringFee(walletId, feeId, { isActive }),
    onSuccess: async () => {
      await invalidateFees();
      onToast("Status biaya rutin diperbarui");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal memperbarui status biaya.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (feeId: number) => api.deleteWalletRecurringFee(walletId, feeId),
    onSuccess: async () => {
      await invalidateFees();
      onToast("Biaya rutin dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus biaya rutin.");
    },
  });

  const fees = feesData?.fees ?? [];

  return (
    <ModalSheet
      open={Boolean(wallet)}
      onClose={onClose}
      title="Biaya Rutin Kartu Kredit"
      subtitle={wallet ? `${wallet.name} · Otomatis dicatat tiap tutup buku` : undefined}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-xs text-[var(--muted-foreground)]">Memuat daftar biaya rutin...</p>
        ) : fees.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center text-xs text-[var(--muted-foreground)]">
            Belum ada biaya rutin terdaftar (mis. Biaya Meterai, Iuran Tahunan).
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            {fees.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 p-3 text-xs">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--foreground)] truncate">{f.name}</span>
                    <Badge
                      tone={f.isActive ? "soft" : "neutral"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {f.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <p className="tabular-nums font-mono text-[var(--muted-foreground)]">
                    {formatRupiah(f.amount, isMasked)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ feeId: f.id, isActive: !f.isActive })}
                    className="min-h-[44px] rounded-[10px] border border-[var(--control-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--card)] transition-colors"
                  >
                    {f.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus biaya ${f.name}`}
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(f.id)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--destructive)] hover:bg-[var(--surface)] transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form tambah biaya rutin */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!feeName.trim()) {
              setFormError("Nama biaya wajib diisi.");
              return;
            }
            const parsedFeeAmount = parsePositiveInt(feeAmount);
            if (parsedFeeAmount <= 0) {
              setFormError("Nominal biaya harus lebih dari Rp0.");
              return;
            }
            if (parsedFeeAmount > MAX_IDR_AMOUNT) {
              setFormError("Nominal biaya maksimal Rp 2.147.483.647.");
              return;
            }
            setFormError("");
            addMutation.mutate();
          }}
          className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Tambah Biaya Rutin Baru
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              value={feeName}
              onChange={(e) => {
                setFeeName(e.target.value);
                setFormError("");
              }}
              placeholder="Contoh: Biaya Meterai"
              className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm text-[var(--foreground)]"
            />
            <input
              inputMode="numeric"
              value={feeAmount}
              onChange={(e) => {
                setFeeAmount(formatDigitsInput(e.target.value));
                setFormError("");
              }}
              placeholder="Nominal (Rp)"
              className="tabular-nums font-mono min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm text-[var(--foreground)]"
            />
          </div>
          {formError && (
            <p role="alert" className="text-xs text-[var(--destructive)]">
              {formError}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={addMutation.isPending}
              className="w-full sm:w-auto text-xs"
            >
              <PlusIcon className="w-4 h-4" />
              <span>{addMutation.isPending ? "Menyimpan..." : "Tambah Biaya Rutin"}</span>
            </Button>
          </div>
        </form>
      </div>
    </ModalSheet>
  );
}

export function WalletsPage({
  onToast,
  onOpenQuickAdd,
}: {
  onToast: (msg: string) => void;
  onOpenQuickAdd?: (mode: "expense" | "transfer", initialWalletId?: number) => void;
}) {
  const { isMasked } = usePrivacyMode();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<WalletDto | null>(null);
  const [reconcileWallet, setReconcileWallet] = useState<WalletDto | null>(null);
  const [feeWallet, setFeeWallet] = useState<WalletDto | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => api.getWallets(),
  });

  const wallets = data?.wallets ?? [];

  // Categorize wallets
  const { bankWallets, ewalletWallets, cashWallets, creditWallets, totalLiquid } = useMemo(() => {
    let liquid = 0;

    const bank: WalletDto[] = [];
    const ewallet: WalletDto[] = [];
    const cash: WalletDto[] = [];
    const credit: WalletDto[] = [];

    for (const w of wallets) {
      if (w.type === "credit_card" || w.accountGroup === "credit") {
        credit.push(w);
      } else {
        if (w.isActive) liquid += w.balance;
        if (w.accountGroup === "cash" || w.type === "cash") {
          cash.push(w);
        } else if (w.accountGroup === "ewallet" || w.type === "ewallet") {
          ewallet.push(w);
        } else {
          bank.push(w);
        }
      }
    }

    return {
      bankWallets: bank,
      ewalletWallets: ewallet,
      cashWallets: cash,
      creditWallets: credit,
      totalLiquid: liquid,
    };
  }, [wallets]);

  if (isLoading) {
    return (
      <StateView
        kind="loading"
        title="Memuat dompet & akun..."
        description="Mengambil saldo rekening dan dompet digital terkini."
      />
    );
  }

  if (error) {
    return (
      <StateView
        kind="error"
        title="Gagal memuat daftar dompet"
        description={error instanceof Error ? error.message : "Terjadi kesalahan saat memuat data."}
        actionLabel="Coba Lagi"
        onAction={() => refetch()}
      />
    );
  }

  const renderWalletCard = (w: WalletDto, isCredit = false) => {
    const creditLimit = w.creditLimit ?? 0;
    const remainingLimit = Math.max(0, w.balance);
    const remainingPercent =
      isCredit && creditLimit > 0
        ? Math.min(100, Math.max(0, Math.round((remainingLimit / creditLimit) * 100)))
        : 0;
    const accountLabel = w.accountNumber
      ? isMasked
        ? `••••${w.accountNumber.slice(-4)}`
        : w.accountNumber
      : null;
    const ccSchedule =
      isCredit && (w.cutoffDay || w.paymentDay)
        ? `Tutup buku ${w.cutoffDay ?? "-"} · Jatuh tempo ${w.paymentDay ?? "-"}`
        : null;

    const identity = (
      <div className="flex min-w-0 items-center gap-3">
        <BankBadge provider={w.provider || "other"} size="md" className="shrink-0" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-bold text-[var(--foreground)] break-words">{w.name}</h3>
            {!isCredit && w.role === "savings" && (
              <Badge tone="soft" className="text-[10px] px-1.5 py-0">
                Tabungan
              </Badge>
            )}
            {!w.isActive && (
              <Badge tone="neutral" className="text-[10px] px-1.5 py-0">
                Nonaktif
              </Badge>
            )}
          </div>
          {ccSchedule ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">{ccSchedule}</p>
          ) : (
            accountLabel && (
              <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                <span className="tabular-nums">{accountLabel}</span>
              </p>
            )
          )}
        </div>
      </div>
    );

    const editButton = (
      <button
        type="button"
        onClick={() => {
          setEditingWallet(w);
          setWalletModalOpen(true);
        }}
        aria-label={`Edit ${w.name}`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
      >
        <EditIcon className="w-4 h-4" />
      </button>
    );

    if (isCredit) {
      return (
        <div
          key={w.id}
          className="space-y-3 rounded-[16px] border border-[var(--border)] bg-[var(--card)] p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            {identity}
            {editButton}
          </div>
          <div
            className="h-2 w-full rounded-full border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            role="progressbar"
            aria-valuenow={remainingPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Sisa limit ${remainingPercent}%`}
          >
            <div
              className={`h-full rounded-full transition-all ${
                remainingPercent <= 20
                  ? "bg-[var(--destructive)]"
                  : remainingPercent <= 70
                    ? "bg-[var(--highlight)]"
                    : "bg-[var(--chart-income)]"
              }`}
              style={{ width: `${remainingPercent}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted-foreground)]">
              Sisa{" "}
              <strong className="tabular-nums font-bold text-[var(--foreground)]">
                {formatRupiah(remainingLimit, isMasked)}
              </strong>{" "}
              dari{" "}
              <span className="tabular-nums">{formatCompactRupiah(creditLimit, isMasked)}</span>
            </p>
            <button
              type="button"
              onClick={() => setFeeWallet(w)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--control-border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
            >
              <SettingsIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Biaya Rutin</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={w.id}
        className="flex items-center gap-1 rounded-[16px] border border-[var(--border)] bg-[var(--card)] pr-1.5 transition-colors hover:border-[var(--primary)]"
      >
        <button
          type="button"
          title={`Ketuk untuk cocokkan saldo ${w.name}`}
          onClick={() => setReconcileWallet(w)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[16px] p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          {identity}
          <span className="tabular-nums shrink-0 text-sm font-bold text-[var(--foreground)]">
            {formatRupiah(w.balance, isMasked)}
          </span>
        </button>
        {editButton}
      </div>
    );
  };

  const renderSection = (title: string, items: WalletDto[], isCredit = false) => {
    if (items.length === 0) return null;

    const subtotal = items
      .filter((w) => w.isActive)
      .reduce((sum, w) => sum + (isCredit ? w.limitUsed : w.balance), 0);

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="text-base font-extrabold text-[var(--foreground)]">{title}</h2>
          {items.length > 1 && (
            <span className="text-sm font-semibold text-[var(--muted-foreground)]">
              {isCredit ? "Terpakai" : "Subtotal"}{" "}
              <span className="tabular-nums font-bold text-[var(--foreground)]">
                {formatRupiah(subtotal, isMasked)}
              </span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((w) => renderWalletCard(w, isCredit))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Dompet & Rekening</h1>
        <Button
          variant="primary"
          onClick={() => {
            setEditingWallet(null);
            setWalletModalOpen(true);
          }}
          className="w-full sm:w-auto shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Tambah Dompet</span>
        </Button>
      </div>

      {/* Hero Card Total Saldo Likuid */}
      <div className="relative overflow-hidden rounded-[20px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-5 sm:p-6 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <WalletIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Dana Likuid</span>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-3xl sm:text-4xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(totalLiquid, isMasked)}
              </p>
            </div>
          </div>

          {onOpenQuickAdd && (
            <div className="flex items-center">
              <Button
                variant="secondary"
                onClick={() => onOpenQuickAdd("transfer")}
                className="w-full sm:w-auto min-h-[44px]"
              >
                <span>Transfer Antar Dompet</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Grouped Wallets Sections or Empty State */}
      {wallets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[var(--border)] p-12 text-center bg-[var(--card)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--primary)] mb-3">
            <WalletIcon className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[var(--foreground)]">Belum Ada Dompet / Akun</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-sm">
            Semua dompet telah dihapus. Klik tombol di bawah untuk membuat rekening bank atau
            e-wallet pertama Anda.
          </p>
          <Button
            type="button"
            className="mt-4"
            onClick={() => {
              setEditingWallet(null);
              setWalletModalOpen(true);
            }}
          >
            <PlusIcon className="w-4 h-4 mr-1.5" />
            <span>Tambah Dompet Baru</span>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {renderSection("Rekening Bank", bankWallets)}
          {renderSection("Dompet Digital (E-Wallet)", ewalletWallets)}
          {renderSection("Kas Fisik & Tunai", cashWallets)}
          {renderSection("Kartu Kredit & Paylater", creditWallets, true)}
        </div>
      )}

      {/* Modals */}
      <WalletFormModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        wallet={editingWallet}
        onSuccess={(msg) => onToast(msg)}
        onOpenReconcile={(w) => setReconcileWallet(w)}
      />

      <ReconcileModal
        wallet={reconcileWallet}
        onClose={() => setReconcileWallet(null)}
        onSuccess={(msg) => onToast(msg)}
      />

      <CreditCardRecurringFeesModal
        key={feeWallet?.id ?? "closed"}
        wallet={feeWallet}
        onClose={() => setFeeWallet(null)}
        onToast={onToast}
      />
    </div>
  );
}
