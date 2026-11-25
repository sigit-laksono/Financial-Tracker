import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CategoryBucket } from "../../../shared/src/dtos";
import {
  AlertIcon,
  BudgetIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
} from "../components/Icons";
import { Badge, Button, Card, ModalSheet, StateView } from "../components/UI";
import { api, ApiError, type BudgetCategorySummary, type CategoryDto } from "../lib/api";
import {
  formatDigitsInput,
  formatMonthTitle,
  formatPeriodRangeLabel,
  formatRupiah,
  MAX_IDR_AMOUNT,
  parsePositiveInt,
  shiftMonth,
} from "../lib/format";
import { budgetKeys, dashboardKeys, goalKeys, transactionKeys } from "../lib/queryKeys";
import { usePrivacyMode } from "../lib/usePrivacyMode";

type BucketFilterTab = "all" | CategoryBucket;
type IncomeArchiveTab = "income" | "archived";

const BUCKET_SHORT_LABELS: Record<CategoryBucket, string> = {
  needs: "Needs",
  wants: "Wants",
  savings: "Savings",
};

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

export function BudgetPage({
  period,
  onPeriodChange,
  onToast,
}: {
  period: string;
  onPeriodChange: (nextPeriod: string) => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();

  // Bucket filter & accordion for unconfigured Rp 0 categories
  const [activeBucketTab, setActiveBucketTab] = useState<BucketFilterTab>("all");
  const [showZeroByBucket, setShowZeroByBucket] = useState<Record<CategoryBucket, boolean>>({
    needs: false,
    wants: false,
    savings: false,
  });

  // Bucket top-level limit edit state
  const [editingBucket, setEditingBucket] = useState<CategoryBucket | null>(null);
  const [bucketLimitInput, setBucketLimitInput] = useState("");
  const [formError, setFormError] = useState("");

  // Quick inline category budget edit state
  const [editingCategoryBudgetId, setEditingCategoryBudgetId] = useState<number | null>(null);
  const [categoryBudgetInput, setCategoryBudgetInput] = useState("");
  const [categoryBudgetError, setCategoryBudgetError] = useState("");

  // Modal Category Add/Edit state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BudgetCategorySummary | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalBucket, setModalBucket] = useState<CategoryBucket>("needs");
  const [modalColor, setModalColor] = useState("#00797a");
  const [modalLimit, setModalLimit] = useState("");
  const [modalIsMandatory, setModalIsMandatory] = useState(false);
  const [modalError, setModalError] = useState("");

  // Delete category confirmation state
  const [deletingCategory, setDeletingCategory] = useState<BudgetCategorySummary | null>(null);

  // Income & Archive Category Management Modal state
  const [incomeArchiveModalOpen, setIncomeArchiveModalOpen] = useState(false);
  const [incomeArchiveTab, setIncomeArchiveTab] = useState<IncomeArchiveTab>("income");
  const [newIncomeName, setNewIncomeName] = useState("");
  const [newIncomeError, setNewIncomeError] = useState("");
  const [editingIncomeId, setEditingIncomeId] = useState<number | null>(null);
  const [editingIncomeName, setEditingIncomeName] = useState("");
  const [confirmDeleteArchivedId, setConfirmDeleteArchivedId] = useState<number | null>(null);
  const [manageModalError, setManageModalError] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: budgetKeys.summary(period),
    queryFn: () => api.getBudgetSummary(period),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.getCategories(),
  });

  const allCategories = categoriesData?.categories ?? [];

  const categoryMandatoryMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const cat of allCategories) {
      map.set(cat.id, cat.isMandatory);
    }
    return map;
  }, [allCategories]);

  const incomeCategories = useMemo(
    () => allCategories.filter((cat) => cat.type === "income" && !cat.isArchived),
    [allCategories],
  );

  const archivedCategories = useMemo(
    () => allCategories.filter((cat) => cat.isArchived),
    [allCategories],
  );

  const invalidateCategoryQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
    await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    await queryClient.invalidateQueries({ queryKey: ["categories"] });
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    // Category rename/archive also rewrites transactions, splits and recurring rules on the server.
    await queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
    await queryClient.invalidateQueries({ queryKey: goalKeys.all });
  };

  const saveBudgetMutation = useMutation({
    mutationFn: async ({ category, limitAmount }: { category: string; limitAmount: number }) => {
      return api.upsertBudget({
        category,
        period,
        limitAmount,
      });
    },
    onSuccess: async () => {
      await invalidateCategoryQueries();
      onToast("Anggaran siklus berhasil diperbarui");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyimpan batas anggaran.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const copyPreviousMutation = useMutation({
    mutationFn: () => api.copyPreviousBudgets(period),
    onSuccess: async (res) => {
      await invalidateCategoryQueries();
      if (res.copiedCount > 0) {
        onToast(`${res.copiedCount} budget kategori disalin dari siklus sebelumnya`);
      } else {
        onToast("Belum ada budget kategori di siklus sebelumnya");
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyalin budget siklus lalu.";
      onToast(msg);
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      bucket: CategoryBucket;
      color: string;
      isMandatory: boolean;
      budgetLimit?: number;
    }) => {
      return api.createCategory({
        name: payload.name,
        type: "expense",
        bucket: payload.bucket,
        color: payload.color,
        isMandatory: payload.isMandatory,
        budgetLimit: payload.budgetLimit,
        period,
      });
    },
    onSuccess: async (_, variables) => {
      await invalidateCategoryQueries();
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
        isMandatory?: boolean;
        budgetLimit?: number;
        period?: string;
      };
    }) => {
      return api.updateCategory(id, payload);
    },
    onSuccess: async () => {
      await invalidateCategoryQueries();
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
      await invalidateCategoryQueries();
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

  const createIncomeCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      return api.createCategory({
        name,
        type: "income",
        color: "#009267",
      });
    },
    onSuccess: async (_, name) => {
      await invalidateCategoryQueries();
      setNewIncomeName("");
      setNewIncomeError("");
      setManageModalError("");
      onToast(`Kategori pemasukan "${name}" berhasil ditambahkan`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambahkan kategori pemasukan.";
      setNewIncomeError(msg);
      onToast(msg);
    },
  });

  const manageCategoryMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: Parameters<typeof api.updateCategory>[1];
      successMessage: string;
    }) => {
      return api.updateCategory(id, payload);
    },
    onSuccess: async (_, variables) => {
      await invalidateCategoryQueries();
      setEditingIncomeId(null);
      setEditingIncomeName("");
      setManageModalError("");
      onToast(variables.successMessage);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal memperbarui kategori.";
      setManageModalError(msg);
      onToast(msg);
    },
  });

  const deleteArchivedCategoryMutation = useMutation({
    mutationFn: async ({ id }: { id: number; name: string }) => {
      return api.deleteCategory(id);
    },
    onSuccess: async (_, variables) => {
      await invalidateCategoryQueries();
      setConfirmDeleteArchivedId(null);
      setManageModalError("");
      onToast(`Kategori "${variables.name}" berhasil dihapus`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menghapus kategori.";
      setConfirmDeleteArchivedId(null);
      setManageModalError(msg);
      onToast(msg);
    },
  });

  if (isLoading) {
    return (
      <StateView
        kind="loading"
        title="Memuat data budgeting..."
        description="Menghitung total dana likuid dan alokasi anggaran siklus."
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

  const isCurrentPeriod = data.isCurrentPeriod ?? true;
  const baselineFund = data.totalLiquidCash ?? data.estimatedIncome;
  const { unallocated, needs, wants, savings } = data;
  const unallocatedPercent =
    baselineFund > 0 ? Math.max(0, Math.round((unallocated / baselineFund) * 100)) : 0;
  const overAllocated = Math.abs(Math.min(0, unallocated));
  const overAllocatedPercent =
    baselineFund > 0 ? Math.round((overAllocated / baselineFund) * 100) : 0;

  const openIncomeArchiveModal = () => {
    setIncomeArchiveTab("income");
    setNewIncomeName("");
    setNewIncomeError("");
    setEditingIncomeId(null);
    setEditingIncomeName("");
    setConfirmDeleteArchivedId(null);
    setManageModalError("");
    setIncomeArchiveModalOpen(true);
  };

  const handleAddIncomeCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newIncomeName.trim();
    if (!trimmed) {
      setNewIncomeError("Nama kategori pemasukan wajib diisi.");
      return;
    }
    setNewIncomeError("");
    createIncomeCategoryMutation.mutate(trimmed);
  };

  const startEditIncomeCategory = (cat: CategoryDto) => {
    setEditingIncomeId(cat.id);
    setEditingIncomeName(cat.name);
    setManageModalError("");
  };

  const handleSaveIncomeEdit = (cat: CategoryDto) => {
    const trimmed = editingIncomeName.trim();
    if (!trimmed) {
      setManageModalError("Nama kategori tidak boleh kosong.");
      return;
    }
    manageCategoryMutation.mutate({
      id: cat.id,
      payload: { name: trimmed },
      successMessage: `Kategori "${trimmed}" berhasil diperbarui`,
    });
  };

  const openCreateModal = (bucket: CategoryBucket) => {
    setEditingCategory(null);
    setModalName("");
    setModalBucket(bucket);
    setModalColor(bucket === "needs" ? "#38bdf8" : bucket === "wants" ? "#ff8a00" : "#009267");
    setModalLimit("");
    setModalIsMandatory(false);
    setModalError("");
    setCategoryModalOpen(true);
  };

  const openEditModal = (cat: BudgetCategorySummary) => {
    setEditingCategory(cat);
    setModalName(cat.categoryName);
    setModalBucket(cat.bucket);
    setModalColor(cat.color || "#00797a");
    setModalLimit(cat.budgetLimit > 0 ? cat.budgetLimit.toLocaleString("id-ID") : "");
    setModalIsMandatory(categoryMandatoryMap.get(cat.categoryId) ?? false);
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
    if (limitAmount > MAX_IDR_AMOUNT) {
      setModalError(`Nominal pagu maksimal ${formatRupiah(MAX_IDR_AMOUNT)}.`);
      return;
    }

    if (editingCategory) {
      updateCategoryMutation.mutate({
        id: editingCategory.categoryId,
        payload: {
          name: trimmedName,
          bucket: modalBucket,
          color: modalColor,
          isMandatory: modalIsMandatory,
          budgetLimit: limitAmount,
          period,
        },
      });
    } else {
      createCategoryMutation.mutate({
        name: trimmedName,
        bucket: modalBucket,
        color: modalColor,
        isMandatory: modalIsMandatory,
        budgetLimit: limitAmount,
      });
    }
  };

  const handleStartBucketEdit = (
    bucketKey: CategoryBucket,
    allocated: number,
    remainingEnvelope: number,
  ) => {
    setEditingBucket(bucketKey);
    const initialVal = isCurrentPeriod
      ? allocated > 0
        ? remainingEnvelope
        : 0
      : allocated;
    setBucketLimitInput(initialVal > 0 ? initialVal.toLocaleString("id-ID") : "");
    setFormError("");
  };

  const handleSaveBucketEdit = (bucketKey: CategoryBucket, spent: number) => {
    const parsed = parsePositiveInt(bucketLimitInput);
    if (parsed <= 0) {
      setFormError("Jatah anggaran harus lebih dari Rp 0.");
      return;
    }
    const targetLimitAmount = isCurrentPeriod ? parsed + spent : parsed;
    if (targetLimitAmount > MAX_IDR_AMOUNT) {
      setFormError(`Total jatah anggaran maksimal ${formatRupiah(MAX_IDR_AMOUNT)}.`);
      return;
    }
    saveBudgetMutation.mutate({
      category: `bucket:${bucketKey}`,
      limitAmount: targetLimitAmount,
    });
    setEditingBucket(null);
    setBucketLimitInput("");
  };

  const handleStartCategoryBudgetEdit = (cat: BudgetCategorySummary) => {
    setEditingCategoryBudgetId(cat.categoryId);
    setCategoryBudgetInput(cat.budgetLimit > 0 ? cat.budgetLimit.toLocaleString("id-ID") : "");
    setCategoryBudgetError("");
  };

  const handleSaveCategoryBudgetEdit = (cat: BudgetCategorySummary) => {
    const trimmed = categoryBudgetInput.trim();
    const parsed = trimmed ? parsePositiveInt(trimmed) : 0;
    if (trimmed && parsed < 0) {
      setCategoryBudgetError("Nominal budget tidak valid.");
      return;
    }
    if (parsed > MAX_IDR_AMOUNT) {
      setCategoryBudgetError(`Nominal budget maksimal ${formatRupiah(MAX_IDR_AMOUNT)}.`);
      return;
    }
    if (parsed <= 0) {
      updateCategoryMutation.mutate(
        {
          id: cat.categoryId,
          payload: { budgetLimit: 0, period },
        },
        {
          onSuccess: () => {
            setEditingCategoryBudgetId(null);
            setCategoryBudgetInput("");
            setCategoryBudgetError("");
          },
          onError: (err) => {
            const msg = err instanceof ApiError ? err.message : "Gagal mengosongkan budget kategori.";
            setCategoryBudgetError(msg);
          },
        },
      );
      return;
    }
    saveBudgetMutation.mutate(
      {
        category: cat.categoryName,
        limitAmount: parsed,
      },
      {
        onSuccess: () => {
          setEditingCategoryBudgetId(null);
          setCategoryBudgetInput("");
          setCategoryBudgetError("");
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : "Gagal menyimpan budget kategori.";
          setCategoryBudgetError(msg);
        },
      },
    );
  };

  const periodRangeLabel =
    data.periodStart && data.periodEnd
      ? formatPeriodRangeLabel(data.periodStart, data.periodEnd)
      : formatMonthTitle(period);

  const renderBucketSection = (
    title: string,
    bucketKey: CategoryBucket,
    bucketData: {
      allocated: number;
      categoryAllocatedTotal: number;
      allocationSource: "manual" | "categories" | "none";
      remaining?: number;
      allocatedPercent: number;
      spent: number;
      categories: BudgetCategorySummary[];
    },
    accentColor: string,
  ) => {
    const { allocated, categoryAllocatedTotal, allocationSource, allocatedPercent, spent, categories } =
      bucketData;
    const envelopeRemaining =
      bucketData.remaining ?? (allocated > 0 ? Math.max(0, allocated - spent) : 0);
    const isEditingThisBucket = editingBucket === bucketKey;
    const percentUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
    const isOver = allocated > 0 && spent > allocated;
    const isWarning = allocated > 0 && spent >= allocated * 0.8 && !isOver;
    const headlineAmount = isCurrentPeriod ? envelopeRemaining : allocated;

    const configuredCategories = categories.filter(
      (c) => c.budgetLimit > 0 || c.actualSpent > 0,
    );
    const unconfiguredCategories = categories.filter(
      (c) => c.budgetLimit === 0 && c.actualSpent === 0,
    );
    const showZero = showZeroByBucket[bucketKey];
    const displayedCategories = showZero ? categories : configuredCategories;

    return (
      <Card className="space-y-5 p-5 sm:p-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-black text-[var(--foreground)]">{title}</h2>
            {allocated > 0 && (
              <Badge tone="neutral" className="text-xs font-bold">
                Porsi: {allocatedPercent}% dari Dana Likuid
              </Badge>
            )}
          </div>
        </div>

        {/* Hero Jatah Anggaran Kelompok */}
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4">
          {isEditingThisBucket ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                  {isCurrentPeriod
                    ? `Atur Sisa Amplop ${title} (dari Dana Likuid)`
                    : `Atur Jatah ${title} (${periodRangeLabel})`}
                </span>
                {isCurrentPeriod && spent > 0 && (
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Terpakai sebelumnya: <strong>{formatRupiah(spent, isMasked)}</strong>
                  </span>
                )}
              </div>
              {((isCurrentPeriod && spent > 0) ||
                (allocationSource === "manual" &&
                  categoryAllocatedTotal > 0 &&
                  allocated > categoryAllocatedTotal)) && (
                <div className="space-y-1 text-xs text-[var(--muted-foreground)]">
                  {isCurrentPeriod && spent > 0 && (
                    <p>
                      Nominal yang dimasukkan adalah sisa amplop mulai saat ini. Total budget
                      siklus otomatis dihitung sebagai input Anda + terpakai (
                      {formatRupiah(spent, isMasked)}).
                    </p>
                  )}
                  {allocationSource === "manual" && categoryAllocatedTotal > 0 && (
                    <p>
                      Total budget kategori di kelompok ini:{" "}
                      <strong className="text-[var(--foreground)]">
                        {formatRupiah(categoryAllocatedTotal, isMasked)}
                      </strong>
                      . Total budget kelompok minimal sebesar total kategori tersebut.
                    </p>
                  )}
                </div>
              )}
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
                    placeholder="Contoh: 2.000.000"
                    className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--primary)] bg-[var(--card)] pl-9 pr-3 text-sm font-bold text-[var(--foreground)]"
                  />
                </div>
                <Button
                  onClick={() => handleSaveBucketEdit(bucketKey, spent)}
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
                    title="Kosongkan jatah anggaran siklus ini"
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
              {unallocated > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const currentVal = parsePositiveInt(bucketLimitInput);
                      setBucketLimitInput((currentVal + unallocated).toLocaleString("id-ID"));
                    }}
                    className="min-h-[44px] inline-flex items-center text-xs font-bold text-[var(--primary)] hover:underline"
                  >
                    + Tambahkan seluruh sisa dana belum dialokasikan ({formatRupiah(unallocated, isMasked)})
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {isCurrentPeriod
                      ? "Sisa Amplop Tersedia (Dari Dana Likuid)"
                      : "Jatah Anggaran Siklus Ini"}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-2.5 mt-0.5">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-[var(--foreground)] tabular-nums">
                      {allocated > 0 ? formatRupiah(headlineAmount, isMasked) : "Belum Diatur"}
                    </span>
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                      ({allocatedPercent}% dari dana likuid)
                    </span>
                  </div>
                  {allocationSource === "categories" && (
                    <div className="mt-1.5">
                      <Badge tone="info" className="text-[11px] font-semibold">
                        Dihitung otomatis dari total budget kategori
                      </Badge>
                    </div>
                  )}
                  {allocationSource === "manual" && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone="neutral" className="text-[11px] font-semibold">
                        Jatah manual
                      </Badge>
                      {categoryAllocatedTotal > 0 && allocated > categoryAllocatedTotal && (
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          Total budget kategori {formatRupiah(categoryAllocatedTotal, isMasked)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {allocated > 0 && (
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                        isOver
                          ? "border-[var(--destructive)]/30 bg-[var(--destructive)]/15 text-[var(--destructive)]"
                          : isWarning
                            ? "border-[var(--highlight)]/30 bg-[var(--highlight)]/15 text-[var(--highlight-text)]"
                            : "border-[var(--chart-income)]/30 bg-[var(--chart-income)]/15 text-[var(--chart-income)]"
                      }`}
                    >
                      {isOver
                        ? `Defisit ${formatRupiah(spent - allocated, isMasked)}`
                        : isWarning
                          ? `Mendekati Batas (${percentUsed}%)`
                          : `Terkendali (${percentUsed}% Terpakai)`}
                    </span>
                  )}

                  <Button
                    variant="secondary"
                    onClick={() => handleStartBucketEdit(bucketKey, allocated, envelopeRemaining)}
                    className="min-h-[44px] text-xs px-3 font-semibold"
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
                  <div className="flex flex-wrap justify-between gap-2 text-xs font-medium text-[var(--muted-foreground)] font-mono">
                    <span>Terpakai siklus ini: {formatRupiah(spent, isMasked)}</span>
                    <span>
                      Total budget siklus: {formatRupiah(allocated, isMasked)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Categories Section: Aliran Pengeluaran Riil */}
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--foreground)]">
            Distribusi Pengeluaran Riil
          </h3>

          {categories.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] p-6 text-center space-y-2 bg-[var(--surface)]/50">
              <p className="text-xs text-[var(--muted-foreground)]">
                Belum ada kategori pengeluaran di kelompok {title}.
              </p>
              <Button
                variant="secondary"
                onClick={() => openCreateModal(bucketKey)}
                className="min-h-[44px] px-3.5 text-xs font-semibold"
              >
                <PlusIcon className="w-3.5 h-3.5 mr-1" />
                Tambah Kategori
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedCategories.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)]/50 px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  Semua kategori ({unconfiguredCategories.length}) pada kelompok ini belum memiliki
                  budget atau pengeluaran (Rp 0).
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {displayedCategories.map((c) => {
                    const sharePercent = spent > 0 ? Math.round((c.actualSpent / spent) * 100) : 0;
                    const isMandatory = categoryMandatoryMap.get(c.categoryId) ?? false;
                    const hasBudget = c.budgetLimit > 0;
                    const isEditingRowBudget = editingCategoryBudgetId === c.categoryId;
                    const barColor =
                      c.status === "exceeded"
                        ? "var(--destructive)"
                        : c.status === "warning"
                          ? "#f59e0b"
                          : c.color || accentColor;

                    return (
                      <div key={c.categoryId} className="py-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="h-3 w-3 rounded-full shrink-0 shadow-xs"
                                style={{ backgroundColor: c.color }}
                                aria-hidden="true"
                              />
                              <strong className="text-sm font-bold text-[var(--foreground)] truncate">
                                {c.categoryName}
                              </strong>
                              {isMandatory && (
                                <Badge tone="highlight" className="text-[10px]">
                                  Wajib
                                </Badge>
                              )}
                              {c.actualSpent > 0 && (
                                <span className="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)] border border-[var(--border)]">
                                  {sharePercent}% dari {title.split(" ")[0]}
                                </span>
                              )}
                              {!hasBudget && (
                                <span className="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)] border border-[var(--border)]">
                                  Belum dibudgetkan
                                </span>
                              )}
                            </div>

                            {hasBudget ? (
                              <div className="space-y-1 max-w-md">
                                <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${Math.min(100, c.percentUsed)}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono tabular-nums">
                                  <span className="text-[var(--muted-foreground)]">
                                    Terpakai{" "}
                                    <strong className="text-[var(--foreground)]">
                                      {formatRupiah(c.actualSpent, isMasked)}
                                    </strong>
                                  </span>
                                  <span className="text-[var(--muted-foreground)]">
                                    Budget{" "}
                                    <strong className="text-[var(--foreground)]">
                                      {formatRupiah(c.budgetLimit, isMasked)}
                                    </strong>
                                  </span>
                                  <span
                                    className={
                                      c.remaining < 0
                                        ? "font-bold text-[var(--destructive)]"
                                        : "font-bold text-[var(--chart-income)]"
                                    }
                                  >
                                    {c.remaining >= 0
                                      ? `Sisa ${formatRupiah(c.remaining, isMasked)}`
                                      : `Lebih ${formatRupiah(Math.abs(c.remaining), isMasked)}`}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              spent > 0 && (
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
                              )
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                            <div className="text-right mr-1">
                              <span className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] block">
                                Terpakai
                              </span>
                              <span className="font-mono text-sm font-extrabold text-[var(--foreground)] tabular-nums">
                                {formatRupiah(c.actualSpent, isMasked)}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                isEditingRowBudget
                                  ? setEditingCategoryBudgetId(null)
                                  : handleStartCategoryBudgetEdit(c)
                              }
                              className="inline-flex min-h-[44px] items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                            >
                              {hasBudget ? "Ubah Budget" : "Atur Budget"}
                            </button>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(c)}
                                title="Edit nama / kelompok / warna kategori"
                                aria-label={`Edit kategori ${c.categoryName}`}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
                              >
                                <EditIcon className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingCategory(c)}
                                title="Hapus kategori ini"
                                aria-label={`Hapus kategori ${c.categoryName}`}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-[var(--muted-foreground)] hover:bg-rose-50 hover:text-[var(--destructive)] dark:hover:bg-rose-950/30 transition-colors"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {isEditingRowBudget && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSaveCategoryBudgetEdit(c);
                            }}
                            className="mt-2.5 flex flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center"
                          >
                            <div className="relative flex-1 min-w-[180px]">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--muted-foreground)]">
                                Rp
                              </span>
                              <input
                                type="text"
                                inputMode="numeric"
                                aria-label={`Budget kategori ${c.categoryName}`}
                                value={categoryBudgetInput}
                                onChange={(e) => {
                                  setCategoryBudgetInput(formatDigitsInput(e.target.value));
                                  setCategoryBudgetError("");
                                }}
                                placeholder="0 untuk kosongkan"
                                className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--primary)] bg-[var(--card)] pl-9 pr-3 text-sm font-bold text-[var(--foreground)]"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="submit"
                                disabled={
                                  saveBudgetMutation.isPending || updateCategoryMutation.isPending
                                }
                                className="min-h-[44px] text-xs px-3.5"
                              >
                                {saveBudgetMutation.isPending || updateCategoryMutation.isPending
                                  ? "Menyimpan..."
                                  : "Simpan"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                  setEditingCategoryBudgetId(null);
                                  setCategoryBudgetError("");
                                }}
                                className="min-h-[44px] text-xs px-3"
                              >
                                Batal
                              </Button>
                            </div>
                            {categoryBudgetError && (
                              <p
                                role="alert"
                                className="text-xs font-semibold text-[var(--destructive)] sm:w-full"
                              >
                                {categoryBudgetError}
                              </p>
                            )}
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {unconfiguredCategories.length > 0 && (
                <button
                  type="button"
                  aria-expanded={showZero}
                  onClick={() =>
                    setShowZeroByBucket((prev) => ({
                      ...prev,
                      [bucketKey]: !prev[bucketKey],
                    }))
                  }
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--card)] transition-colors"
                >
                  <span>
                    {showZero
                      ? `Sembunyikan kategori belum diatur (${unconfiguredCategories.length})`
                      : `Tampilkan kategori belum diatur (Rp 0) (${unconfiguredCategories.length})`}
                  </span>
                  <span aria-hidden="true">{showZero ? "▲" : "▼"}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  };

  const needsShareAmt = isCurrentPeriod ? (needs.remaining ?? 0) : needs.allocated;
  const wantsShareAmt = isCurrentPeriod ? (wants.remaining ?? 0) : wants.allocated;
  const savingsShareAmt = isCurrentPeriod ? (savings.remaining ?? 0) : savings.allocated;

  const bucketFilterTabs: Array<{ id: BucketFilterTab; label: string }> = [
    { id: "all", label: "Semua" },
    { id: "needs", label: "Kebutuhan" },
    { id: "wants", label: "Keinginan" },
    { id: "savings", label: "Tabungan" },
  ];

  const summaryPillars: Array<{
    id: CategoryBucket;
    label: string;
    allocated: number;
    spent: number;
    allocatedPercent: number;
    accentBg: string;
    accentText: string;
  }> = [
    {
      id: "needs",
      label: "Kebutuhan (Needs)",
      allocated: needs.allocated,
      spent: needs.spent,
      allocatedPercent: needs.allocatedPercent,
      accentBg: "bg-sky-500",
      accentText: "text-sky-700 dark:text-sky-300",
    },
    {
      id: "wants",
      label: "Keinginan (Wants)",
      allocated: wants.allocated,
      spent: wants.spent,
      allocatedPercent: wants.allocatedPercent,
      accentBg: "bg-amber-500",
      accentText: "text-amber-700 dark:text-amber-300",
    },
    {
      id: "savings",
      label: "Tabungan & Utang",
      allocated: savings.allocated,
      spent: savings.spent,
      allocatedPercent: savings.allocatedPercent,
      accentBg: "bg-emerald-500",
      accentText: "text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Heading + Cycle Switcher + Header CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Anggaran</h1>

        <div className="w-full sm:w-auto flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex w-full sm:w-auto items-center justify-between gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1">
            <button
              type="button"
              onClick={() => onPeriodChange(shiftMonth(period, -1))}
              aria-label="Siklus sebelumnya"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-[var(--surface)]"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <span className="tabular-nums px-2 text-xs font-semibold text-[var(--foreground)] sm:text-sm">
              {periodRangeLabel}
            </span>
            <button
              type="button"
              onClick={() => onPeriodChange(shiftMonth(period, 1))}
              aria-label="Siklus berikutnya"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-[var(--surface)]"
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto sm:items-center">
            <Button
              variant="secondary"
              onClick={openIncomeArchiveModal}
              className="w-full sm:w-auto justify-center gap-1.5"
            >
              <span>Pemasukan &amp; Arsip</span>
              {archivedCategories.length > 0 && (
                <Badge tone="neutral" className="text-[10px] px-1.5 py-0">
                  {archivedCategories.length}
                </Badge>
              )}
            </Button>

            <Button
              onClick={() => openCreateModal(activeBucketTab === "all" ? "needs" : activeBucketTab)}
              className="w-full sm:w-auto justify-center gap-1.5"
            >
              <PlusIcon className="w-4 h-4" />
              <span>Tambah Kategori</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Zero-Based Liquid Cash Budgeting Hero Banner */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
              <BudgetIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Total Dana Likuid Tersedia</span>
              {!isCurrentPeriod && (
                <Badge tone="neutral" className="ml-1 text-[10px]">
                  Siklus {formatMonthTitle(period)}
                </Badge>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(baselineFund, isMasked)}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2">
            <div className="rounded-[14px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-4 text-left sm:text-right">
              <span className="text-xs font-semibold text-[var(--hero-card-muted)]">
                {unallocated >= 0 ? "Sisa Dana Belum Dialokasikan:" : "Kelebihan Alokasi Anggaran:"}
              </span>
              <p
                className={`font-mono text-2xl font-black tabular-nums ${
                  isMasked
                    ? "text-[var(--hero-card-foreground)]"
                    : unallocated === 0
                      ? "text-[var(--chart-income)]"
                      : unallocated > 0
                        ? "text-slate-600 dark:text-slate-300"
                        : "text-[var(--destructive)]"
                }`}
              >
                {formatRupiah(Math.abs(unallocated), isMasked)}
              </p>
            </div>
          </div>
        </div>

        {/* Komposisi Anggaran Visual Bar */}
        <div className="mt-6 border-t border-[var(--hero-border)] pt-4 space-y-3">
          <div className="h-4 w-full rounded-full bg-[var(--surface)] overflow-hidden flex border border-[var(--border)] p-0.5 gap-0.5 shadow-inner">
            {needs.allocatedPercent > 0 && (
              <div
                className="bg-[#38bdf8] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, needs.allocatedPercent)}%` }}
                title={`Kebutuhan: ${needs.allocatedPercent}% (${formatRupiah(needsShareAmt, isMasked)})`}
              />
            )}
            {wants.allocatedPercent > 0 && (
              <div
                className="bg-[#fb923c] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, wants.allocatedPercent)}%` }}
                title={`Keinginan: ${wants.allocatedPercent}% (${formatRupiah(wantsShareAmt, isMasked)})`}
              />
            )}
            {savings.allocatedPercent > 0 && (
              <div
                className="bg-[#4ade80] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, savings.allocatedPercent)}%` }}
                title={`Tabungan & Utang: ${savings.allocatedPercent}% (${formatRupiah(savingsShareAmt, isMasked)})`}
              />
            )}
            {unallocated > 0 && (
              <div
                className="bg-slate-300 dark:bg-slate-600 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, unallocatedPercent)}%` }}
                title={`Belum Dialokasikan: ${unallocatedPercent}% (${formatRupiah(unallocated, isMasked)})`}
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs pt-1">
            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] shrink-0" />
                <span className="text-[#0284c7] dark:text-[#38bdf8] font-bold">Kebutuhan:</span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {needs.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(needsShareAmt, isMasked)})
              </span>
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#fb923c] shrink-0" />
                <span className="text-[#ea580c] dark:text-[#fb923c] font-bold">Keinginan:</span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {wants.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(wantsShareAmt, isMasked)})
              </span>
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#4ade80] shrink-0" />
                <span className="text-[#16a34a] dark:text-[#4ade80] font-bold">
                  Tabungan & Utang:
                </span>
                <span className="font-mono font-bold text-[var(--hero-card-foreground)] tabular-nums">
                  {savings.allocatedPercent}%
                </span>
              </div>
              <span className="text-[11px] text-[var(--hero-card-muted)] tabular-nums font-mono">
                ({formatRupiah(savingsShareAmt, isMasked)})
              </span>
            </div>

            {unallocated > 0 ? (
              <div className="flex items-center justify-between sm:justify-start gap-2 font-medium">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-500 shrink-0" />
                  <span className="text-slate-600 dark:text-slate-300 font-bold">
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
                  <span className="text-[var(--destructive)] font-bold">Kelebihan Alokasi:</span>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summaryPillars.map((pillar) => {
          const pctUsed =
            pillar.allocated > 0 ? Math.round((pillar.spent / pillar.allocated) * 100) : 0;
          const isSelected = activeBucketTab === pillar.id;
          return (
            <button
              key={pillar.id}
              type="button"
              onClick={() =>
                setActiveBucketTab((prev) => (prev === pillar.id ? "all" : pillar.id))
              }
              className={`rounded-[16px] border p-4 text-left transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--card)] ring-2 ring-[var(--primary)]/20"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--control-border)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-extrabold ${pillar.accentText}`}>
                  {pillar.label}
                </span>
                <span className="font-mono text-xs font-bold text-[var(--muted-foreground)] tabular-nums">
                  {pillar.allocatedPercent}%
                </span>
              </div>
              <p className="mt-1 font-mono text-base font-extrabold text-[var(--foreground)] tabular-nums">
                {pillar.allocated > 0 ? formatRupiah(pillar.allocated, isMasked) : "Belum Diatur"}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface)]">
                <div
                  className={`h-full rounded-full transition-all ${
                    pctUsed > 100 ? "bg-[var(--destructive)]" : pillar.accentBg
                  }`}
                  style={{ width: `${Math.min(100, pctUsed)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)] tabular-nums">
                Terpakai {formatRupiah(pillar.spent, isMasked)} ({pctUsed}%)
              </p>
            </button>
          );
        })}
      </div>

      {/* Tab Filter Pos (Semua | Kebutuhan | Keinginan | Tabungan) */}
      <div className="flex flex-col gap-2 border-b border-[var(--border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Filter kelompok anggaran"
          className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-2"
        >
          {bucketFilterTabs.map((tabItem) => {
            const isActive = activeBucketTab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveBucketTab(tabItem.id)}
                className={`min-h-[44px] whitespace-nowrap rounded-[12px] px-2 text-center text-xs font-bold transition-all sm:px-4 sm:text-sm ${
                  isActive
                    ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                }`}
              >
                {tabItem.label}
              </button>
            );
          })}
        </div>

        <Button
          variant="secondary"
          disabled={copyPreviousMutation.isPending}
          onClick={() => copyPreviousMutation.mutate()}
          className="min-h-[44px] text-xs px-3.5 shrink-0"
        >
          {copyPreviousMutation.isPending ? "Menyalin..." : "Salin dari Siklus Lalu"}
        </Button>
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
        {(activeBucketTab === "all" || activeBucketTab === "needs") &&
          renderBucketSection("Kebutuhan Hidup (Needs)", "needs", needs, "#38bdf8")}
        {(activeBucketTab === "all" || activeBucketTab === "wants") &&
          renderBucketSection("Keinginan & Gaya Hidup (Wants)", "wants", wants, "#fb923c")}
        {(activeBucketTab === "all" || activeBucketTab === "savings") &&
          renderBucketSection("Tabungan & Utang (Savings & Debt)", "savings", savings, "#4ade80")}
      </div>

      {/* Modal Tambah / Edit Kategori */}
      <ModalSheet
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? "Edit Kategori" : "Tambah Kategori Baru"}
        subtitle="Kelola pos pengeluaran sesuai kelompok variabel utama"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setCategoryModalOpen(false)}
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="budget-category-form"
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
            >
              {editingCategory ? "Simpan Perubahan" : "Tambah Kategori"}
            </Button>
          </div>
        }
      >
        <form id="budget-category-form" onSubmit={handleSaveCategoryModal} className="space-y-4">
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
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Nama Kategori <span className="text-[var(--destructive)]">*</span>
            </label>
            <input
              id="cat-name-input"
              type="text"
              required
              value={modalName}
              onChange={(e) => setModalName(e.target.value)}
              placeholder="Contoh: Kopi, Gym, Asuransi"
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="cat-bucket-select"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Kelompok Anggaran (Variabel Utama)
            </label>
            <select
              id="cat-bucket-select"
              value={modalBucket}
              onChange={(e) => setModalBucket(e.target.value as CategoryBucket)}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="needs">Kebutuhan Hidup (Needs)</option>
              <option value="wants">Keinginan & Gaya Hidup (Wants)</option>
              <option value="savings">Tabungan & Utang (Savings & Debt)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="cat-limit-input"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Pagu Kategori Siklus Ini (Opsional)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="cat-limit-input"
                type="text"
                inputMode="numeric"
                value={modalLimit}
                onChange={(e) => setModalLimit(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] pl-11 pr-3.5 font-mono text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              />
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Batas belanja custom pada siklus {periodRangeLabel} untuk kategori ini.
            </p>
          </div>

          <label className="flex min-h-[44px] items-center gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={modalIsMandatory}
              onChange={(e) => setModalIsMandatory(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <div>
              <span className="block text-xs font-bold text-[var(--foreground)]">
                Tandai sebagai kategori wajib
              </span>
              <span className="block text-[11px] text-[var(--muted-foreground)]">
                Kategori rutin penting yang harus diprioritaskan setiap siklus.
              </span>
            </div>
          </label>

          <div className="space-y-1.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Warna Penanda
            </span>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {COLOR_PRESETS.map((color) => {
                const isSelected = modalColor.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setModalColor(color)}
                    className={`h-8 w-8 rounded-full transition-transform ${
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
        footer={
          <div className="flex items-center justify-end gap-2">
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
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--foreground)]">
            Apakah Anda yakin ingin menghapus kategori{" "}
            <strong>{deletingCategory?.categoryName}</strong>? Pagu anggaran kategori ini akan
            otomatis dibersihkan.
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Catatan: Kategori yang sudah memiliki riwayat transaksi tidak dapat dihapus sebelum
            kategorinya diubah.
          </p>
        </div>
      </ModalSheet>

      {/* Modal Kelola Kategori Pemasukan & Arsip */}
      <ModalSheet
        open={incomeArchiveModalOpen}
        onClose={() => setIncomeArchiveModalOpen(false)}
        title="Kelola Kategori Pemasukan & Arsip"
        subtitle="Tambah atau ubah kategori pemasukan, serta pulihkan kategori yang diarsipkan."
        size="lg"
        footer={
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIncomeArchiveModalOpen(false)}
            >
              Tutup
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Tab Switcher: Pemasukan | Diarsipkan */}
          <div
            role="tablist"
            aria-label="Kelola kategori pemasukan dan arsip"
            className="grid grid-cols-2 gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={incomeArchiveTab === "income"}
              onClick={() => {
                setIncomeArchiveTab("income");
                setManageModalError("");
                setConfirmDeleteArchivedId(null);
              }}
              className={`min-h-[40px] rounded-[10px] px-3 text-xs font-bold transition-all ${
                incomeArchiveTab === "income"
                  ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-xs"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              Pemasukan ({incomeCategories.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={incomeArchiveTab === "archived"}
              onClick={() => {
                setIncomeArchiveTab("archived");
                setManageModalError("");
                setEditingIncomeId(null);
              }}
              className={`min-h-[40px] rounded-[10px] px-3 text-xs font-bold transition-all ${
                incomeArchiveTab === "archived"
                  ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-xs"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              Diarsipkan ({archivedCategories.length})
            </button>
          </div>

          {manageModalError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{manageModalError}</span>
            </div>
          )}

          {incomeArchiveTab === "income" ? (
            <div className="space-y-4">
              {/* Form Singkat Tambah Kategori Pemasukan */}
              <form
                onSubmit={handleAddIncomeCategory}
                className="space-y-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
              >
                <label
                  htmlFor="new-income-category-input"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Tambah Kategori Pemasukan Baru
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id="new-income-category-input"
                    type="text"
                    value={newIncomeName}
                    onChange={(e) => {
                      setNewIncomeName(e.target.value);
                      if (newIncomeError) setNewIncomeError("");
                    }}
                    placeholder="Contoh: Gaji, Bonus, Freelance, Dividen"
                    className="h-11 flex-1 rounded-[12px] border border-[var(--control-border)] bg-[var(--card)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                  />
                  <Button
                    type="submit"
                    disabled={createIncomeCategoryMutation.isPending}
                    className="gap-1.5 shrink-0"
                  >
                    <PlusIcon className="w-4 h-4" />
                    <span>
                      {createIncomeCategoryMutation.isPending ? "Menambah..." : "Tambah"}
                    </span>
                  </Button>
                </div>
                {newIncomeError && (
                  <p role="alert" className="text-xs text-[var(--destructive)] font-semibold">
                    {newIncomeError}
                  </p>
                )}
              </form>

              {/* Daftar Kategori Pemasukan Aktif */}
              {incomeCategories.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)]/50 p-6 text-center text-xs text-[var(--muted-foreground)]">
                  Belum ada kategori pemasukan aktif.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)] rounded-[14px] border border-[var(--border)] bg-[var(--card)] overflow-hidden">
                  {incomeCategories.map((cat) => {
                    const isEditing = editingIncomeId === cat.id;
                    return (
                      <div key={cat.id} className="space-y-2.5 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: cat.color || "#009267" }}
                              aria-hidden="true"
                            />
                            <span className="text-sm font-bold text-[var(--foreground)] truncate">
                              {cat.name}
                            </span>
                            <Badge tone="soft" className="text-[10px]">
                              Masuk
                            </Badge>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              aria-label={`Edit kategori ${cat.name}`}
                              onClick={() =>
                                isEditing ? setEditingIncomeId(null) : startEditIncomeCategory(cat)
                              }
                              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
                            >
                              <EditIcon className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              disabled={manageCategoryMutation.isPending}
                              onClick={() =>
                                manageCategoryMutation.mutate({
                                  id: cat.id,
                                  payload: { isArchived: true },
                                  successMessage: `Kategori "${cat.name}" diarsipkan`,
                                })
                              }
                              className="inline-flex min-h-[40px] items-center rounded-[10px] border border-[var(--control-border)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors disabled:opacity-45"
                            >
                              Arsipkan
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
                            <input
                              type="text"
                              aria-label={`Ubah nama kategori ${cat.name}`}
                              value={editingIncomeName}
                              onChange={(e) => setEditingIncomeName(e.target.value)}
                              className="h-10 flex-1 min-w-[160px] rounded-[10px] border border-[var(--control-border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                            />
                            <Button
                              type="button"
                              disabled={manageCategoryMutation.isPending}
                              onClick={() => handleSaveIncomeEdit(cat)}
                              className="min-h-[40px] px-3.5 text-xs"
                            >
                              Simpan
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setEditingIncomeId(null)}
                              className="min-h-[40px] px-3 text-xs"
                            >
                              Batal
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {archivedCategories.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)]/50 p-6 text-center text-xs text-[var(--muted-foreground)]">
                  Belum ada kategori yang diarsipkan.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)] rounded-[14px] border border-[var(--border)] bg-[var(--card)] overflow-hidden">
                  {archivedCategories.map((cat) => {
                    const isConfirmingDelete = confirmDeleteArchivedId === cat.id;
                    return (
                      <div key={cat.id} className="space-y-2.5 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0 opacity-60"
                              style={{ backgroundColor: cat.color || "#64748b" }}
                              aria-hidden="true"
                            />
                            <span className="text-sm font-semibold text-[var(--muted-foreground)] truncate">
                              {cat.name}
                            </span>
                            <Badge
                              tone={cat.type === "income" ? "soft" : "neutral"}
                              className="text-[10px]"
                            >
                              {cat.type === "income" ? "Masuk" : "Keluar"}
                            </Badge>
                            {cat.type === "expense" && cat.bucket && (
                              <Badge tone="info" className="text-[10px]">
                                {BUCKET_SHORT_LABELS[cat.bucket] ?? cat.bucket}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={manageCategoryMutation.isPending}
                              onClick={() =>
                                manageCategoryMutation.mutate({
                                  id: cat.id,
                                  payload: { isArchived: false },
                                  successMessage: `Kategori "${cat.name}" berhasil dipulihkan`,
                                })
                              }
                              className="inline-flex min-h-[40px] items-center rounded-[10px] border border-[var(--control-border)] px-3 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--surface)] transition-colors disabled:opacity-45"
                            >
                              Pulihkan
                            </button>
                            <button
                              type="button"
                              aria-label={`Hapus kategori ${cat.name}`}
                              title="Hapus permanen"
                              onClick={() =>
                                setConfirmDeleteArchivedId(isConfirmingDelete ? null : cat.id)
                              }
                              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--control-border)] text-[var(--muted-foreground)] hover:bg-rose-50 hover:text-[var(--destructive)] dark:hover:bg-rose-950/30 transition-colors"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {isConfirmingDelete && (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2">
                            <span className="text-xs font-semibold text-[var(--foreground)]">
                              Hapus permanen kategori &ldquo;{cat.name}&rdquo;?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="danger"
                                disabled={deleteArchivedCategoryMutation.isPending}
                                onClick={() =>
                                  deleteArchivedCategoryMutation.mutate({
                                    id: cat.id,
                                    name: cat.name,
                                  })
                                }
                                className="min-h-[36px] px-3 text-xs"
                              >
                                {deleteArchivedCategoryMutation.isPending
                                  ? "Menghapus..."
                                  : "Ya, Hapus"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setConfirmDeleteArchivedId(null)}
                                className="min-h-[36px] px-3 text-xs"
                              >
                                Batal
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalSheet>
    </div>
  );
}
