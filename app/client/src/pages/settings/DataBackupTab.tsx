import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertIcon, DownloadIcon, TrashIcon } from "../../components/Icons";
import { Button, Card, ModalSheet } from "../../components/UI";
import { api, ApiError, type DashboardDto } from "../../lib/api";
import { formatMonthTitle } from "../../lib/format";

export function DataBackupTab({
  data,
  onToast,
}: {
  data: DashboardDto;
  onToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [exportPeriod, setExportPeriod] = useState<string>("all");
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetMode, setResetMode] = useState<"all" | "transactions">("all");
  const [resetConfirmInput, setResetConfirmInput] = useState("");
  const [resetError, setResetError] = useState("");

  const csvUrl = `/api/export?format=csv&period=${encodeURIComponent(exportPeriod)}&cycle=${data.cycle}`;
  const jsonUrl = `/api/export?format=json&period=${encodeURIComponent(exportPeriod)}&cycle=${data.cycle}`;

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
      <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-white">Cadangan & Ekspor Data</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Unduh salinan arsip data keuangan Anda dalam format CSV (spreadsheet) atau JSON (arsip
            terstruktur).
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 p-4 sm:p-5">
          <div className="space-y-1.5 flex-1 min-w-[240px]">
            <label
              htmlFor="export-period-select"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              Pilih Rentang Waktu Ekspor
            </label>
            <select
              id="export-period-select"
              value={exportPeriod}
              onChange={(e) => setExportPeriod(e.target.value)}
              className="w-full sm:w-auto min-h-[44px] rounded-[14px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="all">Semua Periode (Pencadangan Total)</option>
              {data.availablePeriods.map((p) => (
                <option key={p} value={p}>
                  Siklus {data.cycle === "cc" ? "CC" : "Gajian"} {formatMonthTitle(p)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={csvUrl}
              download
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 text-sm font-semibold text-neutral-900 dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-xs"
            >
              <DownloadIcon className="w-4 h-4 text-[var(--primary)]" />
              <span>Unduh CSV</span>
            </a>
            <a
              href={jsonUrl}
              download
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 text-sm font-semibold text-neutral-900 dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-xs"
            >
              <DownloadIcon className="w-4 h-4 text-[var(--primary)]" />
              <span>Unduh JSON</span>
            </a>
          </div>
        </div>
      </div>

      {/* Danger Zone: Reset Database */}
      <div className="rounded-[18px] border border-red-200 dark:border-red-900/40 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertIcon className="w-5 h-5" />
          <h3 className="text-base font-bold">Zona Bahaya: Reset Database</h3>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
          Pilih tingkat reset data sesuai kebutuhan Anda. Tindakan ini tidak dapat dibatalkan.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          {/* Opsi 1: Reset Transaksi Saja */}
          <div className="flex flex-col justify-between rounded-[14px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/40 p-4 space-y-3.5">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Reset Mutasi Transaksi Saja</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Menghapus seluruh catatan pengeluaran, pemasukan, dan transfer. Konfigurasi dompet bank,
                kartu kredit, dan kategori tetap dipertahankan.
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
              className="gap-2 min-h-[42px] rounded-[12px] text-xs font-bold text-red-600 dark:text-red-400 hover:border-red-400"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              <span>Reset Transaksi Saja</span>
            </Button>
          </div>

          {/* Opsi 2: Reset Total / Mulai dari Nol */}
          <div className="flex flex-col justify-between rounded-[14px] border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 p-4 space-y-3.5">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-red-600 dark:text-red-400">Reset Total (Mulai Dari Nol)</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Menghapus SELURUH data: transaksi, rekening bank, kartu kredit, hutang/cicilan, celengan, dan aset.
                Aplikasi kembali kosong murni dan langsung membuka Onboarding untuk setup akun dari awal.
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
              className="gap-2 min-h-[42px] rounded-[12px] text-xs font-bold"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              <span>Reset Total Dari Nol</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
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
            ? "Semua data dompet, kartu kredit, hutang, celengan, aset, dan mutasi akan dihapus permanen."
            : "Semua riwayat mutasi pengeluaran, pemasukan, dan transfer akan dihapus permanen."
        }
      >
        <div className="space-y-4">
          <div className="rounded-[14px] border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-600 dark:text-red-400 leading-relaxed">
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
            <label htmlFor="reset-confirm-text" className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
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
              className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-mono font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
          </div>

          {resetError && (
            <p role="alert" className="text-xs font-semibold text-red-500">
              {resetError}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <Button variant="secondary" onClick={() => setShowResetModal(false)} className="min-h-[44px] rounded-[14px] px-5 font-bold">
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
        </div>
      </ModalSheet>
    </div>
  );
}
