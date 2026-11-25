import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type CategoryDto, type RecurringRuleDto, type WalletDto } from "../lib/api";
import { MAX_IDR_AMOUNT, formatDigitsInput, formatRupiah, parsePositiveInt } from "../lib/format";
import { EditIcon, TrashIcon } from "./Icons";
import { Badge, Button, ModalSheet } from "./UI";

export function RecurringBillsModal({
  open,
  onClose,
  categories,
  wallets,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryDto[];
  wallets: WalletDto[];
  onToast?: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === "expense" && !c.isArchived),
    [categories],
  );
  const activeWallets = useMemo(() => wallets.filter((w) => w.isActive), [wallets]);

  const defaultCategory = useMemo(
    () =>
      expenseCategories.find((c) => c.name === "Internet")?.name ??
      expenseCategories[0]?.name ??
      "",
    [expenseCategories],
  );
  const defaultWalletId = activeWallets[0]?.id ?? 0;

  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [walletId, setWalletId] = useState<number>(defaultWalletId);
  const [dueDay, setDueDay] = useState<string>("10");
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setMerchant("");
    setAmount("");
    setCategory(defaultCategory);
    setWalletId(defaultWalletId);
    setDueDay("10");
    setFormError("");
  }, [open, defaultCategory, defaultWalletId]);

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ["recurring-rules"],
    queryFn: () => api.getRecurringRules(),
    enabled: open,
  });

  const invalidateRecurring = async () => {
    await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const resetForm = () => {
    setEditingId(null);
    setMerchant("");
    setAmount("");
    setCategory(defaultCategory);
    setWalletId(defaultWalletId);
    setDueDay("10");
    setFormError("");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedMerchant = merchant.trim();
      const parsedAmount = parsePositiveInt(amount);
      const parsedDueDay = Number(dueDay);

      if (!trimmedMerchant) {
        throw new Error("Nama tagihan atau layanan wajib diisi.");
      }
      if (parsedAmount <= 0) {
        throw new Error("Nominal bulanan harus lebih dari Rp0.");
      }
      if (parsedAmount > MAX_IDR_AMOUNT) {
        throw new Error("Nominal bulanan maksimal Rp 2.147.483.647.");
      }
      if (!category) {
        throw new Error("Pilih kategori pengeluaran terlebih dahulu.");
      }
      if (!walletId) {
        throw new Error("Pilih dompet pembayar terlebih dahulu.");
      }
      if (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 28) {
        throw new Error("Tanggal jatuh tempo harus antara 1 sampai 28.");
      }

      if (editingId !== null) {
        return api.updateRecurringRule(editingId, {
          merchant: trimmedMerchant,
          amount: parsedAmount,
          category,
          walletId,
          dueDay: parsedDueDay,
        });
      }

      return api.createRecurringRule({
        merchant: trimmedMerchant,
        amount: parsedAmount,
        category,
        walletId,
        dueDay: parsedDueDay,
        isActive: true,
      });
    },
    onSuccess: async () => {
      const wasEditing = editingId !== null;
      await invalidateRecurring();
      resetForm();
      onToast?.(
        wasEditing ? "Tagihan rutin berhasil diperbarui" : "Tagihan rutin berhasil ditambahkan",
      );
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Gagal menyimpan tagihan rutin.";
      setFormError(msg);
      onToast?.(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.updateRecurringRule(id, { isActive }),
    onSuccess: async (_res, vars) => {
      await invalidateRecurring();
      onToast?.(vars.isActive ? "Tagihan rutin diaktifkan" : "Tagihan rutin dijeda");
    },
    onError: (err) => {
      onToast?.(err instanceof ApiError ? err.message : "Gagal memperbarui status tagihan.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteRecurringRule(id),
    onSuccess: async (_res, deletedId) => {
      await invalidateRecurring();
      if (editingId === deletedId) {
        resetForm();
      }
      onToast?.("Tagihan rutin dihapus");
    },
    onError: (err) => {
      onToast?.(err instanceof ApiError ? err.message : "Gagal menghapus tagihan rutin.");
    },
  });

  const startEdit = (rule: RecurringRuleDto) => {
    setEditingId(rule.id);
    setMerchant(rule.merchant);
    setAmount(rule.amount.toLocaleString("id-ID"));
    setCategory(rule.category);
    setWalletId(rule.walletId);
    setDueDay(String(rule.dueDay));
    setFormError("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const rules = rulesData?.rules ?? [];

  const categoryOptions = useMemo(() => {
    if (!category || expenseCategories.some((c) => c.name === category)) {
      return expenseCategories;
    }
    return [
      ...expenseCategories,
      {
        id: -1,
        name: category,
        type: "expense" as const,
        isMandatory: false,
        color: "#64748b",
        sortOrder: 999,
        isArchived: false,
      },
    ];
  }, [category, expenseCategories]);

  const walletOptions = useMemo(() => {
    if (!walletId || activeWallets.some((w) => w.id === walletId)) {
      return activeWallets;
    }
    const existing = wallets.find((w) => w.id === walletId);
    return existing ? [...activeWallets, existing] : activeWallets;
  }, [walletId, activeWallets, wallets]);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      size="lg"
      title="Kelola Tagihan Rutin"
      subtitle="Atur tagihan bulanan otomatis seperti WiFi, listrik, atau langganan."
      footer={
        <div className="flex items-center justify-end">
          <Button variant="secondary" onClick={onClose} className="min-h-[44px]">
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Daftar Tagihan Rutin */}
        <section aria-label="Daftar tagihan rutin" className="space-y-2.5">
          {isLoading ? (
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--muted-foreground)]">
              Memuat daftar tagihan rutin...
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-xs text-[var(--muted-foreground)]">
              Belum ada tagihan rutin terdaftar. Tambahkan melalui formulir di bawah.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-[14px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              {rules.map((rule) => {
                const walletName =
                  rule.walletName ?? wallets.find((w) => w.id === rule.walletId)?.name ?? "Dompet";
                const isEditingThis = editingId === rule.id;

                return (
                  <div
                    key={rule.id}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3.5 transition-colors ${
                      isEditingThis ? "bg-[var(--primary)]/5" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <strong className="text-sm font-bold text-[var(--foreground)] truncate">
                          {rule.merchant}
                        </strong>
                        <Badge tone="neutral">{rule.category}</Badge>
                        <Badge tone={rule.isActive ? "soft" : "highlight"}>
                          {rule.isActive ? "Aktif" : "Dijeda"}
                        </Badge>
                        {isEditingThis && <Badge tone="primary">Sedang Diedit</Badge>}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        <span className="font-semibold text-[var(--foreground)]">
                          Tgl {rule.dueDay}
                        </span>{" "}
                        · {walletName}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums font-mono text-sm font-bold text-[var(--foreground)] mr-1">
                        {formatRupiah(rule.amount)}
                      </span>
                      <button
                        type="button"
                        disabled={toggleMutation.isPending}
                        onClick={() =>
                          toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })
                        }
                        className="min-h-[44px] rounded-full border border-[var(--control-border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-45"
                      >
                        {rule.isActive ? "Pause" : "Aktifkan"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit tagihan ${rule.merchant}`}
                        onClick={() => startEdit(rule)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Hapus tagihan ${rule.merchant}`}
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(rule.id)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--destructive)] hover:bg-[var(--card)] disabled:opacity-45"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Form Tambah / Edit Tagihan Rutin */}
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            setFormError("");
            saveMutation.mutate();
          }}
          className="space-y-3.5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
        >
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
            {editingId !== null ? "Edit Tagihan Rutin" : "Tambah Tagihan Rutin"}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="modal-rec-merchant"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Nama Tagihan / Layanan
              </label>
              <input
                id="modal-rec-merchant"
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Contoh: Spotify, WiFi"
                className="min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="modal-rec-amount"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Nominal Bulanan (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                  Rp
                </span>
                <input
                  id="modal-rec-amount"
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(formatDigitsInput(e.target.value))}
                  placeholder="150.000"
                  className="min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="modal-rec-cat"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Kategori
              </label>
              <select
                id="modal-rec-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              >
                {categoryOptions.length === 0 ? (
                  <option value="">Tidak ada kategori pengeluaran</option>
                ) : (
                  categoryOptions.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="modal-rec-wallet"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Dompet Pembayar
                </label>
                <select
                  id="modal-rec-wallet"
                  value={walletId}
                  onChange={(e) => setWalletId(Number(e.target.value))}
                  className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-3 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                >
                  {walletOptions.length === 0 ? (
                    <option value={0}>Tidak ada dompet</option>
                  ) : (
                    walletOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="modal-rec-due"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Tgl Tempo (1-28)
                </label>
                <input
                  id="modal-rec-due"
                  type="number"
                  min={1}
                  max={28}
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  className="tabular-nums min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
                />
              </div>
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-xs font-medium text-[var(--destructive)]">
              {formError}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 border-t border-[var(--border)] pt-3">
            {editingId !== null && (
              <Button
                variant="secondary"
                type="button"
                onClick={resetForm}
                className="w-full sm:w-auto min-h-[44px] rounded-[14px]"
              >
                Batal Edit
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                saveMutation.isPending || categoryOptions.length === 0 || walletOptions.length === 0
              }
              className="w-full sm:w-auto sm:ml-auto min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              {saveMutation.isPending
                ? "Menyimpan..."
                : editingId !== null
                  ? "Simpan Perubahan"
                  : "Tambah Tagihan"}
            </Button>
          </div>
        </form>
      </div>
    </ModalSheet>
  );
}
