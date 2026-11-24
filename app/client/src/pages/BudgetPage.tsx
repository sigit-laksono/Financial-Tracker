import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type BudgetCategorySummary } from "../lib/api";
import { formatDigitsInput, formatRupiah, parsePositiveInt } from "../lib/format";
import { budgetKeys, dashboardKeys } from "../lib/queryKeys";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import {
  AlertIcon,
  BudgetIcon,
  CheckIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
} from "../components/Icons";
import { Badge, Button, Card, ModalSheet, StateView } from "../components/UI";
import type { CategoryBucket } from "../../../shared/src/dtos";

const COLOR_PRESETS = [
  "#00797a",
  "#009267",
  "#38bdf8",
  "#ff8a00",
  "#eab308",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#64748b",
];

export function BudgetPage({ onToast }: { onToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();

  // Inline limit edit state
  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [editLimitInput, setEditLimitInput] = useState("");
  const [formError, setFormError] = useState("");

  // Bucket top-level limit edit state
  const [editingBucket, setEditingBucket] = useState<CategoryBucket | null>(null);
  const [bucketLimitInput, setBucketLimitInput] = useState("");

  // Modal Category Add/Edit state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BudgetCategorySummary | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalBucket, setModalBucket] = useState<CategoryBucket>("needs");
  const [modalColor, setModalColor] = useState("#00797a");
  const [modalLimit, setModalLimit] = useState("");
  const [modalError, setModalError] = useState("");

  // Delete category confirmation state
  const [deletingCategory, setDeletingCategory] = useState<BudgetCategorySummary | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: budgetKeys.summary(),
    queryFn: () => api.getBudgetSummary(),
  });

  const saveBudgetMutation = useMutation({
    mutationFn: async ({ category, limitAmount }: { category: string; limitAmount: number }) => {
      return api.upsertBudget({
        category,
        period: "default",
        limitAmount,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      setEditingCatName(null);
      setEditLimitInput("");
      onToast("Anggaran bulanan berhasil diperbarui");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyimpan batas anggaran.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      bucket: CategoryBucket;
      color: string;
      budgetLimit?: number;
    }) => {
      return api.createCategory({
        name: payload.name,
        type: "expense",
        bucket: payload.bucket,
        color: payload.color,
        isMandatory: false,
        budgetLimit: payload.budgetLimit,
      });
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      setCategoryModalOpen(false);
      onToast(`Kategori "${variables.name}" berhasil ditambahkan`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambahkan kategori.";
      setModalError(msg);
      onToast(msg);
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        name?: string;
        bucket?: CategoryBucket;
        color?: string;
        budgetLimit?: number;
      };
    }) => {
      return api.updateCategory(id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      setCategoryModalOpen(false);
      setEditingCategory(null);
      onToast("Kategori berhasil diperbarui");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal memperbarui kategori.";
      setModalError(msg);
      onToast(msg);
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.deleteCategory(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      const deletedName = deletingCategory?.categoryName ?? "Kategori";
      setDeletingCategory(null);
      onToast(`${deletedName} berhasil dihapus`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menghapus kategori.";
      setDeletingCategory(null);
      onToast(msg);
    },
  });

  if (isLoading) {
    return (
      <StateView
        kind="loading"
        title="Memuat data budgeting..."
        description="Menghitung alokasi pendapatan dan realisasi belanja bulanan."
      />
    );
  }

  if (error || !data) {
    return (
      <StateView
        kind="error"
        title="Gagal memuat budgeting"
        description={error instanceof Error ? error.message : "Terjadi kesalahan saat memuat data."}
        actionLabel="Coba Lagi"
        onAction={() => refetch()}
      />
    );
  }

  const { estimatedIncome, unallocated, needs, wants, savings } = data;
  const unallocatedPercent =
    estimatedIncome > 0
      ? Math.max(0, Math.round((unallocated / estimatedIncome) * 100))
      : 0;
  const overAllocated = Math.abs(Math.min(0, unallocated));
  const overAllocatedPercent =
    estimatedIncome > 0 ? Math.round((overAllocated / estimatedIncome) * 100) : 0;

  const handleStartInlineEdit = (cat: BudgetCategorySummary) => {
    setEditingCatName(cat.categoryName);
    setEditLimitInput(cat.budgetLimit > 0 ? cat.budgetLimit.toLocaleString("id-ID") : "");
    setFormError("");
  };

  const handleSaveInlineEdit = (categoryName: string) => {
    const limitAmount = parsePositiveInt(editLimitInput);
    if (limitAmount <= 0) {
      setFormError("Nominal anggaran harus lebih dari Rp 0.");
      return;
    }
    saveBudgetMutation.mutate({ category: categoryName, limitAmount });
  };

  const openCreateModal = (bucket: CategoryBucket) => {
    setEditingCategory(null);
    setModalName("");
    setModalBucket(bucket);
    setModalColor(bucket === "needs" ? "#38bdf8" : bucket === "wants" ? "#ff8a00" : "#009267");
    setModalLimit("");
    setModalError("");
    setCategoryModalOpen(true);
  };

  const openEditModal = (cat: BudgetCategorySummary) => {
    setEditingCategory(cat);
    setModalName(cat.categoryName);
    setModalBucket(cat.bucket);
    setModalColor(cat.color || "#00797a");
    setModalLimit(cat.budgetLimit > 0 ? cat.budgetLimit.toLocaleString("id-ID") : "");
    setModalError("");
    setCategoryModalOpen(true);
  };

  const handleSaveCategoryModal = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = modalName.trim();
    if (!trimmedName) {
      setModalError("Nama kategori wajib diisi.");
      return;
    }

    const limitAmount = modalLimit ? parsePositiveInt(modalLimit) : 0;

    if (editingCategory) {
      updateCategoryMutation.mutate({
        id: editingCategory.categoryId,
        payload: {
          name: trimmedName,
          bucket: modalBucket,
          color: modalColor,
          budgetLimit: limitAmount,
        },
      });
    } else {
      createCategoryMutation.mutate({
        name: trimmedName,
        bucket: modalBucket,
        color: modalColor,
        budgetLimit: limitAmount,
      });
    }
  };

  const handleStartBucketEdit = (bucketKey: CategoryBucket, currentAllocated: number) => {
    setEditingBucket(bucketKey);
    setBucketLimitInput(currentAllocated > 0 ? currentAllocated.toLocaleString("id-ID") : "");
    setFormError("");
  };

  const handleSaveBucketEdit = (bucketKey: CategoryBucket) => {
    const parsed = parsePositiveInt(bucketLimitInput);
    if (parsed <= 0) {
      setFormError("Jatah anggaran harus lebih dari Rp 0.");
      return;
    }
    saveBudgetMutation.mutate({
      category: `bucket:${bucketKey}`,
      limitAmount: parsed,
    });
    setEditingBucket(null);
    setBucketLimitInput("");
  };

  const renderBucketSection = (
    title: string,
    bucketKey: CategoryBucket,
    allocated: number,
    allocatedPercent: number,
    spent: number,
    categories: BudgetCategorySummary[],
    accentColor: string,
  ) => {
    const isEditingThisBucket = editingBucket === bucketKey;
    const percentUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
    const remaining = Math.max(0, allocated - spent);
    const isOver = allocated > 0 && spent > allocated;
    const isWarning = allocated > 0 && spent >= allocated * 0.8 && !isOver;

    return (
      <Card className="space-y-5 p-5 sm:p-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-black text-[var(--foreground)]">{title}</h2>
            {allocated > 0 && (
              <Badge tone="neutral" className="text-xs font-bold">
                Jatah: {allocatedPercent}% dari Pemasukan
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => openCreateModal(bucketKey)}
              className="min-h-[40px] px-3 text-xs font-bold gap-1.5"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>Tambah Kategori</span>
            </Button>
          </div>
        </div>

        {/* Hero Jatah Anggaran Kelompok */}
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4">
          {isEditingThisBucket ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                  Atur Jatah Anggaran {title}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  Bebas tentukan jatah anggaran sesuai kebutuhan Anda
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--muted-foreground)]">
                    Rp
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bucketLimitInput}
                    onChange={(e) => setBucketLimitInput(formatDigitsInput(e.target.value))}
                    placeholder="Contoh: 3.000.000"
                    className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--primary)] bg-[var(--card)] pl-9 pr-3 text-sm font-bold text-[var(--foreground)]"
                    autoFocus
                  />
                </div>
                <Button
                  onClick={() => handleSaveBucketEdit(bucketKey)}
                  disabled={saveBudgetMutation.isPending}
                  className="min-h-[44px] text-xs px-4"
                >
                  Simpan Jatah
                </Button>
                {allocated > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      saveBudgetMutation.mutate({
                        category: `bucket:${bucketKey}`,
                        limitAmount: 0,
                      });
                      setEditingBucket(null);
                      setBucketLimitInput("");
                    }}
                    disabled={saveBudgetMutation.isPending}
                    className="min-h-[44px] text-xs px-3 text-[var(--destructive)]"
                    title="Kosongkan jatah anggaran ini"
                  >
                    Reset Jatah
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setEditingBucket(null)}
                  className="min-h-[44px] text-xs px-3"
                >
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Jatah Anggaran Kelompok Ini
                  </span>
                  <div className="flex items-baseline gap-2.5 mt-0.5">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-[var(--foreground)] tabular-nums">
                      {allocated > 0 ? formatRupiah(allocated, isMasked) : "Belum Diatur"}
                    </span>
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                      ({allocatedPercent}% dari pendapatan)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                      allocated === 0
                        ? "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
                        : isOver
                          ? "border-[var(--destructive)]/30 bg-[var(--destructive)]/15 text-[var(--destructive)]"
                          : isWarning
                            ? "border-[var(--highlight)]/30 bg-[var(--highlight)]/15 text-[var(--highlight-text)]"
                            : "border-[var(--chart-income)]/30 bg-[var(--chart-income)]/15 text-[var(--chart-income)]"
                    }`}
                  >
                    {allocated === 0
                      ? "Jatah Belum Diatur"
                      : isOver
                        ? `Defisit ${formatRupiah(spent - allocated, isMasked)}`
                        : isWarning
                          ? `Mendekati Jatah (${percentUsed}%)`
                          : `Terkendali (${percentUsed}% Terpakai)`}
                  </span>

                  <Button
                    variant="secondary"
                    onClick={() => handleStartBucketEdit(bucketKey, allocated)}
                    className="min-h-[38px] text-xs px-3 font-semibold"
                  >
                    {allocated > 0 ? "Ubah Jatah" : "Atur Jatah"}
                  </Button>
                </div>
              </div>

              {/* Master Progress Bar */}
              {allocated > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="h-3 w-full rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isOver
                          ? "bg-[var(--destructive)]"
                          : isWarning
                            ? "bg-amber-500"
                            : "bg-[var(--primary)]"
                      }`}
                      style={{ width: `${Math.min(100, percentUsed)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-medium text-[var(--muted-foreground)] font-mono">
                    <span>Terpakai: {formatRupiah(spent, isMasked)}</span>
                    <span>
                      {isOver
                        ? `Melebihi jatah: +${formatRupiah(spent - allocated, isMasked)}`
                        : `Sisa Jatah: ${formatRupiah(remaining, isMasked)}`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Categories Section: Aliran Pengeluaran Riil */}
        <div className="space-y-3 pt-2">
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--foreground)]">
              Distribusi Pengeluaran Riil
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Cukup-cukupkan di dalam kelompok ini. Yang terpenting total pengeluaran tidak melebihi jatah anggaran di atas.
            </p>
          </div>

          {categories.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] p-6 text-center space-y-2 bg-[var(--surface)]/50">
              <p className="text-xs text-[var(--muted-foreground)]">
                Belum ada kategori pengeluaran di kelompok {title}.
              </p>
              <Button
                variant="secondary"
                onClick={() => openCreateModal(bucketKey)}
                className="min-h-[40px] px-3.5 text-xs font-semibold"
              >
                <PlusIcon className="w-3.5 h-3.5 mr-1" />
                Tambah Kategori
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {categories.map((c) => {
                const sharePercent = spent > 0 ? Math.round((c.actualSpent / spent) * 100) : 0;
                return (
                  <div
                    key={c.categoryId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 py-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full shrink-0 shadow-xs"
                          style={{ backgroundColor: c.color }}
                          aria-hidden="true"
                        />
                        <strong className="text-sm font-bold text-[var(--foreground)] truncate">
                          {c.categoryName}
                        </strong>
                        {c.actualSpent > 0 && (
                          <span className="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)] border border-[var(--border)]">
                            {sharePercent}% dari {title.split(" ")[0]}
                          </span>
                        )}
                      </div>

                      {/* Mini Share Distribution Bar */}
                      {spent > 0 && (
                        <div className="space-y-0.5 max-w-sm">
                          <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${sharePercent}%`,
                                backgroundColor: c.color || accentColor,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] block">
                          Terpakai
                        </span>
                        <span className="font-mono text-sm font-extrabold text-[var(--foreground)] tabular-nums">
                          {formatRupiah(c.actualSpent, isMasked)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(c)}
                          title="Edit nama / kelompok / warna kategori"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <EditIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingCategory(c)}
                          title="Hapus kategori ini"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--muted-foreground)] hover:bg-rose-50 hover:text-[var(--destructive)] dark:hover:bg-rose-950/30 transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Alokasi Anggaran</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Kelola jatah anggaran kustom per variabel utama untuk mengendalikan pengeluaran bulanan secara terencana.
          </p>
        </div>
      </div>

      {/* Zero-Based Budgeting Hero Banner */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <BudgetIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Alokasi Anggaran Kustom</span>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(estimatedIncome, isMasked)}
              </p>
            </div>
            <p className="text-xs sm:text-sm text-[var(--hero-card-muted)] max-w-md">
              Estimasi pendapatan bulanan yang siap dialokasikan ke pos Kebutuhan, Keinginan, dan
              Tabungan hingga sisa Rp 0.
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2">
            <div className="rounded-[14px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-4 text-left sm:text-right">
              <span className="text-xs font-semibold text-[var(--hero-card-muted)]">
                {unallocated >= 0 ? "Sisa Dana Belum Dialokasikan:" : "Kelebihan Alokasi Budget:"}
              </span>
              <p
                className={`font-mono text-2xl font-black tabular-nums ${
                  unallocated === 0
                    ? "text-[var(--chart-income)]"
                    : unallocated > 0
                      ? "text-[var(--primary)]"
                      : "text-[var(--destructive)]"
                }`}
              >
                {formatRupiah(Math.abs(unallocated), isMasked)}
              </p>
              <span className="text-[11px] text-[var(--hero-card-muted)]">
                {unallocated === 0
                  ? "Sempurna! Setiap Rupiah pendapatan memiliki tujuan."
                  : unallocated > 0
                    ? "Tugaskan ke tabungan atau pos belanja agar genap."
                    : "Pagu melebihi pemasukan bulanan, kurangi batas."}
              </span>
            </div>
          </div>
        </div>

        {/* Komposisi Anggaran Visual Bar */}
        <div className="mt-6 border-t border-[var(--hero-border)] pt-4 space-y-3">
          {/* Progress Bar with Tooltips & Segment Gap */}
          <div className="h-4 w-full rounded-full bg-[var(--surface)] overflow-hidden flex border border-[var(--border)] p-0.5 gap-0.5 shadow-inner">
            {needs.allocatedPercent > 0 && (
              <div
                className="bg-[#38bdf8] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, needs.allocatedPercent)}%` }}
                title={`Kebutuhan: ${needs.allocatedPercent}% (${formatRupiah(needs.allocated, isMasked)})`}
              />
            )}
            {wants.allocatedPercent > 0 && (
              <div
                className="bg-[#fb923c] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, wants.allocatedPercent)}%` }}
                title={`Keinginan: ${wants.allocatedPercent}% (${formatRupiah(wants.allocated, isMasked)})`}
              />
            )}
            {savings.allocatedPercent > 0 && (
              <div
                className="bg-[#4ade80] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, savings.allocatedPercent)}%` }}
                title={`Tabungan & Hutang: ${savings.allocatedPercent}% (${formatRupiah(savings.allocated, isMasked)})`}
              />
            )}
            {unallocated > 0 && (
              <div
                className="bg-neutral-200 dark:bg-neutral-700/70 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, unallocatedPercent)}%` }}
                title={`Belum Dialokasikan: ${unallocatedPercent}% (${formatRupiah(unallocated, isMasked)})`}
              />
            )}
          </div>

          {/* Legend Items dengan Indikator Warna, Persen & Nominal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs pt-1">
            {/* 1. Kebutuhan */}
            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] shrink-0" />
                <span className="text-[#0284c7] dark:text-[#38bdf8] font-bold">
                  Kebutuhan:
                </span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {needs.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(needs.allocated, isMasked)})
              </span>
            </div>

            {/* 2. Keinginan */}
            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#fb923c] shrink-0" />
                <span className="text-[#ea580c] dark:text-[#fb923c] font-bold">
                  Keinginan:
                </span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {wants.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(wants.allocated, isMasked)})
              </span>
            </div>

            {/* 3. Tabungan & Hutang */}
            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#4ade80] shrink-0" />
                <span className="text-[#16a34a] dark:text-[#4ade80] font-bold">
                  Tabungan & Hutang:
                </span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {savings.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(savings.allocated, isMasked)})
              </span>
            </div>

            {/* 4. Belum Dialokasikan / Kelebihan Alokasi */}
            {unallocated > 0 ? (
              <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 dark:bg-neutral-600 shrink-0" />
                  <span className="text-neutral-500 dark:text-neutral-400 font-bold">
                    Belum Dialokasikan:
                  </span>
                  <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                    {unallocatedPercent}%
                  </span>
                </div>
                <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                  ({formatRupiah(unallocated, isMasked)})
                </span>
              </div>
            ) : unallocated < 0 ? (
              <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--destructive)] shrink-0" />
                  <span className="text-[var(--destructive)] font-bold">
                    Kelebihan Alokasi:
                  </span>
                  <span className="font-mono font-bold text-[var(--destructive)] tabular-nums">
                    +{overAllocatedPercent}%
                  </span>
                </div>
                <span className="text-[11px] text-[var(--destructive)] tabular-nums font-mono">
                  ({formatRupiah(overAllocated, isMasked)})
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--chart-income)] shrink-0" />
                <span className="text-[var(--chart-income)] font-bold">
                  Teralokasi 100% (Rp 0 Sisa)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[10px] border border-[var(--destructive)] bg-[var(--surface)] p-3 text-xs text-[var(--destructive)]"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* 3 Main Envelopes */}
      <div className="space-y-6">
        {renderBucketSection(
          "Kebutuhan Hidup (Needs)",
          "needs",
          needs.allocated,
          needs.allocatedPercent,
          needs.spent,
          needs.categories,
          "#38bdf8",
        )}

        {renderBucketSection(
          "Keinginan & Gaya Hidup (Wants)",
          "wants",
          wants.allocated,
          wants.allocatedPercent,
          wants.spent,
          wants.categories,
          "#fb923c",
        )}

        {renderBucketSection(
          "Tabungan & Hutang (Savings & Debt)",
          "savings",
          savings.allocated,
          savings.allocatedPercent,
          savings.spent,
          savings.categories,
          "#4ade80",
        )}
      </div>

      {/* Modal Tambah / Edit Kategori */}
      <ModalSheet
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? "Edit Kategori" : "Tambah Kategori Baru"}
        subtitle="Kelola pos pengeluaran sesuai kelompok variabel utama"
      >
        <form onSubmit={handleSaveCategoryModal} className="space-y-4">
          {modalError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{modalError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="cat-name-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Nama Kategori <span className="text-[var(--destructive)]">*</span>
            </label>
            <input
              id="cat-name-input"
              type="text"
              required
              value={modalName}
              onChange={(e) => setModalName(e.target.value)}
              placeholder="Contoh: Kopi & Nongkrong, Gym, Asuransi"
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="cat-bucket-select"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Kelompok Anggaran (Variabel Utama)
            </label>
            <select
              id="cat-bucket-select"
              value={modalBucket}
              onChange={(e) => setModalBucket(e.target.value as CategoryBucket)}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            >
              <option value="needs">Kebutuhan Hidup (Needs)</option>
              <option value="wants">Keinginan & Gaya Hidup (Wants)</option>
              <option value="savings">Tabungan & Hutang (Savings & Debt)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="cat-limit-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Pagu Anggaran Bulanan (Opsional)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
                Rp
              </span>
              <input
                id="cat-limit-input"
                type="text"
                inputMode="numeric"
                value={modalLimit}
                onChange={(e) => setModalLimit(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 font-mono text-sm font-bold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
            </div>
            <p className="text-[11px] text-neutral-400">
              Batas belanja yang direncanakan per siklus untuk kategori ini.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">Warna Penanda</span>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {COLOR_PRESETS.map((color) => {
                const isSelected = modalColor.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setModalColor(color)}
                    className={`h-7 w-7 rounded-full transition-transform ${
                      isSelected
                        ? "scale-110 ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--card)]"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Pilih warna ${color}`}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setCategoryModalOpen(false)}
              className="inline-flex min-h-[44px] items-center px-4 py-2.5 rounded-[14px] text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
              className="min-h-[44px] px-6 py-3 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
            >
              {editingCategory ? "Simpan Perubahan" : "Tambah Kategori"}
            </button>
          </div>
        </form>
      </ModalSheet>

      {/* Modal Konfirmasi Hapus Kategori */}
      <ModalSheet
        open={deletingCategory !== null}
        onClose={() => setDeletingCategory(null)}
        title="Hapus Kategori?"
        subtitle={
          deletingCategory
            ? `Konfirmasi penghapusan kategori "${deletingCategory.categoryName}"`
            : undefined
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--foreground)]">
            Apakah Anda yakin ingin menghapus kategori{" "}
            <strong>{deletingCategory?.categoryName}</strong>? Pagu anggaran kategori ini akan
            otomatis dibersihkan.
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Catatan: Kategori yang sudah memiliki riwayat transaksi tidak dapat dihapus sebelum
            kategorinya diubah.
          </p>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <Button type="button" variant="ghost" onClick={() => setDeletingCategory(null)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteCategoryMutation.isPending}
              onClick={() => {
                if (deletingCategory) {
                  deleteCategoryMutation.mutate(deletingCategory.categoryId);
                }
              }}
            >
              Hapus Kategori
            </Button>
          </div>
        </div>
      </ModalSheet>
    </div>
  );
}
