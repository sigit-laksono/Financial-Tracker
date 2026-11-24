import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WalletDto } from "../lib/api";
import { api } from "../lib/api";
import { formatCompactRupiah, formatRupiah } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { BankBadge } from "../components/BankBadge";
import { EditIcon, PlusIcon, WalletIcon } from "../components/Icons";
import { ReconcileModal } from "../components/ReconcileModal";
import { Badge, Button, StateView } from "../components/UI";
import { WalletFormModal } from "../components/WalletFormModal";

export function WalletsPage({
  onToast,
  onOpenQuickAdd,
}: {
  onToast: (msg: string) => void;
  onOpenQuickAdd?: (mode: "expense" | "transfer") => void;
}) {
  const { isMasked } = usePrivacyMode();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<WalletDto | null>(null);
  const [reconcileWallet, setReconcileWallet] = useState<WalletDto | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => api.getWallets(),
  });

  const wallets = data?.wallets ?? [];

  // Categorize wallets
  const { bankWallets, ewalletWallets, cashWallets, creditWallets, totalLiquid, totalCreditUsed } =
    useMemo(() => {
      let liquid = 0;
      let creditUsed = 0;

      const bank: WalletDto[] = [];
      const ewallet: WalletDto[] = [];
      const cash: WalletDto[] = [];
      const credit: WalletDto[] = [];

      for (const w of wallets) {
        if (w.type === "credit_card" || w.accountGroup === "credit") {
          credit.push(w);
          if (w.isActive) creditUsed += w.limitUsed;
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
        totalCreditUsed: creditUsed,
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
    const percentOfLiquid =
      totalLiquid > 0 && !isCredit && w.balance > 0
        ? Math.round((w.balance / totalLiquid) * 100)
        : 0;

    return (
      <div
        key={w.id}
        className="group relative flex flex-col justify-between rounded-[16px] border border-[var(--border)] bg-[var(--card)] p-4 transition-all duration-200 hover:border-[var(--primary)] hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <BankBadge provider={w.provider || "other"} size="md" />
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-[var(--foreground)] truncate max-w-[150px] sm:max-w-[200px]">
                  {w.name}
                </h3>
                {!w.isActive && (
                  <Badge tone="neutral" className="text-[10px] px-1.5 py-0">
                    Nonaktif
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                <span className="capitalize">
                  {isCredit
                    ? "Kartu Kredit"
                    : w.role === "savings"
                      ? "Tabungan / Simpanan"
                      : "Kas Harian"}
                </span>
                {w.accountNumber && (
                  <>
                    <span>•</span>
                    <span className="font-mono font-medium">{w.accountNumber}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingWallet(w);
              setWalletModalOpen(true);
            }}
            aria-label={`Edit ${w.name}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
          >
            <EditIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Display */}
        <div className="mt-4 space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted-foreground)]">
            {isCredit ? "Sisa Limit Kartu" : "Saldo Saat Ini"}
          </span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xl font-black tabular-nums tracking-tight text-[var(--foreground)]">
              {formatRupiah(w.balance, isMasked)}
            </span>
            {!isCredit && percentOfLiquid > 0 && (
              <span className="text-[11px] font-bold text-[var(--muted-foreground)] bg-[var(--surface)] px-2 py-0.5 rounded-full">
                {percentOfLiquid}%
              </span>
            )}
          </div>

          {isCredit ? (
            <div className="pt-2 text-xs space-y-1">
              <div className="flex justify-between text-[11px] text-[var(--muted-foreground)]">
                <span>Terpakai: {formatRupiah(w.limitUsed, isMasked)}</span>
                <span>Limit: {formatCompactRupiah(w.creditLimit ?? 0, isMasked)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                <div
                  className="h-full bg-[var(--primary)] rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((w.limitUsed / (w.creditLimit || 1)) * 100),
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="pt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setReconcileWallet(w)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)] transition-colors"
              >
                <span>Cocokkan Saldo Dompet</span>
              </button>
              {onOpenQuickAdd && (
                <button
                  type="button"
                  onClick={() => onOpenQuickAdd("transfer")}
                  className="inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-[var(--primary)] hover:underline"
                >
                  Transfer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (title: string, subtitle: string, items: WalletDto[], isCredit = false) => {
    if (items.length === 0) return null;

    const subtotal = items
      .filter((w) => w.isActive)
      .reduce((sum, w) => sum + (isCredit ? w.limitUsed : w.balance), 0);

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">{title}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>
          </div>
          <span className="font-mono text-sm font-bold tabular-nums text-[var(--foreground)]">
            Subtotal: {formatRupiah(subtotal, isMasked)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((w) => renderWalletCard(w, isCredit))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Dompet & Rekening</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Kelola seluruh rekening bank, dompet digital, kartu kredit, dan uang tunai.
          </p>
        </div>
      </div>

      {/* Hero Card Total Saldo Likuid */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <WalletIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Dana Likuid</span>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(totalLiquid, isMasked)}
              </p>
            </div>
            <p className="text-xs sm:text-sm text-[var(--hero-card-muted)] max-w-md">
              Total dana tunai, rekening bank, dan saldo e-wallet yang siap digunakan tanpa
              kewajiban kredit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setEditingWallet(null);
                setWalletModalOpen(true);
              }}
              className="min-h-[44px]"
            >
              <PlusIcon className="w-5 h-5" />
              <span>Tambah Dompet</span>
            </Button>
            {onOpenQuickAdd && (
              <Button
                variant="secondary"
                onClick={() => onOpenQuickAdd("transfer")}
                className="min-h-[44px]"
              >
                <span>Transfer Antar Dompet</span>
              </Button>
            )}
          </div>
        </div>

        {/* Mini stats row */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--hero-border)] pt-4 sm:grid-cols-4">
          <div>
            <span className="text-[11px] font-semibold text-[var(--hero-card-muted)]">
              Rekening Bank
            </span>
            <p className="font-mono text-sm font-bold text-[var(--hero-card-foreground)] tabular-nums">
              {bankWallets.length} Akun
            </p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[var(--hero-card-muted)]">
              E-Wallet
            </span>
            <p className="font-mono text-sm font-bold text-[var(--hero-card-foreground)] tabular-nums">
              {ewalletWallets.length} Dompet
            </p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[var(--hero-card-muted)]">
              Kas Tunai
            </span>
            <p className="font-mono text-sm font-bold text-[var(--hero-card-foreground)] tabular-nums">
              {cashWallets.length} Dompet
            </p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[var(--hero-card-muted)]">
              Tagihan CC Terpakai
            </span>
            <p className="font-mono text-sm font-bold text-[var(--destructive)] tabular-nums">
              {formatRupiah(totalCreditUsed, isMasked)}
            </p>
          </div>
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
          {renderSection(
            "Rekening Bank",
            "Tabungan utama dan rekening operasional bank konvensional & digital",
            bankWallets,
          )}
          {renderSection(
            "Dompet Digital (E-Wallet)",
            "Saldo GoPay, OVO, DANA, ShopeePay untuk transaksi harian",
            ewalletWallets,
          )}
          {renderSection(
            "Kas Fisik & Tunai",
            "Uang kertas di dompet fisik atau celengan",
            cashWallets,
          )}
          {renderSection(
            "Kartu Kredit & Paylater",
            "Limit kredit aktif beserta siklus tagihan dan pemakaian saat ini",
            creditWallets,
            true,
          )}
        </div>
      )}

      {/* Modals */}
      <WalletFormModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        wallet={editingWallet}
        onSuccess={(msg) => onToast(msg)}
      />

      <ReconcileModal
        wallet={reconcileWallet}
        onClose={() => setReconcileWallet(null)}
        onSuccess={(msg) => onToast(msg)}
      />
    </div>
  );
}
