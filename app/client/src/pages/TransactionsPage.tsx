import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError, type DashboardDto, type TransactionDto } from "../lib/api";
import { CC_STATEMENT_FEE_NOTE } from "../../../shared/src/types";
import type { TransactionFiltersState } from "../lib/filters";
import { budgetKeys, goalKeys } from "../lib/queryKeys";
import {
  buildWeekSlices,
  formatCompactRupiah,
  formatDayHeader,
  formatPeriodRangeLabel,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  shiftMonth,
} from "../lib/format";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  SettingsIcon,
  SplitPayIcon,
  TransactionsIcon,
  TrashIcon,
} from "../components/Icons";
import { Badge, Button, Card, ModalSheet, ProgressBar, StateView } from "../components/UI";

/** Auto-posted statement fees carry a boilerplate note that adds nothing to the row. */
function isAutoNote(tx: TransactionDto): boolean {
  return tx.source === "system" && tx.note === CC_STATEMENT_FEE_NOTE;
}

/**
 * Drops transfer admin-fee rows whose transfer is in the same list. The list shows
 * those fees as "+Admin" on the transfer row instead of as rows of their own.
 */
function withoutMergedTransferFees(rows: TransactionDto[]): TransactionDto[] {
  const transferGroupIds = new Set(
    rows.filter((t) => t.type === "transfer" && t.transferGroupId).map((t) => t.transferGroupId),
  );
  return rows.filter(
    (tx) =>
      !(
        tx.type === "expense" &&
        tx.category === "Biaya Bank" &&
        tx.transferGroupId &&
        transferGroupIds.has(tx.transferGroupId)
      ),
  );
}

/** Money out on a day: the red rows (minus converted installments) plus transfer admin fees. */
function dayOutflow(rows: TransactionDto[]): number {
  let total = 0;
  for (const t of rows) {
    if (t.type === "expense" && !t.isConvertedToInstallment) total += t.amount;
    else if (t.type === "settlement" || t.type === "debt_disbursement") total += t.amount;
    else if (t.type === "transfer") total += t.linkedFeeTransaction?.amount ?? 0;
  }
  return total;
}

export function TransactionsPage({
  data,
  period,
  filters,
  onFiltersChange,
  onPeriodChange,
  onEditTransaction,
  onSplitPay,
  onAddTransaction,
  onOpenBudget,
  onToast,
}: {
  data: DashboardDto;
  period: string;
  filters: TransactionFiltersState;
  onFiltersChange: (next: TransactionFiltersState) => void;
  onPeriodChange: (nextPeriod: string) => void;
  onEditTransaction: (tx: TransactionDto) => void;
  onSplitPay: (tx: TransactionDto) => void;
  onAddTransaction: () => void;
  onOpenBudget: () => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const weeks = useMemo(
    () => buildWeekSlices(data.periodStart, data.periodEnd),
    [data.periodStart, data.periodEnd],
  );
  const today = jakartaToday();
  const currentRunningWeekIndex = useMemo(() => {
    const match = weeks.find((w) => today >= w.start && today <= w.end);
    return match ? match.index : null;
  }, [weeks, today]);

  const resolvedWeekChoice = filters.weekChoice === "auto" ? "all" : filters.weekChoice;

  const periodTransactions = useMemo(
    () => withoutMergedTransferFees(data.transactions),
    [data.transactions],
  );

  const weekCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const w of weeks) {
      counts[w.index] = 0;
    }
    for (const tx of periodTransactions) {
      for (const w of weeks) {
        if (tx.transactionDate >= w.start && tx.transactionDate <= w.end) {
          counts[w.index] = (counts[w.index] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, [periodTransactions, weeks]);

  const [insightsOpen, setInsightsOpen] = useState(false);
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | null>(null);

  // Mobile Filter Sheet state
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draftWallet, setDraftWallet] = useState(filters.walletFilter);
  const [draftType, setDraftType] = useState(filters.typeFilter);
  const [draftCategory, setDraftCategory] = useState(filters.categoryFilter);

  // Desktop View Switcher & Bulk Selection state
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const selectionResetKey = `${period}|${filters.weekChoice}|${filters.walletFilter}|${filters.typeFilter}|${filters.categoryFilter}|${filters.search}`;
  const prevSelectionResetKeyRef = useRef(selectionResetKey);
  useEffect(() => {
    if (prevSelectionResetKeyRef.current !== selectionResetKey) {
      prevSelectionResetKeyRef.current = selectionResetKey;
      setSelectedIds([]);
    }
  }, [selectionResetKey]);

  const deleteTxMutation = useMutation({
    mutationFn: (id: number) => api.deleteTransaction(id),
    onSuccess: async (_, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: goalKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      setConfirmDeleteTxId(null);
      setSelectedIds((prev) => prev.filter((id) => id !== deletedId));
      onToast("Transaksi dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus transaksi.");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      let successCount = 0;
      let failedCount = 0;
      for (const id of ids) {
        try {
          await api.deleteTransaction(id);
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      if (successCount === 0 && failedCount > 0) {
        throw new Error("Gagal menghapus transaksi terpilih.");
      }
      return { successCount, failedCount };
    },
    onSuccess: async ({ successCount, failedCount }) => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: goalKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      setBulkDeleteConfirmOpen(false);
      setSelectedIds([]);
      onToast(
        failedCount > 0
          ? `${successCount} transaksi dihapus, ${failedCount} gagal`
          : `${successCount} transaksi berhasil dihapus`,
      );
    },
    onError: (err) => {
      setBulkDeleteConfirmOpen(false);
      onToast(err instanceof Error ? err.message : "Gagal menghapus transaksi massal.");
    },
  });

  const activeWeek =
    resolvedWeekChoice === "all"
      ? null
      : (weeks.find((w) => w.index === resolvedWeekChoice) ?? null);

  const filterCategoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of data.categories) names.add(c.name);
    for (const tx of data.transactions) names.add(tx.category);
    return [...names].sort((a, b) => a.localeCompare(b, "id"));
  }, [data.categories, data.transactions]);

  const filterStart = activeWeek ? activeWeek.start : data.periodStart;
  const filterEnd = activeWeek ? activeWeek.end : data.periodEnd;

  const txListQuery = useInfiniteQuery({
    queryKey: [
      "transactions",
      filterStart,
      filterEnd,
      filters.walletFilter,
      filters.typeFilter,
      filters.categoryFilter,
      filters.search.trim(),
    ],
    initialPageParam: undefined as { cursorDate: string; cursorId: number } | undefined,
    queryFn: ({ pageParam }) =>
      api.getTransactions({
        start: filterStart,
        end: filterEnd,
        walletId: filters.walletFilter !== "all" ? Number(filters.walletFilter) : undefined,
        type: filters.typeFilter,
        category: filters.categoryFilter,
        search: filters.search,
        limit: 50,
        cursorDate: pageParam?.cursorDate,
        cursorId: pageParam?.cursorId,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const loadedTransactions = useMemo(
    () =>
      txListQuery.data?.pages
        .flatMap((page) => page?.items ?? [])
        .filter((tx): tx is TransactionDto => Boolean(tx?.transactionDate)) ?? [],
    [txListQuery.data],
  );
  const filteredTransactions = useMemo(
    () =>
      filters.typeFilter === "all"
        ? withoutMergedTransferFees(loadedTransactions)
        : loadedTransactions,
    [loadedTransactions, filters.typeFilter],
  );
  // The server count includes the admin-fee rows merged into their transfers above.
  const mergedFeeCount = loadedTransactions.length - filteredTransactions.length;
  const totalFilteredCount =
    (txListQuery.data?.pages[0]?.totalCount ?? loadedTransactions.length) - mergedFeeCount;
  const countLabel = txListQuery.hasNextPage
    ? `Menampilkan ${filteredTransactions.length} dari ${totalFilteredCount} transaksi`
    : `${filteredTransactions.length} transaksi`;

  const groupedByDay = useMemo(() => {
    const map = new Map<string, TransactionDto[]>();
    for (const tx of filteredTransactions) {
      const list = map.get(tx.transactionDate) ?? [];
      list.push(tx);
      map.set(tx.transactionDate, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredTransactions]);

  const paydaySuffix = `-${String(data.settings.gajianStartDay).padStart(2, "0")}`;

  const chartData = useMemo(() => {
    const start = new Date(`${data.periodStart}T00:00:00Z`);
    const end = new Date(`${data.periodEnd}T00:00:00Z`);
    const byDate = new Map(data.dailyTotals.map((d) => [d.date, d]));
    const rows: Array<{ label: string; date: string; income: number; expense: number }> = [];
    for (
      const cursor = new Date(start);
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      if (activeWeek && (key < activeWeek.start || key > activeWeek.end)) continue;
      const point = byDate.get(key) ?? { date: key, income: 0, expense: 0 };
      const isPayday = key.endsWith(paydaySuffix);
      rows.push({
        date: key,
        label: key.slice(8, 10),
        income: filters.hidePayday && isPayday ? 0 : point.income,
        expense: point.expense,
      });
    }
    return rows;
  }, [
    data.periodStart,
    data.periodEnd,
    data.dailyTotals,
    activeWeek,
    filters.hidePayday,
    paydaySuffix,
  ]);

  const budgetByCategory = useMemo(
    () => new Map(data.budgets.map((b) => [b.category, b])),
    [data.budgets],
  );

  const activeModalFilterCount =
    (filters.walletFilter !== "all" ? 1 : 0) +
    (filters.typeFilter !== "all" ? 1 : 0) +
    (filters.categoryFilter !== "all" ? 1 : 0);

  const hasActiveFilter =
    resolvedWeekChoice !== "all" ||
    filters.walletFilter !== "all" ||
    filters.typeFilter !== "all" ||
    filters.categoryFilter !== "all" ||
    filters.search.trim().length > 0;

  const resetFilters = () => {
    onFiltersChange({
      ...filters,
      weekChoice: "all",
      walletFilter: "all",
      typeFilter: "all",
      categoryFilter: "all",
      search: "",
    });
  };

  const openFilterSheet = () => {
    setDraftWallet(filters.walletFilter);
    setDraftType(filters.typeFilter);
    setDraftCategory(filters.categoryFilter);
    setFilterSheetOpen(true);
  };

  const visibleTxIds = useMemo(() => filteredTransactions.map((t) => t.id), [filteredTransactions]);
  const selectedVisibleCount = useMemo(
    () => selectedIds.filter((id) => visibleTxIds.includes(id)).length,
    [selectedIds, visibleTxIds],
  );
  const allVisibleSelected =
    visibleTxIds.length > 0 && selectedVisibleCount === visibleTxIds.length;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleTxIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...visibleTxIds])]);
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Transaksi</h1>

        <div className="flex w-full sm:w-auto items-center justify-between gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1">
          <button
            type="button"
            onClick={() => onPeriodChange(shiftMonth(period, -1))}
            aria-label="Periode sebelumnya"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface)]"
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <span className="tabular-nums px-2 text-xs font-semibold text-[var(--foreground)] sm:text-sm">
            {formatPeriodRangeLabel(data.periodStart, data.periodEnd)}
          </span>
          <button
            type="button"
            onClick={() => onPeriodChange(shiftMonth(period, 1))}
            aria-label="Periode berikutnya"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface)]"
          >
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Week Slice Controls: 1-Row (Semua + Dropdown Minggu) */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, weekChoice: "all" })}
          aria-pressed={resolvedWeekChoice === "all"}
          className={`h-11 shrink-0 inline-flex items-center gap-1.5 rounded-[12px] border px-3.5 text-xs font-bold sm:text-sm whitespace-nowrap transition-all ${
            resolvedWeekChoice === "all"
              ? "border-[var(--primary)] bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-xs"
              : "border-[var(--control-border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface)]"
          }`}
        >
          <span>Semua</span>
          <span
            className={`tabular-nums text-xs font-semibold ${
              resolvedWeekChoice === "all" ? "opacity-90" : "text-[var(--muted-foreground)]"
            }`}
          >
            ({periodTransactions.length})
          </span>
        </button>

        <select
          aria-label="Pilih minggu"
          value={resolvedWeekChoice === "all" ? "" : String(resolvedWeekChoice)}
          onChange={(e) => {
            const val = e.target.value;
            onFiltersChange({
              ...filters,
              weekChoice: val === "" ? "all" : Number(val),
            });
          }}
          className={`h-11 min-w-0 flex-1 sm:flex-none sm:min-w-[220px] rounded-[12px] border px-3.5 text-xs font-bold sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 ${
            resolvedWeekChoice !== "all"
              ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
              : "border-[var(--control-border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface)]"
          }`}
        >
          <option value="">Pilih Minggu...</option>
          {weeks.map((w) => {
            const isRunning = currentRunningWeekIndex === w.index;
            const count = weekCounts[w.index] ?? 0;
            return (
              <option key={w.index} value={String(w.index)}>
                {w.label} ({count}){isRunning ? " · Berjalan" : ""}
              </option>
            );
          })}
        </select>
      </div>

      {/* Filter Controls: Compact 1-Row Sticky on Mobile (< 1024px) & 4-Col Bar on Desktop (>= 1024px) */}
      <div className="sticky top-[65px] lg:top-0 z-20 -mx-1 px-1 py-1 bg-[var(--background)]/90 backdrop-blur-md transition-all">
        {/* Mobile Sticky Bar (< 1024px) */}
        <div className="flex lg:hidden items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--card)] p-2 shadow-xs max-h-[60px]">
          <input
            id="flt-search-mobile"
            type="search"
            aria-label="Cari merchant atau catatan"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Cari merchant/catatan..."
            className="h-11 min-w-0 flex-1 rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          />
          <Button
            variant="secondary"
            onClick={openFilterSheet}
            aria-label="Buka filter transaksi"
            className="h-11 shrink-0 rounded-[12px] px-3.5 text-xs font-bold gap-1.5"
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Filter</span>
            {activeModalFilterCount > 0 && (
              <Badge tone="primary" className="px-1.5 py-0 text-[11px]">
                {activeModalFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {/* Desktop 4-Column Bar (>= 1024px) */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-xs">
          <div className="space-y-1.5">
            <label
              htmlFor="flt-search"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Cari Merchant / Catatan
            </label>
            <input
              id="flt-search"
              type="search"
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              placeholder="Ketik nama toko..."
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-wallet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Dompet
            </label>
            <select
              id="flt-wallet"
              value={filters.walletFilter}
              onChange={(e) => onFiltersChange({ ...filters, walletFilter: e.target.value })}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="all">Semua Dompet</option>
              {data.wallets.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-type"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Tipe Transaksi
            </label>
            <select
              id="flt-type"
              value={filters.typeFilter}
              onChange={(e) => onFiltersChange({ ...filters, typeFilter: e.target.value })}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="all">Semua Tipe</option>
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
              <option value="transfer">Transfer</option>
              <option value="settlement">Pembayaran Tagihan</option>
              <option value="debt_collection">Penerimaan Piutang</option>
              <option value="loan_disbursement">Pencairan Pinjaman</option>
              <option value="debt_disbursement">Pemberian Pinjaman</option>
              <option value="adjustment">Penyesuaian Saldo</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-cat"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Kategori
            </label>
            <select
              id="flt-cat"
              value={filters.categoryFilter}
              onChange={(e) => onFiltersChange({ ...filters, categoryFilter: e.target.value })}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="all">Semua Kategori</option>
              {filterCategoryOptions.map((catName) => (
                <option key={catName} value={catName}>
                  {catName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Chart + Category Breakdown: collapsible on mobile, always open on desktop */}
      <button
        type="button"
        aria-expanded={insightsOpen}
        aria-controls="tx-insights"
        onClick={() => setInsightsOpen((v) => !v)}
        className="flex lg:hidden min-h-[44px] w-full items-center justify-between gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--card)] px-4 text-left"
      >
        <span className="text-sm font-bold text-[var(--foreground)]">Grafik & Kategori</span>
        <span aria-hidden="true" className="text-xs font-semibold text-[var(--primary)]">
          {insightsOpen ? "▲" : "▼"}
        </span>
      </button>
      <div
        id="tx-insights"
        className={`${insightsOpen ? "grid" : "hidden lg:grid"} grid-cols-1 gap-4 lg:grid-cols-12`}
      >
        <Card className="space-y-3 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[var(--foreground)]">
                Bagaimana arus kas harian pada periode ini?
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-4 text-xs font-semibold text-[var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-[var(--chart-income)]"
                    aria-hidden="true"
                  />
                  Pemasukan
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-[var(--chart-expense)]"
                    aria-hidden="true"
                  />
                  Pengeluaran
                </span>
              </div>
            </div>
            <label className="inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={filters.hidePayday}
                onChange={(e) => onFiltersChange({ ...filters, hidePayday: e.target.checked })}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Sembunyikan Gajian (tgl {data.settings.gajianStartDay})
            </label>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={Math.max(0, Math.ceil(chartData.length / 7) - 1)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    isMasked
                      ? "•••"
                      : formatCompactRupiah(v).replace("Rp\u00A0", "").replace("Rp", "")
                  }
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatRupiah(value, isMasked),
                    name === "income" ? "Pemasukan" : "Pengeluaran",
                  ]}
                  labelFormatter={(label, payload) => {
                    const rowDate = (payload?.[0] as { payload?: { date?: string } } | undefined)
                      ?.payload?.date;
                    return rowDate ? formatShortDate(rowDate) : `Tanggal ${String(label)}`;
                  }}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "10px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="space-y-3 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[var(--foreground)]">
              Pengeluaran per Kategori
            </h2>
            <button
              type="button"
              onClick={onOpenBudget}
              className="inline-flex min-h-[44px] items-center px-1 text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              Atur di Anggaran
            </button>
          </div>
          {data.categoryTotals.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Belum ada pengeluaran tercatat di periode ini.
            </p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {data.categoryTotals.map((cat) => {
                const budget = budgetByCategory.get(cat.category);
                return (
                  <div
                    key={cat.category}
                    className="space-y-1.5 border-b border-[var(--border)] pb-2.5 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-semibold text-[var(--foreground)]">
                        {cat.category}
                      </span>
                      <span className="tabular-nums font-bold text-[var(--foreground)]">
                        {formatRupiah(cat.total, isMasked)}
                      </span>
                    </div>
                    {budget && (
                      <div className="space-y-1">
                        <ProgressBar
                          value={budget.percentUsed}
                          tone={
                            budget.status === "over"
                              ? "danger"
                              : budget.status === "warning"
                                ? "highlight"
                                : "primary"
                          }
                          label={`Anggaran ${cat.category}`}
                        />
                        <p className="tabular-nums text-xs text-[var(--muted-foreground)]">
                          Limit {formatRupiah(budget.limitAmount, isMasked)} ({budget.percentUsed}%)
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Transaction List */}
      {data.transactions.length === 0 ? (
        <StateView
          kind="empty"
          icon={<TransactionsIcon className="w-6 h-6" />}
          title="Belum Ada Transaksi di Periode Ini"
          description="Catat pengeluaran, pemasukan, atau transfer pertama Anda untuk periode ini."
          actionLabel="Catat Transaksi Pertama"
          onAction={onAddTransaction}
        />
      ) : txListQuery.isPending ? (
        <StateView
          kind="loading"
          title="Memuat daftar transaksi..."
          description="Mengambil mutasi sesuai filter periode."
        />
      ) : txListQuery.error ? (
        <StateView
          kind="error"
          title="Gagal memuat daftar transaksi"
          description={
            txListQuery.error instanceof Error
              ? txListQuery.error.message
              : "Terjadi kendala saat mengambil daftar transaksi."
          }
          actionLabel="Coba Lagi"
          onAction={() => txListQuery.refetch()}
        />
      ) : groupedByDay.length === 0 ? (
        <StateView
          kind={!hasActiveFilter && resolvedWeekChoice === "all" ? "empty" : "filtered-empty"}
          icon={<TransactionsIcon className="w-6 h-6" />}
          title={
            !hasActiveFilter && resolvedWeekChoice === "all"
              ? "Belum Ada Transaksi di Periode Ini"
              : resolvedWeekChoice !== "all"
                ? `Belum ada transaksi di ${weeks.find((w) => w.index === resolvedWeekChoice)?.label ?? "minggu ini"}`
                : "Tidak ada transaksi yang cocok dengan filter"
          }
          description={
            !hasActiveFilter && resolvedWeekChoice === "all"
              ? "Mulai catat transaksi pertama Anda untuk melihat laju cashflow dan sisa jatah belanja harian."
              : resolvedWeekChoice !== "all"
                ? "Anda bisa kembali melihat seluruh transaksi siklus ini atau mencatat transaksi baru."
                : "Ubah kata kunci pencarian atau reset filter untuk melihat semua transaksi."
          }
          actionLabel={
            !hasActiveFilter && resolvedWeekChoice === "all"
              ? "Catat Transaksi Pertama"
              : resolvedWeekChoice !== "all"
                ? "Tampilkan Semua Transaksi Siklus Ini"
                : hasActiveFilter
                  ? "Reset Filter"
                  : undefined
          }
          onAction={
            !hasActiveFilter && resolvedWeekChoice === "all"
              ? onAddTransaction
              : resolvedWeekChoice !== "all"
                ? () => onFiltersChange({ ...filters, weekChoice: "all" })
                : hasActiveFilter
                  ? resetFilters
                  : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Desktop View Switcher & Bulk Action Bar */}
          <div className="hidden md:flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1.5">
                  <span className="text-xs font-bold text-[var(--foreground)] tabular-nums">
                    {selectedIds.length} transaksi dipilih
                  </span>
                  <Button
                    variant="danger"
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    disabled={bulkDeleteMutation.isPending}
                    className="min-h-[36px] px-3 py-1 text-xs"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    <span>Hapus Terpilih ({selectedIds.length})</span>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setSelectedIds([])}
                    className="min-h-[36px] px-2.5 py-1 text-xs"
                  >
                    Batal Pilih
                  </Button>
                </div>
              ) : (
                <span className="text-xs font-semibold text-[var(--muted-foreground)] tabular-nums">
                  {countLabel}
                </span>
              )}
            </div>

            <fieldset className="inline-flex items-center rounded-[12px] border border-[var(--control-border)] bg-[var(--card)] p-1 m-0">
              <legend className="sr-only">Mode tampilan daftar transaksi</legend>
              <button
                type="button"
                onClick={() => setViewMode("card")}
                aria-pressed={viewMode === "card"}
                className={`min-h-[36px] rounded-[8px] px-3 text-xs font-bold transition-colors ${
                  viewMode === "card"
                    ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                Kartu
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                className={`min-h-[36px] rounded-[8px] px-3 text-xs font-bold transition-colors ${
                  viewMode === "table"
                    ? "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                Tabel
              </button>
            </fieldset>
          </div>

          {/* Desktop Compact Table Mode */}
          {viewMode === "table" && (
            <div className="hidden md:block">
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                        <th className="w-10 px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            aria-label="Pilih semua transaksi yang tampil"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAll}
                            className="h-4 w-4 accent-[var(--primary)]"
                          />
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">Tanggal</th>
                        <th className="px-3 py-3">Merchant / Catatan</th>
                        <th className="px-3 py-3 whitespace-nowrap">Kategori</th>
                        <th className="px-3 py-3 whitespace-nowrap">Dompet</th>
                        <th className="px-3 py-3 whitespace-nowrap">Status</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Nominal</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredTransactions.map((tx) => {
                        const isEditable =
                          tx.type === "expense" || tx.type === "income" || tx.type === "transfer";
                        const canSplitPay =
                          tx.walletType === "credit_card" &&
                          tx.type === "expense" &&
                          !tx.isConvertedToInstallment;
                        const isChecked = selectedIds.includes(tx.id);
                        const titleText =
                          tx.type === "transfer" && tx.toWalletName
                            ? `${tx.walletName} → ${tx.toWalletName}`
                            : tx.merchant;
                        const isInflow =
                          tx.type === "income" ||
                          tx.type === "debt_collection" ||
                          tx.type === "loan_disbursement";
                        const amountDisplay = isMasked
                          ? formatRupiah(tx.amount, true)
                          : isInflow
                            ? `+${formatRupiah(tx.amount)}`
                            : tx.type === "adjustment"
                              ? tx.amount >= 0
                                ? `+${formatRupiah(tx.amount)}`
                                : formatRupiah(tx.amount)
                              : formatRupiah(tx.amount);
                        const amountColor = isMasked
                          ? "text-[var(--foreground)]"
                          : isInflow
                            ? "text-[var(--chart-income)]"
                            : "text-[var(--foreground)]";

                        return (
                          <tr
                            key={tx.id}
                            className={`transition-colors hover:bg-[var(--surface)]/60 ${
                              isChecked ? "bg-[var(--primary)]/5" : ""
                            }`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Pilih transaksi ${titleText}`}
                                checked={isChecked}
                                onChange={() => toggleSelectOne(tx.id)}
                                className="h-4 w-4 accent-[var(--primary)]"
                              />
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs font-medium text-[var(--muted-foreground)] tabular-nums">
                              {formatShortDate(tx.transactionDate)}
                            </td>
                            <td className="px-3 py-2.5 max-w-[280px]">
                              <div className="font-bold text-[var(--foreground)] truncate">
                                {titleText}
                              </div>
                              {tx.note && !isAutoNote(tx) && (
                                <p className="text-xs text-[var(--muted-foreground)] truncate">
                                  {tx.note}
                                </p>
                              )}
                              {tx.splits && tx.splits.length > 0 && (
                                <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                                  Split: {tx.splits.map((s) => s.category).join(", ")}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs font-semibold text-[var(--foreground)]">
                              {tx.type === "transfer" ? "Transfer" : tx.category}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <Badge tone="neutral">{tx.walletName}</Badge>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <div className="flex flex-wrap items-center gap-1">
                                {tx.type === "transfer" && tx.toWalletName && (
                                  <Badge tone="primary" className="whitespace-nowrap">
                                    Transfer
                                  </Badge>
                                )}
                                {tx.type === "settlement" && (
                                  <Badge tone="soft" className="whitespace-nowrap">
                                    Pembayaran Tagihan
                                  </Badge>
                                )}
                                {tx.type === "adjustment" && (
                                  <Badge tone="neutral" className="whitespace-nowrap">
                                    Penyesuaian
                                  </Badge>
                                )}
                                {tx.isUnbilledCc && (
                                  <Badge tone="highlight" className="whitespace-nowrap">
                                    Belum Dicetak
                                  </Badge>
                                )}
                                {tx.isConvertedToInstallment && (
                                  <Badge tone="soft" className="whitespace-nowrap">
                                    Sudah Jadi Cicilan
                                  </Badge>
                                )}
                                {tx.splits && tx.splits.length > 0 && (
                                  <Badge tone="primary" className="whitespace-nowrap">
                                    Split ({tx.splits.length})
                                  </Badge>
                                )}
                                {tx.type !== "transfer" &&
                                  tx.type !== "settlement" &&
                                  tx.type !== "adjustment" &&
                                  !tx.isUnbilledCc &&
                                  !tx.isConvertedToInstallment &&
                                  !(tx.splits && tx.splits.length > 0) && (
                                    <span className="text-xs text-[var(--muted-foreground)]">
                                      —
                                    </span>
                                  )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <div className={`tabular-nums font-bold ${amountColor}`}>
                                {amountDisplay}
                              </div>
                              {tx.type === "transfer" && tx.linkedFeeTransaction && (
                                <div className="tabular-nums text-[11px] text-[var(--muted-foreground)]">
                                  +Admin {formatRupiah(tx.linkedFeeTransaction.amount, isMasked)}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                {canSplitPay && (
                                  <button
                                    type="button"
                                    onClick={() => onSplitPay(tx)}
                                    aria-label={`Ubah ${tx.merchant} jadi cicilan bulanan`}
                                    title="Ubah Jadi Cicilan"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                                  >
                                    <SplitPayIcon className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isEditable && (
                                  <button
                                    type="button"
                                    onClick={() => onEditTransaction(tx)}
                                    aria-label={`Edit ${tx.merchant}`}
                                    title="Edit"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                                  >
                                    <EditIcon className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTxId(tx.id)}
                                  aria-label={`Hapus ${tx.merchant}`}
                                  title="Hapus transaksi"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--destructive)] hover:bg-[var(--surface)]"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* Card View (Always on Mobile, or Desktop when viewMode === "card") */}
          <div className={viewMode === "table" ? "space-y-4 md:hidden" : "space-y-4"}>
            {groupedByDay.map(([day, rows]) => {
              const dayExpense = dayOutflow(rows);

              return (
                <Card key={day} className="p-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold">
                    <span className="uppercase tracking-wide text-[var(--muted-foreground)]">
                      {formatDayHeader(day)}
                    </span>
                    {dayExpense > 0 && (
                      <span className="tabular-nums font-mono text-[var(--muted-foreground)]">
                        {isMasked ? formatRupiah(dayExpense, true) : `−${formatRupiah(dayExpense)}`}
                      </span>
                    )}
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {rows.map((tx) => {
                      const isIncome = tx.type === "income";
                      const isInflow =
                        isIncome ||
                        tx.type === "debt_collection" ||
                        tx.type === "loan_disbursement";
                      const isTransfer = tx.type === "transfer";
                      const isAdjustment = tx.type === "adjustment";
                      const isEditable = isIncome || isTransfer || tx.type === "expense";
                      const isDeletableDirect = !isEditable;
                      const isConfirmingDelete = confirmDeleteTxId === tx.id;
                      const isSplit = Boolean(tx.splits && tx.splits.length > 0);
                      const adminFee = isTransfer ? (tx.linkedFeeTransaction?.amount ?? 0) : 0;

                      const iconSymbol = isInflow
                        ? "↓"
                        : isTransfer
                          ? "⇄"
                          : isAdjustment
                            ? "±"
                            : "↑";
                      const iconClass = isMasked
                        ? "bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]"
                        : isInflow
                          ? "bg-[var(--chart-income)]/15 text-[var(--chart-income)]"
                          : isTransfer
                            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                            : isAdjustment
                              ? "bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]"
                              : "bg-[var(--destructive)]/15 text-[var(--destructive)]";

                      const transferRoute = `${tx.walletName} → ${tx.toWalletName}`;
                      const titleText =
                        isTransfer && tx.toWalletName
                          ? tx.merchant &&
                            tx.merchant !== `Transfer ke ${tx.toWalletName}` &&
                            tx.merchant !== transferRoute
                            ? tx.merchant
                            : transferRoute
                          : tx.merchant || tx.category;

                      const subText = isTransfer
                        ? tx.toWalletName && titleText !== transferRoute
                          ? `Transfer · ${transferRoute}`
                          : "Transfer"
                        : `${tx.category} · ${tx.walletName}`;
                      const visibleNote = isAutoNote(tx) ? null : tx.note;

                      const amountText = isMasked
                        ? formatRupiah(tx.amount, true)
                        : isInflow
                          ? `+${formatRupiah(tx.amount)}`
                          : isTransfer
                            ? formatRupiah(tx.amount)
                            : isAdjustment
                              ? tx.amount > 0
                                ? `+${formatRupiah(tx.amount)}`
                                : formatRupiah(tx.amount)
                              : `−${formatRupiah(tx.amount)}`;

                      const amountColor = isMasked
                        ? "text-[var(--muted-foreground)]"
                        : isInflow
                          ? "text-[var(--chart-income)]"
                          : isTransfer || isAdjustment
                            ? "text-[var(--foreground)]"
                            : "text-[var(--destructive)]";

                      const rowCore = (
                        <>
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div
                              aria-hidden="true"
                              className={`h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 text-sm font-bold ${iconClass}`}
                            >
                              {iconSymbol}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                                {titleText}
                              </p>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p className="text-xs text-[var(--muted-foreground)] truncate">
                                  {subText}
                                </p>
                                {isSplit && (
                                  <span className="shrink-0 rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--primary)]">
                                    Split ({tx.splits?.length})
                                  </span>
                                )}
                                {tx.isConvertedToInstallment && (
                                  <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                                    Cicilan
                                  </span>
                                )}
                              </div>
                              {visibleNote && (
                                <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                                  {visibleNote}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <p
                              className={`tabular-nums font-mono text-sm font-bold whitespace-nowrap ${amountColor}`}
                            >
                              {amountText}
                            </p>
                            {adminFee > 0 && (
                              <p className="tabular-nums text-[10px] font-medium text-[var(--muted-foreground)] whitespace-nowrap">
                                +Admin {formatRupiah(adminFee, isMasked)}
                              </p>
                            )}
                          </div>
                        </>
                      );

                      return (
                        <div
                          key={tx.id}
                          className="px-3.5 py-2 sm:px-4 transition-colors hover:bg-[var(--surface)]/60"
                        >
                          <div className="flex items-center gap-2 min-h-[44px]">
                            {isEditable ? (
                              <button
                                type="button"
                                onClick={() => onEditTransaction(tx)}
                                aria-label={`Edit transaksi ${titleText}`}
                                className="flex min-w-0 flex-1 items-center justify-between gap-2.5 min-h-[44px] text-left rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                              >
                                {rowCore}
                              </button>
                            ) : (
                              <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5 min-h-[44px]">
                                {rowCore}
                              </div>
                            )}

                            {isDeletableDirect && !isConfirmingDelete && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTxId(tx.id)}
                                aria-label={`Hapus ${tx.merchant}`}
                                title="Hapus transaksi"
                                className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--control-border)] text-[var(--destructive)] hover:bg-[var(--surface)] transition-colors"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {isDeletableDirect && isConfirmingDelete && (
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <Button
                                variant="danger"
                                disabled={deleteTxMutation.isPending}
                                onClick={() => deleteTxMutation.mutate(tx.id)}
                                className="min-h-[36px] px-3 text-xs"
                              >
                                Konfirmasi Hapus
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => setConfirmDeleteTxId(null)}
                                className="min-h-[36px] px-3 text-xs"
                              >
                                Batal
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--muted-foreground)]">
            <span className="tabular-nums">{countLabel}</span>
            {txListQuery.hasNextPage && (
              <Button
                variant="secondary"
                disabled={txListQuery.isFetchingNextPage}
                onClick={() => txListQuery.fetchNextPage()}
              >
                {txListQuery.isFetchingNextPage ? "Memuat..." : "Muat Lebih Banyak"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Filter ModalSheet (< 1024px) */}
      <ModalSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter Transaksi"
        subtitle="Saring daftar mutasi berdasarkan dompet, tipe, atau kategori."
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setDraftWallet("all");
                setDraftType("all");
                setDraftCategory("all");
                onFiltersChange({
                  ...filters,
                  walletFilter: "all",
                  typeFilter: "all",
                  categoryFilter: "all",
                });
                setFilterSheetOpen(false);
              }}
            >
              Reset Filter
            </Button>
            <Button
              onClick={() => {
                onFiltersChange({
                  ...filters,
                  walletFilter: draftWallet,
                  typeFilter: draftType,
                  categoryFilter: draftCategory,
                });
                setFilterSheetOpen(false);
              }}
            >
              Terapkan
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="flt-wallet-sheet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Dompet
            </label>
            <select
              id="flt-wallet-sheet"
              value={draftWallet}
              onChange={(e) => setDraftWallet(e.target.value)}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="all">Semua Dompet</option>
              {data.wallets.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-type-sheet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Tipe Transaksi
            </label>
            <select
              id="flt-type-sheet"
              value={draftType}
              onChange={(e) => setDraftType(e.target.value)}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="all">Semua Tipe</option>
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
              <option value="transfer">Transfer</option>
              <option value="settlement">Pembayaran Tagihan</option>
              <option value="debt_collection">Penerimaan Piutang</option>
              <option value="loan_disbursement">Pencairan Pinjaman</option>
              <option value="debt_disbursement">Pemberian Pinjaman</option>
              <option value="adjustment">Penyesuaian Saldo</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-cat-sheet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Kategori
            </label>
            <select
              id="flt-cat-sheet"
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              className="h-11 w-full rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="all">Semua Kategori</option>
              {filterCategoryOptions.map((catName) => (
                <option key={catName} value={catName}>
                  {catName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ModalSheet>

      {/* Single Row Delete Confirmation Modal for Table View */}
      <ModalSheet
        open={confirmDeleteTxId !== null && viewMode === "table"}
        onClose={() => setConfirmDeleteTxId(null)}
        title="Hapus Transaksi?"
        subtitle="Tindakan ini akan menghapus mutasi yang dipilih dan menghitung ulang saldo dompet."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteTxId(null)}
              disabled={deleteTxMutation.isPending}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={deleteTxMutation.isPending}
              onClick={() => {
                if (confirmDeleteTxId !== null) {
                  deleteTxMutation.mutate(confirmDeleteTxId);
                }
              }}
            >
              {deleteTxMutation.isPending ? "Menghapus..." : "Ya, Hapus"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--foreground)]">
          Apakah Anda yakin ingin menghapus transaksi ini secara permanen?
        </p>
      </ModalSheet>

      {/* Bulk Delete Confirmation Modal */}
      <ModalSheet
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        title={`Hapus ${selectedIds.length} Transaksi Terpilih?`}
        subtitle="Penghapusan massal akan memproses setiap transaksi terpilih secara berurutan."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setBulkDeleteConfirmOpen(false)}
              disabled={bulkDeleteMutation.isPending}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={bulkDeleteMutation.isPending || selectedIds.length === 0}
              onClick={() => bulkDeleteMutation.mutate(selectedIds)}
            >
              {bulkDeleteMutation.isPending
                ? "Menghapus..."
                : `Ya, Hapus ${selectedIds.length} Transaksi`}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--foreground)]">
          Apakah Anda yakin ingin menghapus <strong>{selectedIds.length}</strong> transaksi yang
          dipilih? Saldo dompet dan progres anggaran akan otomatis disesuaikan.
        </p>
      </ModalSheet>
    </div>
  );
}
