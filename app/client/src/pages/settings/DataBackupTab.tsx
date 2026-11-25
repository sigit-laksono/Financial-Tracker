import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backupSnapshotV2Schema } from "../../../../shared/src/schemas";
import { AlertIcon, CheckIcon, DownloadIcon, TrashIcon, UploadIcon } from "../../components/Icons";
import { Button, ModalSheet } from "../../components/UI";
import { api, ApiError, type BackupCountsDto, type DashboardDto } from "../../lib/api";
import { formatMonthTitle } from "../../lib/format";

interface ParsedBackupPreview {
  fileName: string;
  fileSizeBytes: number;
  exportedAt: string;
  counts: BackupCountsDto;
  rawPayload: unknown;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DataBackupTab({
  data,
  onToast,
}: {
  data: DashboardDto;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exportPeriod, setExportPeriod] = useState<string>("all");
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetMode, setResetMode] = useState<"all" | "transactions">("all");
  const [resetConfirmInput, setResetConfirmInput] = useState("");
  const [resetError, setResetError] = useState("");

  const [backupPreview, setBackupPreview] = useState<ParsedBackupPreview | null>(null);
  const [fileParseError, setFileParseError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importConfirmInput, setImportConfirmInput] = useState("");
  const [importError, setImportError] = useState("");

  const csvUrl = `/api/export?format=csv&period=${encodeURIComponent(exportPeriod)}&cycle=${data.cycle}`;
  const jsonUrl = `/api/export?format=json&period=${encodeURIComponent(exportPeriod)}&cycle=${data.cycle}`;

  const clearSelectedFile = () => {
    setBackupPreview(null);
    setFileParseError("");
    setImportConfirmInput("");
    setImportError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileParseError("");
    setBackupPreview(null);
    setImportConfirmInput("");
    setImportError("");

    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Record<string, unknown>;

      if (!raw || typeof raw !== "object") {
        setFileParseError("File JSON tidak berisi objek cadangan yang valid.");
        return;
      }
      if (raw.version !== 2) {
        setFileParseError(
          "Format cadangan versi lama (v1) tidak lengkap. Silakan ekspor ulang file JSON terbaru dengan opsi Semua Periode.",
        );
        return;
      }
      if (raw.period !== "all") {
        setFileParseError(
          'File ini hanya berisi ekspor sebagian periode. Pilih file hasil "Semua Periode (Pencadangan Total)" agar data sinkron utuh.',
        );
        return;
      }

      const validated = backupSnapshotV2Schema.safeParse(raw);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        const pathLabel = issue?.path?.length ? ` (${issue.path.join(".")})` : "";
        setFileParseError(
          `Struktur file cadangan tidak valid${pathLabel}: ${issue?.message ?? "format salah"}`,
        );
        return;
      }

      const snap = validated.data;
      setBackupPreview({
        fileName: file.name,
        fileSizeBytes: file.size,
        exportedAt: snap.exportedAt,
        counts: {
          wallets: snap.wallets.length,
          categories: snap.categories.length,
          accounts: snap.accounts.length,
          installments: snap.installments.length,
          transactions: snap.transactions.length,
          transactionSplits: snap.transactionSplits.length,
          settlementAllocations: snap.settlementAllocations.length,
          budgets: snap.budgets.length,
          goals: snap.goals.length,
          assets: snap.assets.length,
          walletRecurringFees: snap.walletRecurringFees.length,
          recurringRules: snap.recurringRules.length,
        },
        rawPayload: raw,
      });
    } catch {
      setFileParseError("Gagal membaca file. Pastikan file yang dipilih berformat JSON yang valid.");
    }
  };

  const importMutation = useMutation({
    mutationFn: () => {
      if (!backupPreview) throw new Error("Tidak ada file cadangan yang dipilih.");
      return api.importBackup(backupPreview.rawPayload, importConfirmInput.trim());
    },
    onSuccess: async (res) => {
      if (res.counts.wallets > 0) {
        localStorage.setItem("ft-onboarding-completed", "true");
      } else {
        localStorage.removeItem("ft-onboarding-completed");
      }
      localStorage.removeItem("ft-last-wallet-id");
      await queryClient.invalidateQueries();
      setShowImportModal(false);
      clearSelectedFile();
      onToast(res.message ?? "Database berhasil dipulihkan dari cadangan JSON.");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal mengimpor file cadangan.";
      setImportError(msg);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetData(resetConfirmInput.trim(), resetMode),
    onSuccess: async (res) => {
      if (resetMode === "all") {
        localStorage.removeItem("ft-onboarding-completed");
        localStorage.removeItem("ft-last-wallet-id");
        localStorage.removeItem("ft-hide-onboarding-banner");
      }
      await queryClient.invalidateQueries();
      setShowResetModal(false);
      setResetConfirmInput("");
      setResetError("");
      onToast(res.message ?? "Database berhasil direset.");
      if (resetMode === "all") {
        window.location.reload();
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Gagal mereset database.";
      setResetError(msg);
    },
  });

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">Cadangan & Ekspor Data</h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
            Unduh salinan arsip data keuangan Anda dalam format CSV (spreadsheet) atau JSON (arsip
            lengkap). Untuk mencadangkan data pribadi atau memindahkan data antar perangkat, pilih{" "}
            <span className="font-semibold text-[var(--foreground)]">
              Semua Periode (Pencadangan Total)
            </span>{" "}
            lalu klik <span className="font-semibold text-[var(--foreground)]">Unduh JSON</span>.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5 flex-1 min-w-0">
            <label
              htmlFor="export-period-select"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Pilih Rentang Waktu Ekspor
            </label>
            <select
              id="export-period-select"
              value={exportPeriod}
              onChange={(e) => setExportPeriod(e.target.value)}
              className="h-11 w-full sm:w-auto sm:min-w-[260px] rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="all">Semua Periode (Pencadangan Total)</option>
              {data.availablePeriods.map((p) => (
                <option key={p} value={p}>
                  Siklus {data.cycle === "cc" ? "CC" : "Gajian"} {formatMonthTitle(p)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center">
            <a
              href={csvUrl}
              download
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[var(--control-border)] bg-[var(--card)] px-4 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors shadow-xs whitespace-nowrap"
            >
              <DownloadIcon className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>Unduh CSV</span>
            </a>
            <a
              href={jsonUrl}
              download
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[var(--control-border)] bg-[var(--card)] px-4 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors shadow-xs whitespace-nowrap"
            >
              <DownloadIcon className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>Unduh JSON</span>
            </a>
          </div>
        </div>
      </div>

      {/* Import / Restore Section */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">
            Impor & Pulihkan Snapshot (JSON)
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
            Pulihkan seluruh isi database dari file cadangan JSON v2 (Semua Periode). Proses ini
            mengganti seluruh data dompet, kategori, transaksi, alokasi kartu kredit, utang/cicilan,
            anggaran, target, aset, dan pengaturan siklus agar{" "}
            <span className="font-semibold text-[var(--foreground)]">100% identik</span>{" "}
            (PIN & log aktivitas lokal tetap aman).
          </p>
        </div>

        <input
          ref={fileInputRef}
          id="backup-import-file"
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="sr-only"
        />

        {!backupPreview ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-dashed border-[var(--control-border)] bg-[var(--surface)] p-4 sm:p-5">
            <div className="space-y-1 flex-1 min-w-[220px]">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Pilih file <span className="font-mono text-xs">financial-tracker-all.json</span>
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                File akan diperiksa dan ditampilkan ringkasannya terlebih dahulu sebelum menimpa database.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto min-h-[44px] rounded-[14px] px-4 text-sm font-semibold shadow-xs"
            >
              <UploadIcon className="w-4 h-4 text-[var(--primary)]" />
              <span>Pilih File JSON</span>
            </Button>
          </div>
        ) : (
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <CheckIcon className="w-4 h-4 text-[var(--primary)] shrink-0" />
                  <p className="text-sm font-bold text-[var(--foreground)] break-all">
                    {backupPreview.fileName}
                  </p>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Ukuran {formatFileSize(backupPreview.fileSizeBytes)} · Diekspor pada{" "}
                  {new Date(backupPreview.exportedAt).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={clearSelectedFile}
                className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-2"
              >
                Ganti File
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: "Dompet", value: backupPreview.counts.wallets },
                { label: "Transaksi", value: backupPreview.counts.transactions },
                { label: "Kategori", value: backupPreview.counts.categories },
                { label: "Utang/Cicilan", value: backupPreview.counts.accounts },
                { label: "Jadwal Cicilan", value: backupPreview.counts.installments },
                { label: "Anggaran", value: backupPreview.counts.budgets },
                { label: "Target Tabungan", value: backupPreview.counts.goals },
                { label: "Aset", value: backupPreview.counts.assets },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <p className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                    {stat.label}
                  </p>
                  <p className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                    {stat.value.toLocaleString("id-ID")}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--border)] pt-3">
              <Button
                variant="secondary"
                onClick={clearSelectedFile}
                className="min-h-[44px] rounded-[12px] px-4 text-xs font-bold"
              >
                Batal
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setImportConfirmInput("");
                  setImportError("");
                  setShowImportModal(true);
                }}
                className="min-h-[44px] rounded-[12px] px-4 text-xs font-bold"
              >
                <UploadIcon className="w-3.5 h-3.5" />
                <span>Pulihkan Data Dari File Ini</span>
              </Button>
            </div>
          </div>
        )}

        {fileParseError && (
          <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
            {fileParseError}
          </p>
        )}
      </div>

      {/* Danger Zone: Reset Database */}
      <div className="rounded-[18px] border border-rose-200 dark:border-rose-900/40 bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-[var(--destructive)]">
          <AlertIcon className="w-5 h-5" />
          <h3 className="text-base font-bold">Zona Bahaya: Reset Database</h3>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
          Pilih tingkat reset data sesuai kebutuhan Anda. Tindakan ini tidak dapat dibatalkan.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          {/* Opsi 1: Reset Transaksi Saja */}
          <div className="flex flex-col justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3.5">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-[var(--foreground)]">
                Reset Mutasi Transaksi Saja
              </h4>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Menghapus seluruh catatan pengeluaran, pemasukan, dan transfer. Konfigurasi dompet
                bank, kartu kredit, dan kategori tetap dipertahankan.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setResetMode("transactions");
                setResetConfirmInput("");
                setResetError("");
                setShowResetModal(true);
              }}
              className="gap-2 min-h-[44px] rounded-[12px] text-xs font-bold text-[var(--destructive)] hover:border-[var(--destructive)]"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              <span>Reset Transaksi Saja</span>
            </Button>
          </div>

          {/* Opsi 2: Reset Total / Mulai dari Nol */}
          <div className="flex flex-col justify-between rounded-[14px] border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-4 space-y-3.5">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-[var(--destructive)]">
                Reset Total (Mulai Dari Nol)
              </h4>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Menghapus SELURUH data: transaksi, rekening bank, kartu kredit, utang/cicilan,
                celengan, dan aset. Aplikasi kembali kosong murni dan langsung membuka Onboarding
                untuk setup akun dari awal.
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                setResetMode("all");
                setResetConfirmInput("");
                setResetError("");
                setShowResetModal(true);
              }}
              className="gap-2 min-h-[44px] rounded-[12px] text-xs font-bold"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              <span>Reset Total Dari Nol</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Import Confirmation Modal */}
      <ModalSheet
        open={showImportModal}
        onClose={() => {
          if (!importMutation.isPending) setShowImportModal(false);
        }}
        title="Konfirmasi Impor & Pulihkan Data"
        subtitle="Seluruh data keuangan di database saat ini akan diganti total agar identik dengan isi file cadangan."
        footer={
          <div className="flex justify-end gap-2.5">
            <Button
              variant="secondary"
              disabled={importMutation.isPending}
              onClick={() => setShowImportModal(false)}
              className="min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={importConfirmInput !== "IMPORT_CONFIRMED" || importMutation.isPending}
              onClick={() => importMutation.mutate()}
              className="min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              {importMutation.isPending ? "Memulihkan..." : "Pulihkan Sekarang"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[14px] border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Pastikan Anda sudah memilih file cadangan yang benar ({backupPreview?.fileName}). Ketik{" "}
            <strong className="font-mono font-bold">IMPORT_CONFIRMED</strong> di bawah ini untuk
            melanjutkan pemulihan data:
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="import-confirm-text"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Ketik IMPORT_CONFIRMED
            </label>
            <input
              id="import-confirm-text"
              type="text"
              value={importConfirmInput}
              onChange={(e) => {
                setImportConfirmInput(e.target.value);
                setImportError("");
              }}
              placeholder="IMPORT_CONFIRMED"
              className="min-h-[44px] w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-mono font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>

          {importError && (
            <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
              {importError}
            </p>
          )}
        </div>
      </ModalSheet>

      {/* Reset Confirmation Modal */}
      <ModalSheet
        open={showResetModal}
        onClose={() => setShowResetModal(false)}
        title={
          resetMode === "all"
            ? "Konfirmasi Reset Total (Mulai Dari Nol)"
            : "Konfirmasi Reset Seluruh Transaksi"
        }
        subtitle={
          resetMode === "all"
            ? "Semua data dompet, kartu kredit, utang, celengan, aset, dan mutasi akan dihapus permanen."
            : "Semua riwayat mutasi pengeluaran, pemasukan, dan transfer akan dihapus permanen."
        }
        footer={
          <div className="flex justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setShowResetModal(false)}
              className="min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={
                resetConfirmInput !== (resetMode === "all" ? "RESET_ALL_CONFIRMED" : "RESET_CONFIRMED") ||
                resetMutation.isPending
              }
              onClick={() => resetMutation.mutate()}
              className="min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              {resetMutation.isPending
                ? "Mereset..."
                : resetMode === "all"
                  ? "Reset Total & Bersihkan"
                  : "Hapus Transaksi"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[14px] border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/30 p-4 text-xs text-[var(--destructive)] leading-relaxed">
            {resetMode === "all" ? (
              <>
                Ketik teks konfirmasi <strong className="font-mono font-bold">RESET_ALL_CONFIRMED</strong>{" "}
                di bawah ini untuk menghapus seluruh data dan memulai ulang dari onboarding:
              </>
            ) : (
              <>
                Ketik teks konfirmasi <strong className="font-mono font-bold">RESET_CONFIRMED</strong>{" "}
                di bawah ini untuk menghapus mutasi transaksi:
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="reset-confirm-text"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Ketik {resetMode === "all" ? "RESET_ALL_CONFIRMED" : "RESET_CONFIRMED"}
            </label>
            <input
              id="reset-confirm-text"
              type="text"
              value={resetConfirmInput}
              onChange={(e) => {
                setResetConfirmInput(e.target.value);
                setResetError("");
              }}
              placeholder={resetMode === "all" ? "RESET_ALL_CONFIRMED" : "RESET_CONFIRMED"}
              className="min-h-[44px] w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-mono font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>

          {resetError && (
            <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
              {resetError}
            </p>
          )}
        </div>
      </ModalSheet>
    </div>
  );
}
