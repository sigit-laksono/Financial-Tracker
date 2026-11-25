import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AssetCategory, type AssetDto, type AssetType } from "../lib/api";
import { formatDigitsInput, formatRupiah, parsePositiveInt } from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import { BankBadge } from "../components/BankBadge";
import { AlertIcon, AssetIcon, EditIcon, PlusIcon, TrashIcon } from "../components/Icons";
import { Badge, Button, Card, ModalSheet, StateView } from "../components/UI";

const ASSET_TYPE_META: Record<AssetType, { label: string; code: string }> = {
  gold: { label: "Emas & Logam Mulia", code: "EMAS" },
  stocks: { label: "Saham (IDX / Global)", code: "SAHM" },
  mutual_fund: { label: "Reksadana", code: "RDN" },
  crypto: { label: "Kripto", code: "KRP" },
  bonds: { label: "Obligasi & SBN", code: "SBN" },
  property: { label: "Tanah & Properti", code: "PROP" },
  vehicle: { label: "Kendaraan Bermotor", code: "VHCL" },
  electronics: { label: "Gadget & Elektronik", code: "ELEC" },
  other: { label: "Aset Lainnya", code: "ASET" },
};

export function AssetsPage({ onToast }: { onToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();

  // Modal Create / Edit Asset State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetDto | null>(null);
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<AssetCategory>("investment");
  const [formType, setFormType] = useState<AssetType>("stocks");
  const [formValuation, setFormValuation] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState("");

  // Quick Valuation Update Modal State
  const [valuationModalAsset, setValuationModalAsset] = useState<AssetDto | null>(null);
  const [quickValuationInput, setQuickValuationInput] = useState("");
  const [quickValuationError, setQuickValuationError] = useState("");

  // Delete Confirmation State
  const [deletingAsset, setDeletingAsset] = useState<AssetDto | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["net-worth-summary"],
    queryFn: () => api.getNetWorthSummary(),
  });

  const createAssetMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      category: AssetCategory;
      type: AssetType;
      valuationAmount: number;
      acquisitionCost?: number | null;
      notes?: string | null;
    }) => api.createAsset(payload),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      setModalOpen(false);
      onToast(`Aset "${variables.name}" berhasil ditambahkan`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyimpan aset.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        name?: string;
        category?: AssetCategory;
        type?: AssetType;
        valuationAmount?: number;
        acquisitionCost?: number | null;
        notes?: string | null;
      };
    }) => api.updateAsset(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      setModalOpen(false);
      setValuationModalAsset(null);
      setEditingAsset(null);
      onToast("Data aset berhasil diperbarui");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal memperbarui aset.";
      setFormError(msg);
      setQuickValuationError(msg);
      onToast(msg);
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: number) => api.deleteAsset(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      const name = deletingAsset?.name ?? "Aset";
      setDeletingAsset(null);
      onToast(`${name} berhasil dihapus`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menghapus aset.";
      setDeletingAsset(null);
      onToast(msg);
    },
  });

  if (isLoading) {
    return (
      <StateView
        kind="loading"
        title="Menghitung kekayaan bersih..."
        description="Mengagregasikan saldo kas, valuasi investasi, aset fisik, dan kewajiban utang."
      />
    );
  }

  if (error || !data) {
    return (
      <StateView
        kind="error"
        title="Gagal memuat kekayaan bersih"
        description={error instanceof Error ? error.message : "Terjadi kesalahan saat memuat data."}
        actionLabel="Coba Lagi"
        onAction={() => refetch()}
      />
    );
  }

  const {
    totalNetWorth,
    totalLiquidAssets,
    totalInvestmentAssets,
    totalFixedAssets,
    totalLiabilities,
    debtToAssetRatio,
    financialStage,
    breakdown,
  } = data;

  const openCreateModal = (category: AssetCategory) => {
    setEditingAsset(null);
    setFormName("");
    setFormCategory(category);
    setFormType(category === "investment" ? "stocks" : "electronics");
    setFormValuation("");
    setFormCost("");
    setFormNotes("");
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (asset: AssetDto) => {
    setEditingAsset(asset);
    setFormName(asset.name);
    setFormCategory(asset.category);
    setFormType(asset.type);
    setFormValuation(asset.valuationAmount.toLocaleString("id-ID"));
    setFormCost(asset.acquisitionCost ? asset.acquisitionCost.toLocaleString("id-ID") : "");
    setFormNotes(asset.notes ?? "");
    setFormError("");
    setModalOpen(true);
  };

  const openQuickValuationModal = (asset: AssetDto) => {
    setValuationModalAsset(asset);
    setQuickValuationInput(asset.valuationAmount.toLocaleString("id-ID"));
    setQuickValuationError("");
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (!name) {
      setFormError("Nama aset wajib diisi.");
      return;
    }

    const valuationAmount = parsePositiveInt(formValuation);
    if (valuationAmount < 0) {
      setFormError("Taksiran nilai aset tidak boleh negatif.");
      return;
    }

    const acquisitionCost = formCost ? parsePositiveInt(formCost) : null;

    if (editingAsset) {
      updateAssetMutation.mutate({
        id: editingAsset.id,
        payload: {
          name,
          category: formCategory,
          type: formType,
          valuationAmount,
          acquisitionCost,
          notes: formNotes.trim() || null,
        },
      });
    } else {
      createAssetMutation.mutate({
        name,
        category: formCategory,
        type: formType,
        valuationAmount,
        acquisitionCost,
        notes: formNotes.trim() || null,
      });
    }
  };

  const handleSaveQuickValuation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valuationModalAsset) return;

    const valuationAmount = parsePositiveInt(quickValuationInput);
    if (valuationAmount < 0) {
      setQuickValuationError("Taksiran nilai aset tidak boleh negatif.");
      return;
    }

    updateAssetMutation.mutate({
      id: valuationModalAsset.id,
      payload: {
        valuationAmount,
      },
    });
  };

  const renderAssetTable = (
    title: string,
    categoryKey: AssetCategory,
    items: AssetDto[],
    totalAmount: number,
  ) => {
    return (
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">{title}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Total Valuasi:{" "}
              <strong className="text-[var(--foreground)] font-mono">
                {formatRupiah(totalAmount, isMasked)}
              </strong>{" "}
              ({items.length} aset)
            </p>
          </div>
          {items.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => openCreateModal(categoryKey)}
              className="min-h-[44px] px-3.5 text-xs font-bold gap-1.5"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>Tambah Aset</span>
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--border)] p-6 text-center space-y-3">
            <p className="text-xs text-[var(--muted-foreground)]">
              {categoryKey === "investment"
                ? "Belum ada aset investasi tercatat."
                : "Belum ada aset fisik tercatat."}
            </p>
            <Button
              variant="secondary"
              onClick={() => openCreateModal(categoryKey)}
              className="min-h-[44px] px-4 text-xs font-semibold gap-1.5"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>{categoryKey === "investment" ? "Catat Investasi" : "Catat Aset Fisik"}</span>
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {items.map((asset) => {
              const meta = ASSET_TYPE_META[asset.type] ?? { label: "Aset", code: "ASET" };
              const hasGainLoss = asset.unrealizedGainLoss != null;
              const isProfit = (asset.unrealizedGainLoss ?? 0) >= 0;

              return (
                <div
                  key={asset.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span
                      className="shrink-0 flex h-10 w-12 items-center justify-center rounded-[10px] bg-[var(--surface)] border border-[var(--border)] text-[10px] font-mono font-extrabold tracking-wider text-[var(--primary)]"
                      aria-hidden="true"
                    >
                      {meta.code}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-bold text-[var(--foreground)] truncate">
                          {asset.name}
                        </strong>
                        <Badge tone="neutral" className="text-[10px] px-1.5 py-0 font-semibold">
                          {meta.label}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        {asset.acquisitionCost != null && asset.acquisitionCost > 0 && (
                          <span>Modal: {formatRupiah(asset.acquisitionCost, isMasked)}</span>
                        )}
                        {hasGainLoss && (
                          <span
                            className={`font-semibold font-mono text-[11px] ${
                              isMasked
                                ? "text-[var(--muted-foreground)]"
                                : isProfit
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-[var(--destructive)]"
                            }`}
                          >
                            {isMasked ? (
                              formatRupiah(asset.unrealizedGainLoss!, true)
                            ) : (
                              <>
                                {isProfit ? "+" : ""}
                                {formatRupiah(asset.unrealizedGainLoss!)} ({isProfit ? "+" : ""}
                                {asset.unrealizedGainLossPercent}%)
                              </>
                            )}
                          </span>
                        )}
                        {asset.notes && (
                          <span className="truncate max-w-[200px] text-[11px] text-[var(--muted-foreground)] opacity-75">
                            · {asset.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Valuation & Action Buttons */}
                  <div className="flex items-center gap-2.5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => openQuickValuationModal(asset)}
                      title="Klik untuk perbarui taksiran nilai (Re-quote)"
                      className="group flex flex-col items-end rounded-[8px] px-2.5 py-1 hover:bg-[var(--surface)] transition-colors text-right"
                    >
                      <span className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] group-hover:text-[var(--primary)]">
                        Nilai Taksiran
                      </span>
                      <span className="font-mono text-sm font-extrabold text-[var(--foreground)]">
                        {formatRupiah(asset.valuationAmount, isMasked)}
                      </span>
                    </button>

                    <Button
                      variant="secondary"
                      onClick={() => openQuickValuationModal(asset)}
                      className="min-h-[44px] h-11 px-3 text-xs font-semibold"
                      title="Perbarui taksiran harga pasar"
                    >
                      Update Nilai
                    </Button>

                    <button
                      type="button"
                      onClick={() => openEditModal(asset)}
                      aria-label={`Edit ${asset.name}`}
                      title="Edit data aset"
                      className="inline-flex min-h-[44px] h-11 w-11 items-center justify-center rounded-[10px] text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingAsset(asset)}
                      aria-label={`Hapus ${asset.name}`}
                      title="Hapus aset ini"
                      className="inline-flex min-h-[44px] h-11 w-11 items-center justify-center rounded-[10px] text-[var(--muted-foreground)] hover:bg-rose-50 hover:text-[var(--destructive)] dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">
          Aset & Kekayaan Bersih
        </h1>

        <Button
          onClick={() => openCreateModal("investment")}
          className="gap-2 self-start sm:self-auto"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Tambah Aset</span>
        </Button>
      </div>

      {/* Net Worth Hero Card */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <AssetIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Kekayaan Bersih (Net Worth)</span>
            </div>
            <Badge tone={financialStage.badgeTone} className="text-[11px] font-bold px-2 py-0.5">
              {financialStage.title}
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
              {formatRupiah(totalNetWorth, isMasked)}
            </p>
          </div>
        </div>

        {/* Debt-to-Asset Ratio Bar with Ideal & Warning Threshold Markers */}
        <div className="mt-6 border-t border-[var(--hero-border)] pt-4 space-y-2.5">
          <div className="flex flex-wrap justify-between gap-2 text-xs font-bold text-[var(--hero-card-muted)]">
            <span
              className={
                isMasked
                  ? "text-[var(--hero-card-foreground)]"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            >
              Total Aset: {formatRupiah(data.totalAssets, isMasked)}
            </span>
            <span
              className={
                isMasked
                  ? "text-[var(--hero-card-foreground)]"
                  : debtToAssetRatio > 50
                    ? "text-[var(--destructive)]"
                    : debtToAssetRatio > 35
                      ? "text-[var(--highlight-text)]"
                      : "text-emerald-600 dark:text-emerald-400"
              }
            >
              Rasio Utang: {debtToAssetRatio}% · Liabilitas: {formatRupiah(totalLiabilities, isMasked)}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="relative h-3 w-full rounded-full bg-[var(--surface)] border border-[var(--border)]">
              <div className="h-full w-full overflow-hidden rounded-full">
                <div
                  className={`h-full transition-all duration-300 ${
                    debtToAssetRatio > 50
                      ? "bg-[var(--destructive)]"
                      : debtToAssetRatio > 35
                        ? "bg-[var(--highlight)]"
                        : "bg-[var(--chart-income)]"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, debtToAssetRatio))}%` }}
                  title={`Rasio Debt-to-Asset: ${debtToAssetRatio}%`}
                />
              </div>
              {/* Vertical threshold markers: 35% ideal & 50% waspada */}
              <span
                aria-hidden="true"
                title="Batas ideal <= 35%"
                className="absolute -top-1 -bottom-1 left-[35%] w-0.5 bg-emerald-600 dark:bg-emerald-400"
              />
              <span
                aria-hidden="true"
                title="Batas waspada 50%"
                className="absolute -top-1 -bottom-1 left-[50%] w-0.5 bg-amber-600 dark:bg-amber-400"
              />
            </div>

            <div
              className="relative h-4 text-[11px] font-semibold text-[var(--hero-card-muted)] tabular-nums"
              aria-hidden="true"
            >
              <span className="absolute left-0">0%</span>
              <span className="absolute left-[35%] -translate-x-1/2">35%</span>
              <span className="absolute left-[50%] -translate-x-1/2">50%</span>
              <span className="absolute right-0">100%</span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[var(--border)]/60 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted-foreground)]">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              <span>Ideal (≤ 35%)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <span>Waspada (35%–50%)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--destructive)]"
                aria-hidden="true"
              />
              <span>Bahaya (&gt; 50%)</span>
            </span>
          </div>
        </div>
      </div>

      {/* 4 Pillar Grid Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-3 sm:p-4 space-y-1">
          <span className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
            1. Kas & Dompet
          </span>
          <p className="metric-value-compact font-extrabold text-[var(--foreground)]">
            {formatRupiah(totalLiquidAssets, isMasked)}
          </p>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {breakdown.liquidWallets.length} dompet aktif
          </span>
        </Card>

        <Card className="p-3 sm:p-4 space-y-1">
          <span className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
            2. Investasi
          </span>
          <p
            className={`metric-value-compact font-extrabold ${
              isMasked
                ? "text-[var(--foreground)]"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {formatRupiah(totalInvestmentAssets, isMasked)}
          </p>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {breakdown.investments.length} portofolio tercatat
          </span>
        </Card>

        <Card className="p-3 sm:p-4 space-y-1">
          <span className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
            3. Aset Fisik
          </span>
          <p
            className={`metric-value-compact font-extrabold ${
              isMasked ? "text-[var(--foreground)]" : "text-sky-600 dark:text-sky-400"
            }`}
          >
            {formatRupiah(totalFixedAssets, isMasked)}
          </p>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {breakdown.fixedAssets.length} aset fisik
          </span>
        </Card>

        <Card className="p-3 sm:p-4 space-y-1">
          <span className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wide">
            4. Total Utang
          </span>
          <p
            className={`metric-value-compact font-extrabold ${
              isMasked ? "text-[var(--foreground)]" : "text-[var(--destructive)]"
            }`}
          >
            {formatRupiah(totalLiabilities, isMasked)}
          </p>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {breakdown.liabilities.length} kewajiban aktif
          </span>
        </Card>
      </div>

      {/* Main Asset Sections */}
      <div className="space-y-6">
        {/* Investment Assets Section */}
        {renderAssetTable(
          "Portofolio Investasi",
          "investment",
          breakdown.investments,
          totalInvestmentAssets,
        )}

        {/* Fixed Assets Section */}
        {renderAssetTable("Aset Tetap & Fisik", "fixed", breakdown.fixedAssets, totalFixedAssets)}

        {/* Integrated Liquid Wallets Summary */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Saldo Kas & Rekening
            </h2>
            <span className="font-mono text-sm font-extrabold text-[var(--foreground)] tabular-nums shrink-0">
              {formatRupiah(totalLiquidAssets, isMasked)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {breakdown.liquidWallets.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <BankBadge provider={w.provider} className="h-7 w-7 text-[10px]" />
                  <span className="text-xs font-bold text-[var(--foreground)] truncate">
                    {w.name}
                  </span>
                </div>
                <strong className="font-mono text-xs font-bold text-[var(--foreground)] tabular-nums">
                  {formatRupiah(w.balance, isMasked)}
                </strong>
              </div>
            ))}
          </div>
        </Card>

        {/* Integrated Debt & Liabilities Summary */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              Kewajiban & Liabilitas
            </h2>
            <span
              className={`font-mono text-sm font-extrabold tabular-nums shrink-0 ${
                isMasked ? "text-[var(--foreground)]" : "text-[var(--destructive)]"
              }`}
            >
              {formatRupiah(totalLiabilities, isMasked)}
            </span>
          </div>

          {breakdown.liabilities.length === 0 ? (
            <div className="p-4 text-center text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              Posisi aman. Tidak ada kewajiban utang aktif saat ini.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {breakdown.liabilities.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <span className="block text-xs font-bold text-[var(--foreground)] truncate">
                      {l.name}
                    </span>
                    <span className="block text-[10px] text-[var(--muted-foreground)]">
                      {l.lender}
                    </span>
                  </div>
                  <strong
                    className={`font-mono text-xs font-bold tabular-nums ${
                      isMasked ? "text-[var(--foreground)]" : "text-[var(--destructive)]"
                    }`}
                  >
                    {formatRupiah(l.balance, isMasked)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Modal Tambah / Edit Aset */}
      <ModalSheet
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingAsset ? "Edit Data Aset" : "Tambah Aset Baru"}
        subtitle="Catat portofolio investasi atau aset fisik untuk memperbarui kalkulasi Net Worth"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={createAssetMutation.isPending || updateAssetMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="asset-form"
              disabled={createAssetMutation.isPending || updateAssetMutation.isPending}
            >
              {editingAsset ? "Simpan Perubahan" : "Simpan Aset"}
            </Button>
          </div>
        }
      >
        <form id="asset-form" onSubmit={handleSaveForm} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="asset-name-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Nama Aset <span className="text-[var(--destructive)]">*</span>
            </label>
            <input
              id="asset-name-input"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Contoh: Emas Antam, Saham BBCA"
              className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="asset-cat-select"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Kategori Utama
              </label>
              <select
                id="asset-cat-select"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as AssetCategory)}
                className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              >
                <option value="investment">Aset Investasi (Liquid/Growth)</option>
                <option value="fixed">Aset Fisik (Tetap/Produktif)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="asset-type-select"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Tipe Aset
              </label>
              <select
                id="asset-type-select"
                value={formType}
                onChange={(e) => setFormType(e.target.value as AssetType)}
                className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              >
                {Object.entries(ASSET_TYPE_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="asset-val-input"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Nilai Taksiran Sekarang <span className="text-[var(--destructive)]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                  Rp
                </span>
                <input
                  id="asset-val-input"
                  type="text"
                  required
                  inputMode="numeric"
                  value={formValuation}
                  onChange={(e) => setFormValuation(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 font-mono text-sm font-bold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="asset-cost-input"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Modal Beli Awal (Opsional)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                  Rp
                </span>
                <input
                  id="asset-cost-input"
                  type="text"
                  inputMode="numeric"
                  value={formCost}
                  onChange={(e) => setFormCost(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 font-mono text-sm font-bold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="asset-notes-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Catatan Tambahan (Opsional)
            </label>
            <input
              id="asset-notes-input"
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Contoh: Portofolio Bibit, BPKB lengkap"
              className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>
        </form>
      </ModalSheet>

      {/* Modal Quick Valuation Update (Re-quote) */}
      <ModalSheet
        open={valuationModalAsset !== null}
        onClose={() => setValuationModalAsset(null)}
        title="Perbarui Nilai Taksiran Aset"
        subtitle={
          valuationModalAsset
            ? `Taksiran harga pasar terkini untuk "${valuationModalAsset.name}"`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setValuationModalAsset(null)}
              disabled={updateAssetMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="asset-quick-val-form"
              disabled={updateAssetMutation.isPending}
            >
              Perbarui Valuasi
            </Button>
          </div>
        }
      >
        <form id="asset-quick-val-form" onSubmit={handleSaveQuickValuation} className="space-y-4">
          {quickValuationError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{quickValuationError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="quick-val-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Nilai Taksiran Terkini (Rupiah)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="quick-val-input"
                type="text"
                required
                inputMode="numeric"
                value={quickValuationInput}
                onChange={(e) => setQuickValuationInput(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 font-mono text-base font-black text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              />
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Nilai pasar wajar aset saat ini. Perubahan akan langsung mengkalkulasi ulang total Net
              Worth Anda.
            </p>
          </div>
        </form>
      </ModalSheet>

      {/* Modal Konfirmasi Hapus Aset */}
      <ModalSheet
        open={deletingAsset !== null}
        onClose={() => setDeletingAsset(null)}
        title="Hapus Aset?"
        subtitle={deletingAsset ? `Konfirmasi penghapusan aset "${deletingAsset.name}"` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeletingAsset(null)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteAssetMutation.isPending}
              onClick={() => {
                if (deletingAsset) {
                  deleteAssetMutation.mutate(deletingAsset.id);
                }
              }}
            >
              Hapus Aset
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--foreground)]">
            Apakah Anda yakin ingin menghapus data aset <strong>{deletingAsset?.name}</strong>{" "}
            senilai{" "}
            <strong>
              {deletingAsset ? formatRupiah(deletingAsset.valuationAmount, isMasked) : ""}
            </strong>
            ?
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Tindakan ini permanen dan akan mengurangi total kekayaan bersih Anda.
          </p>
        </div>
      </ModalSheet>
    </div>
  );
}
