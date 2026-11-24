import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EditIcon, TrashIcon } from "../../components/Icons";
import { Badge, Button, Card } from "../../components/UI";
import {
  api,
  ApiError,
  type CategoryDto,
  type DashboardDto,
  type RecurringRuleDto,
  type WalletDto,
} from "../../lib/api";
import {
  currentPeriodForCycle,
  formatDigitsInput,
  formatRupiah,
  parsePositiveInt,
} from "../../lib/format";

function formatBudgetCategoryName(name: string) {
  if (name === "bucket:needs") return "Kebutuhan Hidup (50% Needs)";
  if (name === "bucket:wants") return "Keinginan & Hobi (30% Wants)";
  if (name === "bucket:savings") return "Tabungan & Investasi (20% Savings)";
  return name;
}

function RecurringRulesManager({
  categories,
  wallets,
  onToast,
}: {
  categories: CategoryDto[];
  wallets: WalletDto[];
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Internet");
  const [walletId, setWalletId] = useState<number>(wallets[0]?.id ?? 1);
  const [dueDay, setDueDay] = useState<number>(10);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ["recurring-rules"],
    queryFn: () => api.getRecurringRules(),
  });

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === "expense" && !c.isArchived),
    [categories],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = parsePositiveInt(amount);
      if (parsedAmount <= 0) throw new Error("Nominal tagihan harus lebih dari Rp0.");
      if (!merchant.trim()) throw new Error("Nama tagihan atau merchant wajib diisi.");
      if (dueDay < 1 || dueDay > 31) throw new Error("Tanggal jatuh tempo harus antara 1-31.");

      if (editingId) {
        return api.updateRecurringRule(editingId, {
          merchant: merchant.trim(),
          amount: parsedAmount,
          category,
          walletId,
          dueDay,
        });
      }
      return api.createRecurringRule({
        merchant: merchant.trim(),
        amount: parsedAmount,
        category,
        walletId,
        dueDay,
        isActive: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setMerchant("");
      setAmount("");
      setEditingId(null);
      setFormError("");
      onToast(
        editingId ? "Tagihan rutin berhasil diperbarui" : "Tagihan rutin berhasil ditambahkan",
      );
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Gagal menyimpan tagihan rutin.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.updateRecurringRule(id, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onToast("Status tagihan rutin diperbarui");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal memperbarui status.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteRecurringRule(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onToast("Tagihan rutin dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus tagihan.");
    },
  });

  const startEdit = (rule: RecurringRuleDto) => {
    setEditingId(rule.id);
    setMerchant(rule.merchant);
    setAmount(rule.amount.toLocaleString("id-ID"));
    setCategory(rule.category);
    setWalletId(rule.walletId);
    setDueDay(rule.dueDay);
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setMerchant("");
    setAmount("");
    setFormError("");
  };

  const rules = rulesData?.rules ?? [];

  return (
    <Card className="space-y-4 rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs">
      <div>
        <h3 className="text-base font-bold text-[var(--foreground)]">Tagihan Rutin Otomatis</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          Kelola komitmen tagihan berulang (Listrik, Internet, Langganan) yang otomatis dievaluasi
          tiap bulan.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--muted-foreground)]">Memuat tagihan rutin...</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Belum ada tagihan rutin. Tambahkan tagihan bulanan Anda di bawah.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-700 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 overflow-hidden">
          {rules.map((r) => {
            const walletName = wallets.find((w) => w.id === r.walletId)?.name ?? "Dompet";
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-bold text-[var(--foreground)]">
                      {r.merchant}
                    </strong>
                    <Badge tone="neutral" className="text-xs">
                      {r.category}
                    </Badge>
                    <Badge tone={r.isActive ? "soft" : "highlight"} className="text-xs">
                      {r.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Jatuh tempo tiap tgl <span className="font-semibold">{r.dueDay}</span> · Sumber:{" "}
                    <span className="font-semibold">{walletName}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-[var(--foreground)]">
                    {formatRupiah(r.amount)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                      className="rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1 text-xs font-semibold hover:bg-[var(--surface)]"
                    >
                      {r.isActive ? "Matikan" : "Nyalakan"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit tagihan ${r.merchant}`}
                      onClick={() => startEdit(r)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-[var(--foreground)] hover:bg-[var(--surface)]"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus tagihan ${r.merchant}`}
                      onClick={() => deleteMutation.mutate(r.id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--destructive)] hover:bg-[var(--surface)]"
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

      {/* Form Tambah/Edit Recurring Rule */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="space-y-3.5 rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 p-4 sm:p-5"
      >
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {editingId ? "Edit Tagihan Rutin" : "Tambah Tagihan Rutin Baru"}
        </h4>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="rec-merchant"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              Nama Tagihan / Layanan
            </label>
            <input
              id="rec-merchant"
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Contoh: Spotify, WiFi Indihome"
              className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="rec-amount"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              Nominal Bulanan
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400 select-none">
                Rp
              </span>
              <input
                id="rec-amount"
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(formatDigitsInput(e.target.value))}
                placeholder="150.000"
                className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="rec-cat"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              Kategori Anggaran
            </label>
            <select
              id="rec-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            >
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label
                htmlFor="rec-wallet"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Dompet Pembayar
              </label>
              <select
                id="rec-wallet"
                value={walletId}
                onChange={(e) => setWalletId(Number(e.target.value))}
                className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              >
                {wallets
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="rec-due"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Tgl Tempo (1-28)
              </label>
              <input
                id="rec-due"
                type="number"
                min={1}
                max={28}
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                className="tabular-nums w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        {formError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {formError}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={saveMutation.isPending} className="min-h-[44px] rounded-[14px] px-5 font-bold">
            {saveMutation.isPending
              ? "Menyimpan..."
              : editingId
                ? "Simpan Perubahan"
                : "Tambah Tagihan"}
          </Button>
          {editingId && (
            <Button variant="secondary" type="button" onClick={cancelEdit} className="min-h-[44px] rounded-[14px]">
              Batal
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function CycleBudgetTab({
  data,
  onToast,
}: {
  data: DashboardDto;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();

  const [grossSalary, setGrossSalary] = useState(data.settings.grossSalary.toLocaleString("id-ID"));
  const [payrollDeduction, setPayrollDeduction] = useState(
    data.settings.payrollDeduction.toLocaleString("id-ID"),
  );
  const [netSalary, setNetSalary] = useState(data.settings.netSalary.toLocaleString("id-ID"));
  const [cycleType, setCycleType] = useState<"monthly" | "gajian">(
    data.settings.gajianStartDay === 1 ? "monthly" : "gajian",
  );
  const [gajianStartDay, setGajianStartDay] = useState(String(data.settings.gajianStartDay));
  const [defaultSalaryWalletId, setDefaultSalaryWalletId] = useState<number | null>(
    data.settings.defaultSalaryWalletId ?? null,
  );

  const [budgetCat, setBudgetCat] = useState(
    data.categories.find((c) => c.type === "expense")?.name ?? "Makanan & Minuman",
  );
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetFormError, setBudgetFormError] = useState("");

  const currentGajianPeriod = useMemo(
    () =>
      currentPeriodForCycle("gajian", data.settings.gajianStartDay, data.settings.cardCutoffDay),
    [data.settings.gajianStartDay, data.settings.cardCutoffDay],
  );

  const budgetsQuery = useQuery({
    queryKey: ["budgets", currentGajianPeriod],
    queryFn: () => api.getBudgets(currentGajianPeriod),
  });

  const templateBudgets = useMemo(
    () =>
      (budgetsQuery.data?.budgets ?? []).filter(
        (b): b is typeof b & { templateId: number; templateLimit: number } =>
          b.templateId !== null && b.templateLimit !== null,
      ),
    [budgetsQuery.data],
  );

  useEffect(() => {
    setGrossSalary(data.settings.grossSalary.toLocaleString("id-ID"));
    setPayrollDeduction(data.settings.payrollDeduction.toLocaleString("id-ID"));
    setNetSalary(data.settings.netSalary.toLocaleString("id-ID"));
    setCycleType(data.settings.gajianStartDay === 1 ? "monthly" : "gajian");
    setGajianStartDay(String(data.settings.gajianStartDay));
  }, [data.settings]);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    await queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  const settingsMutation = useMutation({
    mutationFn: () =>
      api.updateSettings({
        grossSalary: parsePositiveInt(grossSalary),
        payrollDeduction: parsePositiveInt(payrollDeduction),
        netSalary: parsePositiveInt(netSalary),
        gajianStartDay: Number(gajianStartDay),
        defaultSalaryWalletId: defaultSalaryWalletId || null,
      }),
    onSuccess: async () => {
      await invalidateAll();
      onToast("Pengaturan gaji & siklus disimpan");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan.");
    },
  });

  const budgetMutation = useMutation({
    mutationFn: () =>
      api.upsertBudget({
        category: budgetCat,
        period: "default",
        limitAmount: parsePositiveInt(budgetAmount),
      }),
    onSuccess: async () => {
      await invalidateAll();
      setBudgetAmount("");
      setBudgetFormError("");
      onToast("Template budget bulanan disimpan");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menyimpan budget.";
      setBudgetFormError(msg);
      onToast(msg);
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: number) => api.deleteBudget(id),
    onSuccess: async () => {
      await invalidateAll();
      onToast("Template budget dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus budget.");
    },
  });

  return (
    <div className="space-y-6">
      {/* Salary & Cycle Rules */}
      <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-white">
            Aturan Gaji & Siklus Anggaran
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Tentukan bagaimana periode anggaran bulanan Anda dihitung (Bulan Kalender atau Siklus
            Gajian).
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            settingsMutation.mutate();
          }}
          className="space-y-5"
        >
          {/* Pilihan Mode Siklus Anggaran */}
          <div className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 p-4 sm:p-5 space-y-3.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Mode Siklus Anggaran Utama
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition-all ${
                  cycleType === "monthly"
                    ? "border-[var(--primary)] bg-white dark:bg-neutral-900 ring-2 ring-[var(--primary)]/25 shadow-xs"
                    : "border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/60 hover:border-neutral-300 dark:hover:border-neutral-600"
                }`}
              >
                <input
                  type="radio"
                  name="cycleType"
                  value="monthly"
                  checked={cycleType === "monthly"}
                  onChange={() => {
                    setCycleType("monthly");
                    setGajianStartDay("1");
                  }}
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                />
                <div>
                  <span className="block text-sm font-bold text-neutral-900 dark:text-white">
                    Bulanan Kalender (Tgl 1 - Akhir Bulan)
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                    Anggaran dihitung per 1 bulan kalender (contoh: 1 Okt s/d 31 Okt). Cocok untuk
                    pebisnis atau penghasilan awal bulan.
                  </span>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition-all ${
                  cycleType === "gajian"
                    ? "border-[var(--primary)] bg-white dark:bg-neutral-900 ring-2 ring-[var(--primary)]/25 shadow-xs"
                    : "border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/60 hover:border-neutral-300 dark:hover:border-neutral-600"
                }`}
              >
                <input
                  type="radio"
                  name="cycleType"
                  value="gajian"
                  checked={cycleType === "gajian"}
                  onChange={() => {
                    setCycleType("gajian");
                    if (gajianStartDay === "1") {
                      setGajianStartDay("25");
                    }
                  }}
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                />
                <div>
                  <span className="block text-sm font-bold text-neutral-900 dark:text-white">
                    Siklus Gajian (Payroll Cycle)
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                    Anggaran dihitung dari tanggal gajian bulan ini s/d H-1 gajian berikutnya
                    (contoh: 25 Okt s/d 24 Nov).
                  </span>
                </div>
              </label>
            </div>

            {cycleType === "gajian" && (
              <div className="pt-2 sm:w-1/2 space-y-1.5">
                <label
                  htmlFor="set-gajian"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
                >
                  Tanggal Gajian Setiap Bulan (1 - 28)
                </label>
                <input
                  id="set-gajian"
                  type="number"
                  min={1}
                  max={28}
                  value={gajianStartDay}
                  onChange={(e) => setGajianStartDay(e.target.value)}
                  className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white tabular-nums font-mono focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Periode aktif akan berjalan dari tanggal {gajianStartDay} bulan ini sampai tanggal{" "}
                  {Math.max(1, Number(gajianStartDay) - 1)} bulan berikutnya.
                </p>
              </div>
            )}
          </div>

          {/* Form Gaji & Payroll */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label
                htmlFor="set-net"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Gaji Bersih / Take-Home Pay (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400 dark:text-neutral-500">
                  Rp
                </span>
                <input
                  id="set-net"
                  inputMode="numeric"
                  value={netSalary}
                  onChange={(e) => setNetSalary(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="set-gross"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Gaji Kotor (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400 dark:text-neutral-500">
                  Rp
                </span>
                <input
                  id="set-gross"
                  inputMode="numeric"
                  value={grossSalary}
                  onChange={(e) => setGrossSalary(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="set-ded"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Potongan Kantor (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400 dark:text-neutral-500">
                  Rp
                </span>
                <input
                  id="set-ded"
                  inputMode="numeric"
                  value={payrollDeduction}
                  onChange={(e) => setPayrollDeduction(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="set-def-salary-wallet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              Dompet Penerima Gaji Default
            </label>
            <select
              id="set-def-salary-wallet"
              value={defaultSalaryWalletId ?? ""}
              onChange={(e) =>
                setDefaultSalaryWalletId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="">Otomatis (Dompet Bank Utama)</option>
              {data.wallets
                .filter((w) => w.isActive && w.type !== "credit_card")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.role === "savings" ? "Tabungan" : "Harian"}) · Saldo:{" "}
                    {formatRupiah(w.balance)}
                  </option>
                ))}
            </select>
          </div>

          <Button
            type="submit"
            disabled={settingsMutation.isPending}
            className="min-h-[44px] rounded-[14px] px-5 font-bold"
          >
            {settingsMutation.isPending ? "Menyimpan..." : "Simpan Aturan Gaji & Siklus"}
          </Button>
        </form>
      </div>

      {/* Template Budget Bulanan */}
      <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-neutral-900 dark:text-white">
              Template Budget Bulanan (Default)
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Batas anggaran yang otomatis diterapkan setiap siklus baru dimulai.
            </p>
          </div>
          <Badge tone="neutral">Berlaku Tiap Siklus</Badge>
        </div>

        {budgetsQuery.isPending ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Memuat template anggaran...
          </p>
        ) : templateBudgets.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-neutral-200 dark:border-neutral-700 p-4 text-center">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Belum ada template batas anggaran kategori. Tambahkan di bawah.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {templateBudgets.map((b) => (
              <div
                key={b.templateId}
                className="flex items-center justify-between gap-3 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-neutral-900 dark:text-white">
                      {formatBudgetCategoryName(b.category)}
                    </p>
                    {b.isOverride && (
                      <Badge tone="soft">Aktif override {formatRupiah(b.limitAmount)}</Badge>
                    )}
                  </div>
                  <p className="tabular-nums font-mono text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    Template default {formatRupiah(b.templateLimit)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Hapus template budget ${formatBudgetCategoryName(b.category)}`}
                  disabled={deleteBudgetMutation.isPending}
                  onClick={() => deleteBudgetMutation.mutate(b.templateId)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (parsePositiveInt(budgetAmount) <= 0) {
              setBudgetFormError("Masukkan nominal limit lebih dari Rp0.");
              return;
            }
            setBudgetFormError("");
            budgetMutation.mutate();
          }}
          className="rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 p-4 sm:p-5 space-y-4"
        >
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Tambah Template Anggaran Baru
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="bgt-cat"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Kategori
              </label>
              <select
                id="bgt-cat"
                value={budgetCat}
                onChange={(e) => setBudgetCat(e.target.value)}
                className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
              >
                {data.categories
                  .filter((c) => c.type === "expense" && !c.isArchived)
                  .map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="bgt-limit"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                Limit Bulanan (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400 dark:text-neutral-500">
                  Rp
                </span>
                <input
                  id="bgt-limit"
                  inputMode="numeric"
                  value={budgetAmount}
                  onChange={(e) => {
                    setBudgetAmount(formatDigitsInput(e.target.value));
                    setBudgetFormError("");
                  }}
                  placeholder="1.500.000"
                  className="w-full rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 pl-11 pr-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
            <div className="sm:col-span-2 pt-1">
              <Button
                type="submit"
                disabled={budgetMutation.isPending}
                className="min-h-[44px] rounded-[14px] px-5 font-bold"
              >
                {budgetMutation.isPending ? "Menyimpan..." : "Simpan Template Anggaran"}
              </Button>
            </div>
          </div>
          {budgetFormError && (
            <p role="alert" className="text-xs font-semibold text-red-500">
              {budgetFormError}
            </p>
          )}
        </form>
      </div>

      {/* Recurring Bills Manager */}
      <RecurringRulesManager
        categories={data.categories}
        wallets={data.wallets}
        onToast={onToast}
      />
    </div>
  );
}
