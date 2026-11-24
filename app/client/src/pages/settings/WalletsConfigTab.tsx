import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WalletRole, WalletType } from "../../../../shared/src/types";
import { EditIcon, TrashIcon } from "../../components/Icons";
import { Badge, Button, Card } from "../../components/UI";
import { api, ApiError, type DashboardDto, type WalletDto } from "../../lib/api";
import {
  formatDigitsInput,
  formatRupiah,
  formatSignedDigitsInput,
  parsePositiveInt,
  parseSignedInt,
} from "../../lib/format";

function CardRecurringFeesManager({
  walletId,
  walletName,
  onToast,
}: {
  walletId: number;
  walletName: string;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [feeName, setFeeName] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [formError, setFormError] = useState("");

  const { data: feesData, isLoading } = useQuery({
    queryKey: ["wallet-recurring-fees", walletId],
    queryFn: () => api.getWalletRecurringFees(walletId),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.createWalletRecurringFee(walletId, {
        name: feeName.trim(),
        amount: parsePositiveInt(feeAmount),
        isActive: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wallet-recurring-fees", walletId] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      setFeeName("");
      setFeeAmount("");
      setFormError("");
      onToast(`Biaya rutin untuk ${walletName} ditambahkan`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambah biaya rutin.";
      setFormError(msg);
      onToast(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ feeId, isActive }: { feeId: number; isActive: boolean }) =>
      api.updateWalletRecurringFee(walletId, feeId, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wallet-recurring-fees", walletId] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      onToast("Status biaya rutin diperbarui");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal memperbarui status biaya.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (feeId: number) => api.deleteWalletRecurringFee(walletId, feeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wallet-recurring-fees", walletId] });
      await queryClient.invalidateQueries({ queryKey: ["debts"] });
      onToast("Biaya rutin dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus biaya rutin.");
    },
  });

  const fees = feesData?.fees ?? [];

  return (
    <div className="mt-3 space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
          Biaya Rutin Bank: {walletName}
        </h4>
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Otomatis dicatat tiap tutup buku
        </span>
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--muted-foreground)]">Memuat biaya rutin...</p>
      ) : fees.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Belum ada biaya rutin terdaftar (misal: Biaya Meterai, Annual Fee).
        </p>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-[8px] border border-[var(--border)] bg-[var(--card)]">
          {fees.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-2.5 text-xs">
              <div className="space-y-0.5">
                <span className="font-semibold text-[var(--foreground)]">{f.name}</span>
                <p className="tabular-nums font-mono text-[var(--muted-foreground)]">
                  {formatRupiah(f.amount)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleMutation.mutate({ feeId: f.id, isActive: !f.isActive })}
                  className="rounded-full border border-[var(--control-border)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--surface)]"
                >
                  {f.isActive ? "Aktif" : "Nonaktif"}
                </button>
                <button
                  type="button"
                  aria-label={`Hapus biaya ${f.name}`}
                  onClick={() => deleteMutation.mutate(f.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--destructive)] hover:bg-[var(--surface)]"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form tambah fee */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!feeName.trim()) {
            setFormError("Nama biaya wajib diisi.");
            return;
          }
          if (parsePositiveInt(feeAmount) <= 0) {
            setFormError("Nominal biaya harus lebih dari Rp0.");
            return;
          }
          setFormError("");
          addMutation.mutate();
        }}
        className="flex flex-wrap items-center gap-2 pt-1"
      >
        <input
          type="text"
          value={feeName}
          onChange={(e) => setFeeName(e.target.value)}
          placeholder="Nama biaya (mis: Meterai)"
          className="min-h-[38px] flex-1 rounded-[8px] border border-[var(--control-border)] bg-[var(--card)] px-2.5 text-xs"
        />
        <input
          inputMode="numeric"
          value={feeAmount}
          onChange={(e) => setFeeAmount(formatDigitsInput(e.target.value))}
          placeholder="Nominal (Rp)"
          className="tabular-nums min-h-[38px] w-28 rounded-[8px] border border-[var(--control-border)] bg-[var(--card)] px-2.5 text-xs"
        />
        <Button
          type="submit"
          disabled={addMutation.isPending}
          className="min-h-[38px] text-xs px-3"
        >
          Tambah
        </Button>
      </form>
      {formError && <p className="text-[11px] text-[var(--destructive)]">{formError}</p>}
    </div>
  );
}

export function WalletsConfigTab({
  data,
  onReconcileWallet,
  onToast,
}: {
  data: DashboardDto;
  onReconcileWallet: (wallet: WalletDto) => void;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();

  const [newWalletName, setNewWalletName] = useState("");
  const [newWalletType, setNewWalletType] = useState<WalletType>("bank");
  const [newWalletRole, setNewWalletRole] = useState<WalletRole>("spending");
  const [newWalletOpening, setNewWalletOpening] = useState("0");
  const [newWalletLimit, setNewWalletLimit] = useState(
    data.settings.cardLimit.toLocaleString("id-ID"),
  );
  const [newWalletCutoffDay, setNewWalletCutoffDay] = useState(String(data.settings.cardCutoffDay));
  const [newWalletStatementDay, setNewWalletStatementDay] = useState(
    String(data.settings.statementDay),
  );
  const [newWalletPaymentDay, setNewWalletPaymentDay] = useState(
    String(data.settings.cardPaymentDay),
  );
  const [walletFormError, setWalletFormError] = useState("");
  const [expandedFeesWalletId, setExpandedFeesWalletId] = useState<number | null>(null);

  const [editingWalletId, setEditingWalletId] = useState<number | null>(null);
  const [editWalletName, setEditWalletName] = useState("");
  const [editWalletRole, setEditWalletRole] = useState<WalletRole>("spending");
  const [editWalletOpening, setEditWalletOpening] = useState("");
  const [editWalletLimit, setEditWalletLimit] = useState("");
  const [editWalletCutoffDay, setEditWalletCutoffDay] = useState("21");
  const [editWalletStatementDay, setEditWalletStatementDay] = useState("22");
  const [editWalletPaymentDay, setEditWalletPaymentDay] = useState("10");
  const [editWalletActive, setEditWalletActive] = useState(true);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    await queryClient.invalidateQueries({ queryKey: ["debts"] });
  };

  const walletMutation = useMutation({
    mutationFn: () => {
      if (newWalletType === "credit_card") {
        return api.createWallet({
          name: newWalletName.trim(),
          type: "credit_card",
          role: "credit_card",
          openingBalance: 0,
          creditLimit: parsePositiveInt(newWalletLimit) || 10_000_000,
          cutoffDay: Number(newWalletCutoffDay) || data.settings.cardCutoffDay,
          statementDay: Number(newWalletStatementDay) || data.settings.statementDay,
          paymentDay: Number(newWalletPaymentDay) || data.settings.cardPaymentDay,
          color: "#00797a",
        });
      }
      return api.createWallet({
        name: newWalletName.trim(),
        type: newWalletType,
        role: newWalletRole,
        openingBalance: parseSignedInt(newWalletOpening),
        color: "#00797a",
      });
    },
    onSuccess: async () => {
      await invalidateAll();
      setNewWalletName("");
      setNewWalletOpening("0");
      setWalletFormError("");
      onToast("Dompet baru ditambahkan");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal menambah dompet.";
      setWalletFormError(msg);
      onToast(msg);
    },
  });

  const updateWalletMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Parameters<typeof api.updateWallet>[1];
    }) => api.updateWallet(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      setEditingWalletId(null);
      onToast("Dompet diperbarui");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal memperbarui dompet.");
    },
  });

  const startEditWallet = (w: WalletDto) => {
    setEditingWalletId(w.id);
    setEditWalletName(w.name);
    setEditWalletRole(w.role);
    setEditWalletOpening(w.openingBalance.toLocaleString("id-ID"));
    setEditWalletLimit((w.creditLimit ?? data.settings.cardLimit).toLocaleString("id-ID"));
    setEditWalletCutoffDay(String(w.cutoffDay ?? data.settings.cardCutoffDay));
    setEditWalletStatementDay(String(w.statementDay ?? data.settings.statementDay));
    setEditWalletPaymentDay(String(w.paymentDay ?? data.settings.cardPaymentDay));
    setEditWalletActive(w.isActive);
  };

  return (
    <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
      <div>
        <h2 className="text-base font-bold text-neutral-900 dark:text-white">
          Dompet & Rekonsiliasi Saldo
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Atur saldo awal, limit kartu kredit, peran akun (harian vs tabungan), dan biaya rutin
          bank.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 dark:divide-neutral-700 rounded-[14px] border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-900">
        {data.wallets.map((w) => {
          const isEditing = editingWalletId === w.id;
          const isFeesOpen = expandedFeesWalletId === w.id;
          return (
            <div key={w.id} className="space-y-3 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{w.name}</strong>
                    <Badge tone="neutral">
                      {w.type === "credit_card" ? "Kartu Kredit" : w.type}
                    </Badge>
                    {w.type !== "credit_card" && (
                      <Badge tone={w.role === "savings" ? "highlight" : "soft"}>
                        {w.role === "savings" ? "Tabungan" : "Harian"}
                      </Badge>
                    )}
                    {!w.isActive && <Badge tone="highlight">Nonaktif</Badge>}
                  </div>
                  <p className="tabular-nums text-xs text-[var(--muted-foreground)]">
                    {w.type === "credit_card"
                      ? `Terpakai ${formatRupiah(w.limitUsed)} / Limit ${formatRupiah(w.creditLimit ?? 0)} · Cutoff ${w.cutoffDay ?? data.settings.cardCutoffDay} · Cetak ${w.statementDay ?? data.settings.statementDay} · Tempo ${w.paymentDay ?? data.settings.cardPaymentDay}`
                      : `Saldo sistem ${formatRupiah(w.balance)} · Saldo awal ${formatRupiah(w.openingBalance)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {w.type === "credit_card" && (
                    <Button
                      variant="secondary"
                      onClick={() => setExpandedFeesWalletId(isFeesOpen ? null : w.id)}
                      className="min-h-[44px] px-3 text-xs"
                    >
                      {isFeesOpen ? "Tutup Biaya Rutin" : "Biaya Rutin"}
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => (isEditing ? setEditingWalletId(null) : startEditWallet(w))}
                    aria-label={`Edit dompet ${w.name}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
                  >
                    <EditIcon className="w-4 h-4" />
                  </button>
                  {w.type !== "credit_card" && (
                    <Button
                      variant="secondary"
                      onClick={() => onReconcileWallet(w)}
                      className="min-h-[44px] px-3 text-xs"
                    >
                      Sesuaikan Saldo
                    </Button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="space-y-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label
                        htmlFor={`edit-wallet-name-${w.id}`}
                        className="block text-xs font-semibold"
                      >
                        Nama Dompet
                      </label>
                      <input
                        id={`edit-wallet-name-${w.id}`}
                        type="text"
                        value={editWalletName}
                        onChange={(e) => setEditWalletName(e.target.value)}
                        className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                      />
                    </div>
                    {w.type === "credit_card" ? (
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-wallet-limit-${w.id}`}
                          className="block text-xs font-semibold"
                        >
                          Limit Kartu (Rp)
                        </label>
                        <input
                          id={`edit-wallet-limit-${w.id}`}
                          inputMode="numeric"
                          value={editWalletLimit}
                          onChange={(e) => setEditWalletLimit(formatDigitsInput(e.target.value))}
                          className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-wallet-open-${w.id}`}
                          className="block text-xs font-semibold"
                        >
                          Saldo Awal (Rp)
                        </label>
                        <input
                          id={`edit-wallet-open-${w.id}`}
                          inputMode="text"
                          value={editWalletOpening}
                          onChange={(e) =>
                            setEditWalletOpening(formatSignedDigitsInput(e.target.value))
                          }
                          className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {w.type === "credit_card" ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-wallet-cutoff-${w.id}`}
                          className="block text-xs font-semibold"
                        >
                          Tgl Cutoff (1-28)
                        </label>
                        <input
                          id={`edit-wallet-cutoff-${w.id}`}
                          type="number"
                          min={1}
                          max={28}
                          value={editWalletCutoffDay}
                          onChange={(e) => setEditWalletCutoffDay(e.target.value)}
                          className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-wallet-stmt-${w.id}`}
                          className="block text-xs font-semibold"
                        >
                          Tgl Cetak Tagihan (1-28)
                        </label>
                        <input
                          id={`edit-wallet-stmt-${w.id}`}
                          type="number"
                          min={1}
                          max={28}
                          value={editWalletStatementDay}
                          onChange={(e) => setEditWalletStatementDay(e.target.value)}
                          className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-wallet-pay-${w.id}`}
                          className="block text-xs font-semibold"
                        >
                          Tgl Jatuh Tempo (1-28)
                        </label>
                        <input
                          id={`edit-wallet-pay-${w.id}`}
                          type="number"
                          min={1}
                          max={28}
                          value={editWalletPaymentDay}
                          onChange={(e) => setEditWalletPaymentDay(e.target.value)}
                          className="tabular-nums min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label
                        htmlFor={`edit-wallet-role-${w.id}`}
                        className="block text-xs font-semibold"
                      >
                        Peran Dompet
                      </label>
                      <select
                        id={`edit-wallet-role-${w.id}`}
                        value={editWalletRole}
                        onChange={(e) => setEditWalletRole(e.target.value as WalletRole)}
                        className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-sm font-semibold"
                      >
                        <option value="spending">Harian (Safe to Spend)</option>
                        <option value="savings">Tabungan / Dana Darurat</option>
                      </select>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <label className="inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={editWalletActive}
                        onChange={(e) => setEditWalletActive(e.target.checked)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      Dompet aktif
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setEditingWalletId(null)}
                        className="min-h-[44px] px-3 text-xs"
                      >
                        Batal
                      </Button>
                      <Button
                        disabled={updateWalletMutation.isPending}
                        onClick={() => {
                          if (!editWalletName.trim()) {
                            onToast("Nama dompet wajib diisi.");
                            return;
                          }
                          const payload =
                            w.type === "credit_card"
                              ? {
                                  name: editWalletName.trim(),
                                  creditLimit: parsePositiveInt(editWalletLimit) || undefined,
                                  cutoffDay: Number(editWalletCutoffDay) || undefined,
                                  statementDay: Number(editWalletStatementDay) || undefined,
                                  paymentDay: Number(editWalletPaymentDay) || undefined,
                                  isActive: editWalletActive,
                                }
                              : {
                                  name: editWalletName.trim(),
                                  role: editWalletRole,
                                  openingBalance: parseSignedInt(editWalletOpening),
                                  isActive: editWalletActive,
                                };
                          updateWalletMutation.mutate({ id: w.id, payload });
                        }}
                        className="min-h-[44px] px-4 text-xs font-semibold"
                      >
                        {updateWalletMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {isFeesOpen && w.type === "credit_card" && (
                <CardRecurringFeesManager walletId={w.id} walletName={w.name} onToast={onToast} />
              )}
            </div>
          );
        })}
      </div>

      {/* Form Tambah Dompet Baru */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newWalletName.trim()) {
            setWalletFormError("Nama dompet wajib diisi.");
            return;
          }
          setWalletFormError("");
          walletMutation.mutate();
        }}
        className="space-y-4 rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 sm:p-5 shadow-xs"
      >
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
          Tambah Dompet Baru
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="new-wallet-name" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Nama Dompet Baru
            </label>
            <input
              id="new-wallet-name"
              type="text"
              value={newWalletName}
              onChange={(e) => {
                setNewWalletName(e.target.value);
                setWalletFormError("");
              }}
              placeholder={
                newWalletType === "credit_card" ? "Contoh: CC BCA Everyday" : "Contoh: SeaBank"
              }
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-wallet-type" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              Jenis Dompet
            </label>
            <select
              id="new-wallet-type"
              value={newWalletType}
              onChange={(e) => setNewWalletType(e.target.value as WalletType)}
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
            >
              <option value="bank">Bank</option>
              <option value="ewallet">E-Wallet</option>
              <option value="cash">Tunai</option>
              <option value="credit_card">Kartu Kredit</option>
            </select>
          </div>
        </div>

        {newWalletType === "credit_card" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-limit" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Limit Kartu (Rp)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 select-none">
                  Rp
                </span>
                <input
                  id="new-wallet-limit"
                  inputMode="numeric"
                  value={newWalletLimit}
                  onChange={(e) => setNewWalletLimit(formatDigitsInput(e.target.value))}
                  placeholder="10.000.000"
                  className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-9 pr-3 py-2.5 text-sm font-bold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-cutoff" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Cutoff (Tgl 1-28)
              </label>
              <input
                id="new-wallet-cutoff"
                type="number"
                min={1}
                max={28}
                value={newWalletCutoffDay}
                onChange={(e) => setNewWalletCutoffDay(e.target.value)}
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-stmt" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Cetak Tagihan (Tgl 1-28)
              </label>
              <input
                id="new-wallet-stmt"
                type="number"
                min={1}
                max={28}
                value={newWalletStatementDay}
                onChange={(e) => setNewWalletStatementDay(e.target.value)}
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-payment" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Jatuh Tempo (Tgl 1-28)
              </label>
              <input
                id="new-wallet-payment"
                type="number"
                min={1}
                max={28}
                value={newWalletPaymentDay}
                onChange={(e) => setNewWalletPaymentDay(e.target.value)}
                className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-role" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Peran Dompet
              </label>
              <select
                id="new-wallet-role"
                value={newWalletRole}
                onChange={(e) => setNewWalletRole(e.target.value as WalletRole)}
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all"
              >
                <option value="spending">Harian (Safe to Spend)</option>
                <option value="savings">Tabungan / Dana Darurat</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-wallet-open" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
                Saldo Awal (Rp)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 select-none">
                  Rp
                </span>
                <input
                  id="new-wallet-open"
                  inputMode="text"
                  value={newWalletOpening}
                  onChange={(e) => setNewWalletOpening(formatSignedDigitsInput(e.target.value))}
                  className="tabular-nums w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 pl-9 pr-3 py-2.5 text-sm font-bold text-neutral-900 dark:text-white focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={walletMutation.isPending}
            className="min-h-[44px] px-6 py-2.5 rounded-[16px] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.99] shadow-sm disabled:opacity-50"
          >
            Tambah Dompet
          </button>
        </div>
        {walletFormError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {walletFormError}
          </p>
        )}
      </form>
    </div>
  );
}
