import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CategoryType } from "../../../../shared/src/types";
import { EditIcon } from "../../components/Icons";
import { Badge, Button, Card } from "../../components/UI";
import { api, ApiError, type CategoryDto, type DashboardDto } from "../../lib/api";

export function CategoriesConfigTab({
  data,
  onToast,
}: {
  data: DashboardDto;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();

  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<CategoryType>("expense");
  const [newCatMandatory, setNewCatMandatory] = useState(false);
  const [catFormError, setCatFormError] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [filterType, setFilterType] = useState<"all" | "expense" | "income">("all");

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  const catMutation = useMutation({
    mutationFn: () =>
      api.createCategory({
        name: newCatName.trim(),
        type: newCatType,
        isMandatory: newCatMandatory,
      }),
    onSuccess: async () => {
      await invalidateAll();
      setNewCatName("");
      setNewCatMandatory(false);
      setCatFormError("");
      onToast("Kategori baru ditambahkan");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambah kategori.";
      setCatFormError(msg);
      onToast(msg);
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Parameters<typeof api.updateCategory>[1];
    }) => api.updateCategory(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      setEditingCatId(null);
      onToast("Kategori diperbarui");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal memperbarui kategori.");
    },
  });

  const startEditCategory = (c: CategoryDto) => {
    setEditingCatId(c.id);
    setEditCatName(c.name);
  };

  const filteredCategories = data.categories.filter((cat) => {
    if (filterType === "all") return true;
    return cat.type === filterType;
  });

  return (
    <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-white">Kelola Kategori Anggaran</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Atur pos-pos pemasukan dan pengeluaran yang digunakan untuk pencatatan transaksi harian.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterType("all")}
            className={`min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors ${
              filterType === "all"
                ? "bg-[var(--hero)] text-white shadow-xs"
                : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
            }`}
          >
            Semua ({data.categories.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("expense")}
            className={`min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors ${
              filterType === "expense"
                ? "bg-[var(--hero)] text-white shadow-xs"
                : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
            }`}
          >
            Pengeluaran ({data.categories.filter((c) => c.type === "expense").length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("income")}
            className={`min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors ${
              filterType === "income"
                ? "bg-[var(--hero)] text-white shadow-xs"
                : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
            }`}
          >
            Pemasukan ({data.categories.filter((c) => c.type === "income").length})
          </button>
        </div>
      </div>

      {/* Form Tambah Kategori Baru */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newCatName.trim()) {
            setCatFormError("Nama kategori wajib diisi.");
            return;
          }
          setCatFormError("");
          catMutation.mutate();
        }}
        className="space-y-3.5 rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 sm:p-5 shadow-xs"
      >
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
          Tambah Kategori Baru
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cat-name" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Nama Kategori Baru
            </label>
            <input
              id="cat-name"
              type="text"
              value={newCatName}
              onChange={(e) => {
                setNewCatName(e.target.value);
                setCatFormError("");
              }}
              placeholder="Contoh: Olahraga, Skincare"
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cat-type" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Tipe Kategori
            </label>
            <select
              id="cat-type"
              value={newCatType}
              onChange={(e) => setNewCatType(e.target.value as CategoryType)}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            >
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
          </div>
        </div>

        <label className="inline-flex min-h-[40px] items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={newCatMandatory}
            onChange={(e) => setNewCatMandatory(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--primary)]"
          />
          Tandai sebagai kategori wajib (seperti kebutuhan pokok / cicilan)
        </label>

        {catFormError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {catFormError}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={catMutation.isPending}
            className="min-h-[44px] px-6 py-2.5 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
          >
            {catMutation.isPending ? "Menambahkan..." : "Tambah Kategori"}
          </button>
        </div>
      </form>

      {/* List Kategori */}
      <div className="max-h-[380px] divide-y divide-neutral-200 dark:divide-neutral-700 overflow-y-auto rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        {filteredCategories.map((cat) => {
          const isEditing = editingCatId === cat.id;
          return (
            <div key={cat.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      cat.isArchived
                        ? "line-through text-neutral-400 dark:text-neutral-500"
                        : "text-neutral-900 dark:text-white"
                    }`}
                  >
                    {cat.name}
                  </span>
                  <Badge tone={cat.type === "income" ? "soft" : "neutral"} className="text-xs">
                    {cat.type === "income" ? "Masuk" : "Keluar"}
                  </Badge>
                  {cat.isMandatory && (
                    <Badge tone="highlight" className="text-xs">
                      Wajib
                    </Badge>
                  )}
                  {cat.isArchived && (
                    <Badge tone="neutral" className="text-xs">
                      Diarsipkan
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Edit kategori ${cat.name}`}
                    onClick={() => (isEditing ? setEditingCatId(null) : startEditCategory(cat))}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <EditIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateCategoryMutation.mutate({
                        id: cat.id,
                        payload: { isArchived: !cat.isArchived },
                      })
                    }
                    className="inline-flex min-h-[36px] items-center rounded-[10px] border border-neutral-200 dark:border-neutral-700 px-3 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    {cat.isArchived ? "Pulihkan" : "Arsipkan"}
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="text"
                    aria-label={`Ubah nama kategori ${cat.name}`}
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    className="min-h-[44px] flex-1 rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 text-sm font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                  />
                  <Button
                    disabled={updateCategoryMutation.isPending}
                    onClick={() => {
                      if (!editCatName.trim()) {
                        onToast("Nama kategori tidak boleh kosong.");
                        return;
                      }
                      updateCategoryMutation.mutate({
                        id: cat.id,
                        payload: { name: editCatName.trim() },
                      });
                    }}
                    className="min-h-[44px] rounded-[14px] px-4 text-xs font-bold"
                  >
                    Simpan
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setEditingCatId(null)}
                    className="min-h-[44px] rounded-[14px] px-3.5 text-xs font-bold"
                  >
                    Batal
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
