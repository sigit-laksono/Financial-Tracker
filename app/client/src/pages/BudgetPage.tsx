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

type BucketFilterTab = CategoryBucket;
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
  const [activeBucketTab, setActiveBucketTab] = useState<BucketFilterTab>("needs");
  const [showZeroByBucket, setShowZeroByBucket] = useState<Record<CategoryBucket, boolean>>({
    needs: false,
    wants: false,
    savings: false,
  });

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
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

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
      closeDeleteDialog();
      onToast(`${deletedName} berhasil dihapus`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menghapus kategori.";
      closeDeleteDialog();
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

  const deleteTargetHasBudget = (deletingCategory?.budgetLimit ?? 0) > 0;
  const deleteTargetHasSpend = (deletingCategory?.actualSpent ?? 0) > 0;
  const deleteNameMatches =
    deleteConfirmText.trim().toLowerCase() ===
    (deletingCategory?.categoryName ?? "").trim().toLowerCase();
  const canConfirmDelete =
    deletingCategory !== null &&
    !deleteTargetHasSpend &&
    (!deleteTargetHasBudget || deleteNameMatches);
  const closeDeleteDialog = () => {
    setDeletingCategory(null);
    setDeleteConfirmText("");
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
    const { allocated, spent, categories } = bucketData;
    const percentUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
    const isOver = allocated > 0 && spent > allocated;
    const isWarning = allocated > 0 && spent >= allocated * 0.8 && !isOver;

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
        <div className="space-y-3 border-b border-[var(--border)] pb-4">
          <h2 className="text-lg font-black text-[var(--foreground)]">{title}</h2>

          {allocated > 0 ? (
            <div className="space-y-2">
              <div>
                <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {isOver ? "Lebih dari budget" : "Sisa budget"}
                </span>
                <span
                  className={`font-mono text-2xl font-black tabular-nums ${
                    isOver ? "text-[var(--destructive)]" : "text-[var(--foreground)]"
                  }`}
                >
                  {formatRupiah(isOver ? spent - allocated : allocated - spent, isMasked)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface)]">
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
              <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
                Terpakai{" "}
                <strong className="text-[var(--foreground)]">{formatRupiah(spent, isMasked)}</strong>{" "}
                dari {formatRupiah(allocated, isMasked)} ({percentUsed}%)
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">
              Belum ada budget. Atur budget lewat ikon edit di tiap kategori.
            </p>
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
                    const barColor =
                      c.status === "exceeded"
                        ? "var(--destructive)"
                        : c.status === "warning"
                          ? "#f59e0b"
                          : c.color || accentColor;

                    return (
                      <div key={c.categoryId} className="py-3.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full shrink-0 shadow-xs"
                            style={{ backgroundColor: c.color }}
                            aria-hidden="true"
                          />
                          <strong className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--foreground)]">
                            {c.categoryName}
                          </strong>
                          {isMandatory && (
                            <Badge tone="highlight" className="text-[10px] shrink-0">
                              Wajib
                            </Badge>
                          )}
                          <div className="flex shrink-0 items-center -mr-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(c)}
                              title="Edit kategori dan budget"
                              aria-label={`Edit kategori ${c.categoryName}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
                            >
                              <EditIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${hasBudget ? Math.min(100, c.percentUsed) : sharePercent}%`,
                              backgroundColor: hasBudget ? barColor : c.color || accentColor,
                            }}
                          />
                        </div>

                        <div className="flex items-baseline justify-between gap-3 text-xs tabular-nums">
                          <span className="font-sans text-[var(--muted-foreground)]">
                            Terpakai{" "}
                            <strong className="font-mono text-sm font-extrabold text-[var(--foreground)]">
                              {formatRupiah(c.actualSpent, isMasked)}
                            </strong>
                          </span>
                          {hasBudget ? (
                            <span
                              className={
                                c.remaining < 0
                                  ? "font-mono font-bold text-[var(--destructive)]"
                                  : "font-mono font-bold text-[var(--chart-income)]"
                              }
                            >
                              {c.remaining >= 0
                                ? `Sisa ${formatRupiah(c.remaining, isMasked)}`
                                : `Lebih ${formatRupiah(Math.abs(c.remaining), isMasked)}`}
                            </span>
                          ) : (
                            <span className="font-sans text-[var(--muted-foreground)]">
                              Belum ada budget
                            </span>
                          )}
                        </div>

                        {(hasBudget || c.actualSpent > 0) && (
                          <p className="font-sans text-[11px] text-[var(--muted-foreground)]">
                            {hasBudget
                              ? `Budget ${formatRupiah(c.budgetLimit, isMasked)} · ${Math.round(c.percentUsed)}% terpakai`
                              : `${sharePercent}% dari pengeluaran ${title.split(" ")[0]}`}
                          </p>
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
    { id: "needs", label: "Kebutuhan" },
    { id: "wants", label: "Keinginan" },
    { id: "savings", label: "Tabungan & Utang" },
  ];

  const summaryPillars: Array<{
    id: CategoryBucket;
    label: string;
    allocated: number;
    spent: number;
    allocatedPercent: number;
    accentBg: string;
    accentText: string;
    dotColor: string;
  }> = [
    {
      id: "needs",
      label: "Kebutuhan (Needs)",
      allocated: needs.allocated,
      spent: needs.spent,
      allocatedPercent: needs.allocatedPercent,
      accentBg: "bg-sky-500",
      accentText: "text-sky-700 dark:text-sky-300",
      dotColor: "#38bdf8",
    },
    {
      id: "wants",
      label: "Keinginan (Wants)",
      allocated: wants.allocated,
      spent: wants.spent,
      allocatedPercent: wants.allocatedPercent,
      accentBg: "bg-amber-500",
      accentText: "text-amber-700 dark:text-amber-300",
      dotColor: "#fb923c",
    },
    {
      id: "savings",
      label: "Tabungan & Utang",
      allocated: savings.allocated,
      spent: savings.spent,
      allocatedPercent: savings.allocatedPercent,
      accentBg: "bg-emerald-500",
      accentText: "text-emerald-700 dark:text-emerald-300",
      dotColor: "#4ade80",
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

          <div className="grid grid-cols-3 gap-2 w-full sm:flex sm:w-auto sm:items-center">
            <Button
              variant="secondary"
              onClick={openIncomeArchiveModal}
              className="w-full sm:w-auto justify-center gap-1.5 px-2 text-xs leading-tight sm:px-4 sm:text-sm"
            >
              <span>Pemasukan &amp; Arsip</span>
              {archivedCategories.length > 0 && (
                <Badge tone="neutral" className="text-[10px] px-1.5 py-0">
                  {archivedCategories.length}
                </Badge>
              )}
            </Button>

            <Button
              variant="secondary"
              disabled={copyPreviousMutation.isPending}
              onClick={() => copyPreviousMutation.mutate()}
              title="Salin budget kategori dari siklus sebelumnya"
              className="w-full sm:w-auto justify-center px-2 text-xs leading-tight sm:px-4 sm:text-sm"
            >
              {copyPreviousMutation.isPending ? "Menyalin..." : "Salin Siklus Lalu"}
            </Button>

            <Button
              onClick={() => openCreateModal(activeBucketTab)}
              className="w-full sm:w-auto justify-center gap-1.5 px-2 text-xs leading-tight sm:px-4 sm:text-sm"
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
              onClick={() => setActiveBucketTab(pillar.id)}
              className={`rounded-[16px] border p-4 text-left transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--card)] ring-2 ring-[var(--primary)]/20"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--control-border)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`flex min-w-0 items-center gap-1.5 text-xs font-extrabold ${pillar.accentText}`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: pillar.dotColor }}
                    aria-hidden="true"
                  />
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
              <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-[var(--muted-foreground)] tabular-nums">
                <span>
                  Terpakai {formatRupiah(pillar.spent, isMasked)} ({pctUsed}%)
                </span>
                {pillar.allocated > 0 && (
                  <span
                    className={`font-bold ${
                      pillar.allocated - pillar.spent < 0
                        ? "text-[var(--destructive)]"
                        : "text-[var(--chart-income)]"
                    }`}
                  >
                    {pillar.allocated - pillar.spent >= 0
                      ? `Sisa ${formatRupiah(pillar.allocated - pillar.spent, isMasked)}`
                      : `Lebih ${formatRupiah(pillar.spent - pillar.allocated, isMasked)}`}
                  </span>
                )}
              </p>
            </button>
          );
        })}
      </div>

      {/* Tab kelompok: Kebutuhan | Keinginan | Tabungan & Utang */}
      <div className="border-b border-[var(--border)] pb-3">
        <div
          role="tablist"
          aria-label="Kelompok anggaran"
          className="grid grid-cols-3 gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-2"
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
                className={`min-h-[44px] rounded-[12px] px-1.5 text-center text-xs font-bold leading-tight transition-all sm:px-4 sm:text-sm ${
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
      </div>

      {/* 3 Main Envelopes */}
      <div className="space-y-6">
        {activeBucketTab === "needs" &&
          renderBucketSection("Kebutuhan Hidup (Needs)", "needs", needs, "#38bdf8")}
        {activeBucketTab === "wants" &&
          renderBucketSection("Keinginan & Gaya Hidup (Wants)", "wants", wants, "#fb923c")}
        {activeBucketTab === "savings" &&
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

          {editingCategory && (
            <div className="border-t border-[var(--border)] pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCategoryModalOpen(false);
                  setDeleteConfirmText("");
                  setDeletingCategory(editingCategory);
                }}
                className="min-h-[44px] w-full justify-center border-[var(--destructive)]/40 text-[var(--destructive)]!"
              >
                <TrashIcon className="mr-1.5 h-4 w-4" />
                Hapus Kategori Ini
              </Button>
            </div>
          )}
        </form>
      </ModalSheet>

      {/* Modal Konfirmasi Hapus Kategori */}
      <ModalSheet
        open={deletingCategory !== null}
        onClose={closeDeleteDialog}
        title="Hapus Kategori?"
        subtitle={
          deletingCategory
            ? `Konfirmasi penghapusan kategori "${deletingCategory.categoryName}"`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDeleteDialog}>
              Batal
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteCategoryMutation.isPending || !canConfirmDelete}
              onClick={() => {
                if (deletingCategory && canConfirmDelete) {
                  deleteCategoryMutation.mutate(deletingCategory.categoryId);
                }
              }}
            >
              {deleteCategoryMutation.isPending ? "Menghapus..." : "Hapus Kategori"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {deleteTargetHasSpend ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Kategori <strong>{deletingCategory?.categoryName}</strong> sudah punya transaksi
                dan tidak bisa dihapus. Pindahkan transaksinya ke kategori lain terlebih dahulu.
              </span>
            </div>
          ) : (
            <p className="text-sm text-[var(--foreground)]">
              Hapus kategori <strong>{deletingCategory?.categoryName}</strong>? Tindakan ini tidak
              bisa dibatalkan.
            </p>
          )}

          {deleteTargetHasBudget && !deleteTargetHasSpend && (
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--muted-foreground)]">
                Budget kategori ini{" "}
                <strong className="text-[var(--foreground)]">
                  ({formatRupiah(deletingCategory?.budgetLimit ?? 0, isMasked)})
                </strong>{" "}
                ikut terhapus di semua siklus. Ketik nama kategori untuk melanjutkan.
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deletingCategory?.categoryName}
                aria-label="Ketik nama kategori untuk konfirmasi penghapusan"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--destructive)] focus:ring-2 focus:ring-[var(--destructive)]/20 transition-all"
              />
            </div>
          )}
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
