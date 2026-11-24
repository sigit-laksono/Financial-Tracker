import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { periodForDate } from "../../../shared/src/dates";
import { api, ApiError, type DashboardDto, type TransactionDto } from "../lib/api";
import type { TransactionFiltersState } from "../lib/filters";
import { budgetKeys } from "../lib/queryKeys";
import {
  buildWeekSlices,
  formatCompactRupiah,
  formatDayHeader,
  formatDigitsInput,
  formatPeriodRangeLabel,
  formatRupiah,
  formatShortDate,
  jakartaToday,
  parsePositiveInt,
  shiftMonth,
} from "../lib/format";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  SplitPayIcon,
  TransactionsIcon,
  TransferIcon,
  TrashIcon,
} from "../components/Icons";
import { Badge, Button, Card, ProgressBar, StateView } from "../components/UI";

export function TransactionsPage({
  data,
  period,
  filters,
  onFiltersChange,
  onPeriodChange,
  onEditTransaction,
  onSplitPay,
  onAddTransaction,
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
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
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

  const weekCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const w of weeks) {
      counts[w.index] = 0;
    }
    for (const tx of data.transactions) {
      for (const w of weeks) {
        if (tx.transactionDate >= w.start && tx.transactionDate <= w.end) {
          counts[w.index] = (counts[w.index] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, [data.transactions, weeks]);

  const [editingBudgetCat, setEditingBudgetCat] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetScope, setBudgetScope] = useState<"default" | "override">("default");
  const [budgetError, setBudgetError] = useState("");
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | null>(null);

  const gajianPeriod = useMemo(
    () =>
      data.cycle === "gajian"
        ? data.selectedPeriod
        : periodForDate(
            data.periodEnd,
            "gajian",
            data.settings.gajianStartDay,
            data.settings.cardCutoffDay,
          ),
    [
      data.cycle,
      data.selectedPeriod,
      data.periodEnd,
      data.settings.gajianStartDay,
      data.settings.cardCutoffDay,
    ],
  );

  const budgetMutation = useMutation({
    mutationFn: ({
      category,
      limitAmount,
      targetPeriod,
    }: {
      category: string;
      limitAmount: number;
      targetPeriod: string;
    }) => api.upsertBudget({ category, period: targetPeriod, limitAmount }),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      setEditingBudgetCat(null);
      setBudgetError("");
      onToast(
        vars.targetPeriod === "default"
          ? "Template batas anggaran diperbarui"
          : `Override anggaran periode ${vars.targetPeriod} disimpan`,
      );
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyimpan batas anggaran.";
      setBudgetError(msg);
      onToast(msg);
    },
  });

  const resetOverrideMutation = useMutation({
    mutationFn: (id: number) => api.deleteBudget(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      onToast("Override periode dihapus, kembali ke template default");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus override anggaran.");
    },
  });

  const deleteTxMutation = useMutation({
    mutationFn: (id: number) => api.deleteTransaction(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summary() });
      setConfirmDeleteTxId(null);
      onToast("Transaksi dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus transaksi.");
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

  const filteredTransactions = useMemo(() => {
    const raw =
      txListQuery.data?.pages
        .flatMap((page) => page?.items ?? [])
        .filter((tx): tx is TransactionDto => Boolean(tx?.transactionDate)) ?? [];

    if (filters.typeFilter === "all") {
      const transferGroupIds = new Set(
        raw.filter((t) => t.type === "transfer" && t.transferGroupId).map((t) => t.transferGroupId),
      );
      return raw.filter(
        (tx) =>
          !(
            tx.type === "expense" &&
            tx.category === "Biaya Bank" &&
            tx.transferGroupId &&
            transferGroupIds.has(tx.transferGroupId)
          ),
      );
    }
    return raw;
  }, [txListQuery.data, filters.typeFilter]);
  const totalFilteredCount = txListQuery.data?.pages[0]?.totalCount ?? filteredTransactions.length;

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Transaksi & Anggaran</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Filter mingguan, grafik arus kas harian, dan batas anggaran kategori.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center justify-between gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1">
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

          <Button onClick={onAddTransaction}>Catat Transaksi</Button>
        </div>
      </div>

      {/* Week Slice Pills */}
      <fieldset className="flex flex-wrap gap-2 border-0 m-0 p-0">
        <legend className="sr-only">Filter minggu</legend>
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, weekChoice: "all" })}
          className={`min-h-[42px] inline-flex items-center gap-1.5 rounded-[12px] border px-3.5 text-xs font-bold sm:text-sm transition-all ${
            resolvedWeekChoice === "all"
              ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
              : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <span>Semua</span>
          <span
            className={`tabular-nums text-xs font-semibold ${
              resolvedWeekChoice === "all" ? "opacity-90" : "text-neutral-400"
            }`}
          >
            ({data.transactions.length})
          </span>
        </button>
        {weeks.map((w) => {
          const isSelected = resolvedWeekChoice === w.index;
          const isRunning = currentRunningWeekIndex === w.index;
          const count = weekCounts[w.index] ?? 0;
          return (
            <button
              key={w.index}
              type="button"
              onClick={() => onFiltersChange({ ...filters, weekChoice: w.index })}
              className={`min-h-[42px] inline-flex items-center gap-1.5 rounded-[12px] border px-3.5 text-xs font-bold sm:text-sm transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                  : "border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <span>{w.label}</span>
              <span
                className={`tabular-nums text-xs font-semibold ${
                  isSelected ? "opacity-90" : "text-neutral-400"
                }`}
              >
                ({count})
              </span>
              {isRunning && (
                <span
                  title="Minggu berjalan"
                  className={`h-2 w-2 rounded-full ${isSelected ? "bg-white" : "bg-[var(--primary)]"}`}
                />
              )}
            </button>
          );
        })}
      </fieldset>

      {/* Filter Controls (Sticky on Mobile) */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-1 bg-[var(--background)]/90 backdrop-blur-md transition-all">
        <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 sm:p-5 shadow-xs grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label
              htmlFor="flt-search"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Cari Merchant / Catatan
            </label>
            <input
              id="flt-search"
              type="search"
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              placeholder="Ketik nama toko..."
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-wallet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Dompet
            </label>
            <select
              id="flt-wallet"
              value={filters.walletFilter}
              onChange={(e) => onFiltersChange({ ...filters, walletFilter: e.target.value })}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
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
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Tipe Transaksi
            </label>
            <select
              id="flt-type"
              value={filters.typeFilter}
              onChange={(e) => onFiltersChange({ ...filters, typeFilter: e.target.value })}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            >
              <option value="all">Semua Tipe</option>
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
              <option value="transfer">Transfer</option>
              <option value="settlement">Pembayaran Tagihan</option>
              <option value="adjustment">Penyesuaian Saldo</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="flt-cat"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400"
            >
              Kategori
            </label>
            <select
              id="flt-cat"
              value={filters.categoryFilter}
              onChange={(e) => onFiltersChange({ ...filters, categoryFilter: e.target.value })}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
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

      {/* Chart + Category Budget Breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="space-y-3 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[var(--foreground)]">
              Bagaimana arus kas harian pada periode ini?
            </h2>
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
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis
                  tickFormatter={(v: number) => formatCompactRupiah(v).replace("Rp", "")}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatRupiah(value),
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
          <h2 className="text-base font-bold text-[var(--foreground)]">
            Pengeluaran per Kategori & Budget
          </h2>
          {data.categoryTotals.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Belum ada pengeluaran tercatat di periode ini.
            </p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {data.categoryTotals.map((cat) => {
                const budget = budgetByCategory.get(cat.category);
                const isEditing = editingBudgetCat === cat.category;
                return (
                  <div
                    key={cat.category}
                    className="space-y-1.5 border-b border-[var(--border)] pb-2.5 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[var(--foreground)]">
                          {cat.category}
                        </span>
                        {budget?.isOverride && <Badge tone="soft">Khusus {budget.period}</Badge>}
                      </div>
                      <span className="tabular-nums font-bold text-[var(--foreground)]">
                        {formatRupiah(cat.total)}
                      </span>
                    </div>

                    {budget ? (
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
                          label={`Budget ${cat.category}`}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                          <span className="tabular-nums">
                            Limit {formatRupiah(budget.limitAmount)} ({budget.percentUsed}%)
                          </span>
                          <div className="flex items-center gap-2">
                            {budget.isOverride && (
                              <button
                                type="button"
                                onClick={() => resetOverrideMutation.mutate(budget.id)}
                                className="inline-flex min-h-[44px] items-center px-1.5 font-semibold text-[var(--destructive)] hover:underline"
                              >
                                Hapus Override
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingBudgetCat(cat.category);
                                setBudgetInput(budget.limitAmount.toLocaleString("id-ID"));
                                setBudgetScope(budget.isOverride ? "override" : "default");
                                setBudgetError("");
                              }}
                              className="inline-flex min-h-[44px] items-center px-1.5 font-semibold text-[var(--primary)] hover:underline"
                            >
                              Ubah Limit
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBudgetCat(cat.category);
                          setBudgetInput("");
                          setBudgetScope("default");
                          setBudgetError("");
                        }}
                        className="inline-flex min-h-[44px] items-center px-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                      >
                        Atur Batas Budget
                      </button>
                    )}

                    {isEditing && (
                      <div className="mt-1 space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2.5">
                        <div className="flex flex-wrap gap-2">
                          <label className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold">
                            <input
                              type="radio"
                              name={`scope-${cat.category}`}
                              checked={budgetScope === "default"}
                              onChange={() => setBudgetScope("default")}
                              className="accent-[var(--primary)]"
                            />
                            Template tiap bulan
                          </label>
                          <label className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold">
                            <input
                              type="radio"
                              name={`scope-${cat.category}`}
                              checked={budgetScope === "override"}
                              onChange={() => setBudgetScope("override")}
                              className="accent-[var(--primary)]"
                            />
                            Khusus periode {gajianPeriod}
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Limit budget ${cat.category}`}
                            value={budgetInput}
                            onChange={(e) => {
                              setBudgetInput(formatDigitsInput(e.target.value));
                              setBudgetError("");
                            }}
                            placeholder="Nominal limit"
                            className="tabular-nums min-h-[44px] flex-1 rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-2.5 text-sm"
                          />
                          <Button
                            disabled={budgetMutation.isPending}
                            onClick={() => {
                              const limitAmount = parsePositiveInt(budgetInput);
                              if (limitAmount <= 0) {
                                setBudgetError("Masukkan nominal limit lebih dari Rp0.");
                                return;
                              }
                              budgetMutation.mutate({
                                category: cat.category,
                                limitAmount,
                                targetPeriod: budgetScope === "override" ? gajianPeriod : "default",
                              });
                            }}
                            className="min-h-[44px] px-3 text-xs"
                          >
                            Simpan
                          </Button>
                        </div>
                        {budgetError && (
                          <p role="alert" className="text-xs text-[var(--destructive)]">
                            {budgetError}
                          </p>
                        )}
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
          {groupedByDay.map(([day, rows]) => (
            <Card key={day} className="p-0 overflow-hidden">
              <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                {formatDayHeader(day)}
              </div>
              <div className="divide-y divide-[var(--border)]">
                {rows.map((tx) => {
                  const isEditable =
                    tx.type === "expense" || tx.type === "income" || tx.type === "transfer";
                  const isDeletableDirect = !isEditable;
                  const isConfirmingDelete = confirmDeleteTxId === tx.id;
                  const canSplitPay =
                    tx.walletType === "credit_card" &&
                    tx.type === "expense" &&
                    !tx.isConvertedToInstallment;
                  return (
                    <div
                      key={tx.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-[var(--foreground)]">
                            {tx.type === "transfer" && tx.toWalletName
                              ? `${tx.walletName} → ${tx.toWalletName}`
                              : tx.merchant}
                          </span>
                          <Badge tone="neutral">{tx.walletName}</Badge>
                          {tx.type === "transfer" && tx.toWalletName && (
                            <Badge tone="primary">
                              <TransferIcon className="w-3 h-3" />
                              Transfer
                            </Badge>
                          )}
                          {tx.type === "settlement" && (
                            <Badge tone="soft">Pembayaran Tagihan</Badge>
                          )}
                          {tx.type === "adjustment" && <Badge tone="neutral">Penyesuaian</Badge>}
                          {tx.isUnbilledCc && (
                            <Badge tone="highlight">Tagihan Berjalan (Belum Dicetak)</Badge>
                          )}
                          {tx.isConvertedToInstallment && (
                            <Badge tone="soft">Sudah Jadi Cicilan</Badge>
                          )}
                          {tx.splits && tx.splits.length > 0 && (
                            <Badge tone="primary">Split ({tx.splits.length})</Badge>
                          )}
                        </div>

                        <p className="text-xs text-[var(--muted-foreground)]">
                          {tx.type === "transfer" ? (
                            <>
                              {tx.merchant &&
                              tx.merchant !== `Transfer ke ${tx.toWalletName}` &&
                              tx.merchant !== `${tx.walletName} → ${tx.toWalletName}`
                                ? `${tx.merchant} · `
                                : ""}
                              {tx.linkedFeeTransaction
                                ? `Biaya Admin ${formatRupiah(tx.linkedFeeTransaction.amount)}`
                                : "Bebas Biaya Admin"}
                              {tx.note ? ` · ${tx.note}` : ""}
                            </>
                          ) : (
                            <>
                              {tx.category}
                              {tx.note ? ` · ${tx.note}` : ""}
                            </>
                          )}
                        </p>

                        {/* Split Category Badges */}
                        {tx.splits && tx.splits.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {tx.splits.map((s) => (
                              <span
                                key={s.id ?? `${s.category}-${s.amount}-${s.note ?? ""}`}
                                className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]"
                              >
                                <strong className="text-[var(--foreground)] mr-1">
                                  {s.category}:
                                </strong>
                                {formatRupiah(s.amount)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex flex-col items-end">
                          <span
                            className={`tabular-nums text-sm font-bold ${
                              tx.type === "income"
                                ? "text-[var(--chart-income)]"
                                : tx.type === "transfer"
                                  ? "text-[var(--foreground)]"
                                  : "text-[var(--foreground)]"
                            }`}
                          >
                            {tx.type === "income"
                              ? `+${formatRupiah(tx.amount)}`
                              : tx.type === "adjustment"
                                ? tx.amount >= 0
                                  ? `+${formatRupiah(tx.amount)}`
                                  : formatRupiah(tx.amount)
                                : formatRupiah(tx.amount)}
                          </span>
                          {tx.type === "transfer" && tx.linkedFeeTransaction && (
                            <span className="tabular-nums text-[11px] text-[var(--muted-foreground)]">
                              (+Admin {formatRupiah(tx.linkedFeeTransaction.amount)})
                            </span>
                          )}
                        </div>

                        {canSplitPay && (
                          <button
                            type="button"
                            onClick={() => onSplitPay(tx)}
                            aria-label={`Ubah ${tx.merchant} jadi cicilan bulanan`}
                            title="Ubah Jadi Cicilan"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                          >
                            <SplitPayIcon className="w-4 h-4" />
                          </button>
                        )}
                        {isEditable && (
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            aria-label={`Edit ${tx.merchant}`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                          >
                            <EditIcon className="w-4 h-4" />
                          </button>
                        )}
                        {isDeletableDirect && !isConfirmingDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteTxId(tx.id)}
                            aria-label={`Hapus ${tx.merchant}`}
                            title="Hapus transaksi"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--destructive)] hover:bg-[var(--surface)]"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        )}
                        {isDeletableDirect && isConfirmingDelete && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="danger"
                              disabled={deleteTxMutation.isPending}
                              onClick={() => deleteTxMutation.mutate(tx.id)}
                              className="min-h-[44px] px-3 text-xs"
                            >
                              Konfirmasi Hapus
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setConfirmDeleteTxId(null)}
                              className="min-h-[44px] px-3 text-xs"
                            >
                              Batal
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--muted-foreground)]">
            <span className="tabular-nums">
              Menampilkan {filteredTransactions.length} dari {totalFilteredCount} transaksi
            </span>
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
    </div>
  );
}
