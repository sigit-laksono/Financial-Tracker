import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type GoalDto, type WalletDto } from "../lib/api";
import {
  formatCompactRupiah,
  formatDigitsInput,
  formatRupiah,
  parsePositiveInt,
} from "../lib/format";
import { budgetKeys } from "../lib/queryKeys";
import { usePrivacyMode } from "../lib/usePrivacyMode";
import {
  AlertIcon,
  EditIcon,
  GoalsIcon,
  LightbulbIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
} from "../components/Icons";
import { Badge, Button, Card, ModalSheet, StateView } from "../components/UI";
import { HelpTooltip } from "../components/HelpTooltip";

const POPULAR_EMOJIS = ["🎯", "🛡️", "🏠", "🚗", "✈️", "💻", "💍", "🎓", "👶", "🏖️", "💰", "📱"];

export function GoalsPage({ onToast }: { onToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const { isMasked } = usePrivacyMode();
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalDto | null>(null);
  const [contributeGoal, setContributeGoal] = useState<GoalDto | null>(null);

  const {
    data: goalsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["goals"],
    queryFn: () => api.getGoals(),
  });

  const { data: walletsData } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => api.getWallets(),
  });

  const goals = goalsData?.goals ?? [];
  const emergencyFund = goalsData?.emergencyFund;
  // Memoized: the goal modals reset their form when this array changes identity, so a fresh
  // array on every render would wipe what the user is typing.
  const activeWallets = useMemo(
    () => (walletsData?.wallets ?? []).filter((w) => w.isActive && w.type !== "credit_card"),
    [walletsData],
  );

  const deleteGoalMutation = useMutation({
    mutationFn: (id: number) => api.deleteGoal(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      onToast("Target tabungan berhasil dihapus");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menghapus target.");
    },
  });

  if (isLoading) {
    return (
      <StateView
        kind="loading"
        title="Memuat target tabungan..."
        description="Menghitung ketahanan runway dana darurat dan progres tabungan."
      />
    );
  }

  if (error || !goalsData) {
    return (
      <StateView
        kind="error"
        title="Gagal memuat target tabungan"
        description={error instanceof Error ? error.message : "Terjadi kesalahan saat memuat data."}
        actionLabel="Coba Lagi"
        onAction={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6 pb-6 sm:pb-8">
      {/* Page Heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Target & Goals</h1>

        {goals.length > 0 && (
          <Button
            onClick={() => {
              setEditingGoal(null);
              setGoalModalOpen(true);
            }}
            className="w-full sm:w-auto justify-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            <span>Buat Target Baru</span>
          </Button>
        )}
      </div>

      {/* Hero Card Dana Darurat & Runway Ketahanan */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hero-border)] bg-[var(--hero-bg)] text-[var(--hero-card-foreground)] p-6 sm:p-8 shadow-sm transition-all">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--hero-border)] bg-[var(--hero-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--hero-card-foreground)]">
                <ShieldIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>Daya Tahan Dana Darurat</span>
                <HelpTooltip
                  title="Daya Tahan Dana Darurat (Runway)"
                  content="Berapa bulan Anda dapat bertahan hidup dengan pos kebutuhan bulanan saat ini jika terjadi kehilangan penghasilan secara tiba-tiba."
                />
              </div>
              <Badge
                tone={
                  isMasked
                    ? "neutral"
                    : emergencyFund?.status === "excellent" || emergencyFund?.status === "good"
                      ? "soft"
                      : emergencyFund?.status === "warning"
                        ? "highlight"
                        : "danger"
                }
                className="text-[11px] font-bold px-2 py-0.5"
              >
                {emergencyFund?.status === "excellent"
                  ? "Sangat Aman (≥ 6 Bulan)"
                  : emergencyFund?.status === "good"
                    ? "Aman (3-6 Bulan)"
                    : emergencyFund?.status === "warning"
                      ? "Waspada (1-3 Bulan)"
                      : "Kritis (< 1 Bulan)"}
              </Badge>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--hero-card-foreground)] tabular-nums">
                {formatRupiah(emergencyFund?.totalEmergencyFunds ?? 0, isMasked)}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <div className="rounded-[16px] border border-[var(--hero-inner-border)] bg-[var(--hero-surface)] p-4 text-left sm:text-right">
              <span className="text-xs font-semibold text-[var(--hero-card-muted)]">
                Ketahanan Bertahan Hidup:
              </span>
              <div className="flex items-baseline gap-1.5 sm:justify-end">
                <span
                  className={`font-mono text-3xl font-black tabular-nums ${
                    isMasked ? "text-[var(--hero-card-foreground)]" : "text-[var(--primary)]"
                  }`}
                >
                  {emergencyFund?.runwayMonths ?? 0}
                </span>
                <span className="text-sm font-bold text-[var(--hero-card-muted)]">Bulan</span>
              </div>
              <p className="text-[11px] text-[var(--hero-card-muted)] mt-0.5">
                Rata-rata kebutuhan:{" "}
                <strong className="text-[var(--hero-card-foreground)] tabular-nums">
                  {formatCompactRupiah(emergencyFund?.monthlyNeedsBurnRate ?? 0, isMasked)}
                </strong>
                /bln
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Target Tabungan / Goals Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="text-base font-extrabold text-[var(--foreground)]">
            Daftar Target Tabungan ({goals.length})
          </h2>
        </div>

        {goals.length === 0 ? (
          <Card className="text-center py-10 px-4 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--surface)] flex items-center justify-center text-[var(--muted-foreground)]">
              <GoalsIcon className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Belum Ada Target Tabungan
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Buat target tabungan untuk memantau progres impian Anda.
            </p>
            <Button
              onClick={() => {
                setEditingGoal(null);
                setGoalModalOpen(true);
              }}
              className="mt-1"
            >
              <PlusIcon className="w-4 h-4" />
              <span>Buat Target Sekarang</span>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {goals.map((g) => (
              <div
                key={g.id}
                className="group relative flex flex-col justify-between rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 transition-all duration-200 hover:border-[var(--primary)] hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--surface)] text-2xl select-none">
                        {g.emoji}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-[var(--foreground)] truncate max-w-[150px]">
                          {g.name}
                        </h3>
                        {g.isEmergencyFund && (
                          <Badge tone="soft" className="text-[10px] px-1.5 py-0 mt-0.5">
                            Dana Darurat
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGoal(g);
                          setGoalModalOpen(true);
                        }}
                        aria-label={`Edit ${g.name}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteGoalMutation.mutate(g.id)}
                        aria-label={`Hapus ${g.name}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--destructive)]"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress & Balances */}
                  <div className="mt-4 space-y-2">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono text-base font-extrabold tabular-nums text-[var(--foreground)]">
                        {formatRupiah(g.currentAmount, isMasked)}
                      </span>
                      <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                        dari {formatCompactRupiah(g.targetAmount, isMasked)}
                      </span>
                    </div>

                    <div className="h-2 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          g.percentAchieved >= 100
                            ? "bg-[var(--chart-income)]"
                            : g.isEmergencyFund
                              ? "bg-[var(--chart-income)]"
                              : "bg-[var(--primary)]"
                        }`}
                        style={{ width: `${Math.min(100, g.percentAchieved)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-[var(--muted-foreground)] font-mono">
                      <span>Progres: {g.percentAchieved}%</span>
                      <span>Sisa: {formatCompactRupiah(g.remainingAmount, isMasked)}</span>
                    </div>

                    {g.monthlyTargetSuggested && g.remainingAmount > 0 && (
                      <div className="flex items-center gap-1.5 rounded-[8px] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--muted-foreground)]">
                        <LightbulbIcon className="w-3.5 h-3.5 text-[var(--highlight)] shrink-0" />
                        <span>
                          Rekomendasi:{" "}
                          <strong className="text-[var(--foreground)] tabular-nums">
                            {formatCompactRupiah(g.monthlyTargetSuggested, isMasked)}
                          </strong>
                          /bulan hingga {g.targetDate}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Action: Setor Tabungan */}
                <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted-foreground)] truncate">
                    {g.walletName ? `Simpan di: ${g.walletName}` : "Saldo goal gabungan"}
                  </span>
                  <Button
                    onClick={() => setContributeGoal(g)}
                    className="min-h-[36px] px-3 text-xs font-bold"
                  >
                    Setor Dana
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Tambah/Edit Goal */}
      <GoalFormModal
        open={goalModalOpen}
        onClose={() => setGoalModalOpen(false)}
        goal={editingGoal}
        wallets={activeWallets}
        onSuccess={(msg) => onToast(msg)}
      />

      {/* Modal Setor Tabungan (Contribute) */}
      <ContributeModal
        open={Boolean(contributeGoal)}
        onClose={() => setContributeGoal(null)}
        goal={contributeGoal}
        wallets={activeWallets}
        onSuccess={(msg) => onToast(msg)}
      />
    </div>
  );
}

function GoalFormModal({
  open,
  onClose,
  goal,
  wallets,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  goal: GoalDto | null;
  wallets: WalletDto[];
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("0");
  const [targetDate, setTargetDate] = useState("");
  const [isEmergencyFund, setIsEmergencyFund] = useState(false);
  const [walletId, setWalletId] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const isEditing = Boolean(goal);
  const liquidWallets = useMemo(
    () => wallets.filter((w) => w.type !== "credit_card"),
    [wallets],
  );

  useEffect(() => {
    if (!open) return;
    setError("");
    if (goal) {
      setName(goal.name);
      setEmoji(goal.emoji);
      setTargetAmount(goal.targetAmount.toLocaleString("id-ID"));
      setCurrentAmount(goal.currentAmount.toLocaleString("id-ID"));
      setTargetDate(goal.targetDate ?? "");
      setIsEmergencyFund(goal.isEmergencyFund);
      setWalletId(
        goal.walletId && liquidWallets.some((w) => w.id === goal.walletId)
          ? goal.walletId
          : undefined,
      );
      setNotes(goal.notes ?? "");
    } else {
      setName("");
      setEmoji("🎯");
      setTargetAmount("");
      setCurrentAmount("0");
      setTargetDate("");
      setIsEmergencyFund(false);
      setWalletId(undefined);
      setNotes("");
    }
  }, [goal, open, liquidWallets]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedTarget = parsePositiveInt(targetAmount);
      const parsedCurrent = parsePositiveInt(currentAmount);
      if (parsedTarget <= 0) throw new Error("Target nominal harus lebih dari Rp 0.");
      if (parsedTarget > 2_147_483_647 || parsedCurrent > 2_147_483_647) {
        throw new Error("Nominal maksimal Rp 2.147.483.647.");
      }
      if (!name.trim()) throw new Error("Nama target tabungan wajib diisi.");

      if (isEditing && goal) {
        return api.updateGoal(goal.id, {
          name: name.trim(),
          emoji,
          targetAmount: parsedTarget,
          currentAmount: parsedCurrent,
          targetDate: targetDate.trim() || null,
          isEmergencyFund,
          walletId: walletId || null,
          notes: notes.trim() || null,
        });
      }

      return api.createGoal({
        name: name.trim(),
        emoji,
        targetAmount: parsedTarget,
        currentAmount: parsedCurrent,
        targetDate: targetDate.trim() || null,
        isEmergencyFund,
        walletId: walletId || null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      onSuccess(isEditing ? `Target ${name} diperbarui` : `Target ${name} berhasil dibuat`);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyimpan.");
    },
  });

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit Target: ${goal?.name}` : "Buat Target Tabungan Baru"}
      subtitle="Tetapkan nominal dan tanggal target untuk memantau tabungan impian Anda."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            Batal
          </Button>
          <Button type="submit" form="goal-form" disabled={saveMutation.isPending}>
            {saveMutation.isPending
              ? "Menyimpan..."
              : isEditing
                ? "Simpan Perubahan"
                : "Buat Target"}
          </Button>
        </div>
      }
    >
      <form
        id="goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          saveMutation.mutate();
        }}
        className="space-y-4"
      >
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Emoji Selector */}
        <div className="space-y-1.5">
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
            Pilih Ikon Emoji
          </span>
          <div className="flex flex-wrap gap-2">
            {POPULAR_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={`h-11 w-11 text-xl rounded-[12px] border transition-all ${
                  emoji === em
                    ? "border-[var(--primary)] bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] shadow-xs scale-105"
                    : "border-[var(--control-border)] bg-[var(--surface)] hover:bg-[var(--card)]"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="goal-name"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Nama Target Tabungan
          </label>
          <input
            id="goal-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Dana Darurat, DP Rumah"
            className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="goal-target"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Target Nominal (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="goal-target"
                inputMode="numeric"
                required
                value={targetAmount}
                onChange={(e) => setTargetAmount(formatDigitsInput(e.target.value))}
                placeholder="15.000.000"
                className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 text-sm font-bold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="goal-current"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Saldo Terkumpul Saat Ini (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
                Rp
              </span>
              <input
                id="goal-current"
                inputMode="numeric"
                value={currentAmount}
                onChange={(e) => setCurrentAmount(formatDigitsInput(e.target.value))}
                placeholder="0"
                className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 text-sm font-bold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="goal-date"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Target Waktu Tercapai (Opsional)
            </label>
            <input
              id="goal-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="goal-wallet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Tautkan ke Dompet (Opsional)
            </label>
            <select
              id="goal-wallet"
              value={walletId ?? ""}
              onChange={(e) => setWalletId(e.target.value ? Number(e.target.value) : undefined)}
              className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
            >
              <option value="">Semua Dompet / Saldo Bersama</option>
              {liquidWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Emergency Fund Checkbox */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-[12px] bg-[var(--surface)] border border-[var(--border)]">
          <input
            type="checkbox"
            checked={isEmergencyFund}
            onChange={(e) => setIsEmergencyFund(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--primary)]"
          />
          <div>
            <span className="text-xs font-bold text-[var(--foreground)] block">
              Tandai sebagai Pos Dana Darurat (Emergency Fund)
            </span>
            <span className="text-[11px] text-[var(--muted-foreground)] block">
              Saldo pos ini akan otomatis dihitung ke dalam metrik ketahanan hidup (Runway Bulan).
            </span>
          </div>
        </label>
      </form>
    </ModalSheet>
  );
}

function ContributeModal({
  open,
  onClose,
  goal,
  wallets,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  goal: GoalDto | null;
  wallets: WalletDto[];
  onSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const liquidWallets = useMemo(
    () => wallets.filter((w) => w.type !== "credit_card"),
    [wallets],
  );
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState<number>(liquidWallets[0]?.id ?? 0);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setError("");
    const preferredWallet =
      goal?.walletId && liquidWallets.some((w) => w.id === goal.walletId)
        ? goal.walletId
        : (liquidWallets[0]?.id ?? 0);
    setWalletId(preferredWallet);
  }, [open, goal, liquidWallets]);

  const parsedAmount = parsePositiveInt(amount);
  const selectedWallet = liquidWallets.find((w) => w.id === walletId);
  const isOverdraft =
    Boolean(selectedWallet) && parsedAmount > 0 && parsedAmount > (selectedWallet?.balance ?? 0);

  const contributeMutation = useMutation({
    mutationFn: async () => {
      if (!goal) return;
      if (parsedAmount <= 0) throw new Error("Nominal setoran harus lebih dari Rp 0.");
      if (parsedAmount > 2_147_483_647) {
        throw new Error("Nominal setoran maksimal Rp 2.147.483.647.");
      }
      if (!selectedWallet) throw new Error("Pilih dompet sumber dana yang valid.");
      if (parsedAmount > selectedWallet.balance) {
        throw new Error(
          `Saldo ${selectedWallet.name} tidak mencukupi (${formatRupiah(selectedWallet.balance)}).`,
        );
      }

      return api.contributeGoal(goal.id, {
        amount: parsedAmount,
        walletId: selectedWallet.id,
        note: note.trim() || undefined,
        preventOverdraft: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["net-worth-summary"] });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
      await queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      onSuccess(`Berhasil menyetor ${amount} ke target ${goal?.name}`);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal menyetor.");
    },
  });

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Setor Tabungan: ${goal?.name}`}
      subtitle="Debit saldo dompet operasional Anda untuk dialokasikan ke pos target tabungan ini."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={contributeMutation.isPending}>
            Batal
          </Button>
          <Button
            type="submit"
            form="goal-contribute-form"
            disabled={
              contributeMutation.isPending || liquidWallets.length === 0 || isOverdraft
            }
          >
            {contributeMutation.isPending ? "Menyetor..." : "Konfirmasi Setor"}
          </Button>
        </div>
      }
    >
      <form
        id="goal-contribute-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          contributeMutation.mutate();
        }}
        className="space-y-4"
      >
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="contrib-amount"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Nominal Setoran (Rp)
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted-foreground)] select-none">
              Rp
            </span>
            <input
              id="contrib-amount"
              inputMode="numeric"
              required
              value={amount}
              onChange={(e) => setAmount(formatDigitsInput(e.target.value))}
              placeholder="0"
              className="tabular-nums h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-3.5 text-sm font-bold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all font-mono"
            />
          </div>
          {isOverdraft && selectedWallet && (
            <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
              Nominal melebihi saldo {selectedWallet.name} ({formatRupiah(selectedWallet.balance)}).
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="contrib-wallet"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Sumber Dana (Dompet)
          </label>
          <select
            id="contrib-wallet"
            value={walletId}
            onChange={(e) => setWalletId(Number(e.target.value))}
            className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          >
            {liquidWallets.length === 0 ? (
              <option value={0}>Belum ada dompet likuid aktif</option>
            ) : (
              liquidWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · Saldo: {formatRupiah(w.balance)}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="contrib-note"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            Catatan Tambahan (Opsional)
          </label>
          <input
            id="contrib-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: Sisa gaji minggu ini"
            className="h-11 w-full rounded-[12px] bg-[var(--surface)] border border-[var(--control-border)] px-3.5 text-sm font-semibold text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          />
        </div>
      </form>
    </ModalSheet>
  );
}
