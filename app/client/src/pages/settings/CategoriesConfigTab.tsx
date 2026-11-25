import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CategoryBucket } from "../../../../shared/src/dtos";
import type { CategoryType } from "../../../../shared/src/types";
import { EditIcon } from "../../components/Icons";
import { Badge, Button } from "../../components/UI";
import { api, ApiError, type CategoryDto, type DashboardDto } from "../../lib/api";

const BUCKET_LABELS: Record<CategoryBucket, string> = {
  needs: "Needs",
  wants: "Wants",
  savings: "Savings",
};

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
  const [newCatBucket, setNewCatBucket] = useState<CategoryBucket>("needs");
  const [newCatMandatory, setNewCatMandatory] = useState(false);
  const [catFormError, setCatFormError] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [filterType, setFilterType] = useState<"all" | "expense" | "income">("all");
  const [showArchived, setShowArchived] = useState(false);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  const catMutation = useMutation({
    mutationFn: () =>
      api.createCategory({
        name: newCatName.trim(),
        type: newCatType,
        bucket: newCatType === "expense" ? newCatBucket : undefined,
        isMandatory: newCatMandatory,
      }),
    onSuccess: async () => {
      await invalidateAll();
      setNewCatName("");
      setNewCatBucket("needs");
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

  const archivedCount = data.categories.filter((c) => c.isArchived).length;
  const baseCategories = showArchived
    ? data.categories
    : data.categories.filter((c) => !c.isArchived);

  const filteredCategories = baseCategories.filter((cat) => {
    if (filterType === "all") return true;
    return cat.type === filterType;
  });

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-5 pb-24 lg:pb-6">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">
              Kelola Kategori Anggaran
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Atur pos pemasukan dan pengeluaran yang digunakan untuk pencatatan transaksi harian.
            </p>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-fade-x max-w-full pb-0.5">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[40px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
                filterType === "all"
                  ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-xs"
                  : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              Semua ({baseCategories.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("expense")}
              className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[40px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
                filterType === "expense"
                  ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-xs"
                  : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              Pengeluaran ({baseCategories.filter((c) => c.type === "expense").length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("income")}
              className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[40px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
                filterType === "income"
                  ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-xs"
                  : "border border-[var(--control-border)] hover:bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              Pemasukan ({baseCategories.filter((c) => c.type === "income").length})
            </button>
          </div>
        </div>

        <label className="inline-flex min-h-[36px] w-fit items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--primary)]"
          />
          <span>
            Tampilkan Kategori Diarsipkan{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </span>
        </label>
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
        className="space-y-3.5 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
      >
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
          Tambah Kategori Baru
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <label
              htmlFor="cat-name"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
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
              className="min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="cat-type"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Tipe Kategori
            </label>
            <select
              id="cat-type"
              value={newCatType}
              onChange={(e) => setNewCatType(e.target.value as CategoryType)}
              className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
          </div>
          {newCatType === "expense" && (
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <label
                htmlFor="cat-bucket"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Kelompok Anggaran
              </label>
              <select
                id="cat-bucket"
                value={newCatBucket}
                onChange={(e) => setNewCatBucket(e.target.value as CategoryBucket)}
                className="h-11 w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
              >
                <option value="needs">Needs (Kebutuhan Hidup)</option>
                <option value="wants">Wants (Keinginan &amp; Gaya Hidup)</option>
                <option value="savings">Savings (Tabungan &amp; Utang)</option>
              </select>
            </div>
          )}
        </div>

        <label className="inline-flex min-h-[40px] items-center gap-2 text-xs font-semibold text-[var(--foreground)] cursor-pointer">
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

        <div className="flex border-t border-[var(--border)] pt-3">
          <Button
            type="submit"
            disabled={catMutation.isPending}
            className="w-full sm:w-auto sm:ml-auto min-h-[44px] rounded-[14px] px-5 font-bold"
          >
            {catMutation.isPending ? "Menambahkan..." : "Tambah Kategori"}
          </Button>
        </div>
      </form>

      {/* List Kategori (2-column grid on desktop, single page scroll) */}
      {filteredCategories.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--muted-foreground)]">
          Tidak ada kategori yang sesuai dengan filter saat ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {filteredCategories.map((cat) => {
            const isEditing = editingCatId === cat.id;
            return (
              <div
                key={cat.id}
                className="space-y-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--card)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0 pt-1">
                    <span
                      className={`text-sm font-semibold ${
                        cat.isArchived
                          ? "text-[var(--muted-foreground)]"
                          : "text-[var(--foreground)]"
                      }`}
                    >
                      {cat.name}
                    </span>
                    <Badge tone={cat.type === "income" ? "soft" : "neutral"} className="text-xs">
                      {cat.type === "income" ? "Masuk" : "Keluar"}
                    </Badge>
                    {cat.type === "expense" && cat.bucket && (
                      <Badge tone="info" className="text-xs">
                        {BUCKET_LABELS[cat.bucket] ?? cat.bucket}
                      </Badge>
                    )}
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

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      aria-label={`Edit kategori ${cat.name}`}
                      onClick={() => (isEditing ? setEditingCatId(null) : startEditCategory(cat))}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
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
                      className="inline-flex min-h-[44px] items-center rounded-[12px] border border-[var(--control-border)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap"
                    >
                      {cat.isArchived ? "Pulihkan" : "Arsipkan"}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
                    <input
                      type="text"
                      aria-label={`Ubah nama kategori ${cat.name}`}
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      className="min-h-[44px] flex-1 min-w-[160px] rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
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
                      className="min-h-[44px] rounded-[12px] px-4 text-xs font-bold"
                    >
                      Simpan
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditingCatId(null)}
                      className="min-h-[44px] rounded-[12px] px-3.5 text-xs font-bold"
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
  );
}
