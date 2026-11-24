import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, StateView } from "../../components/UI";
import { api, type AuditLogDto } from "../../lib/api";
import { formatShortDate } from "../../lib/format";

export function AuditLogsTab() {
  const [offset, setOffset] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const limit = 25;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-logs", offset, selectedEntity],
    queryFn: () =>
      api.getAuditLogs({
        limit,
        offset,
        entityType: selectedEntity || undefined,
      }),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const dateStr = formatShortDate(d.toISOString().slice(0, 10));
    const timeStr = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return `${dateStr} ${timeStr}`;
  };

  const formatActionName = (action: string) => {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-white">
            Log Audit & Riwayat Sistem
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Pencatatan transparan untuk setiap perubahan data penting, mutasi akun, dan aksi
            keamanan.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="audit-filter-entity"
            className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
          >
            Filter:
          </label>
          <select
            id="audit-filter-entity"
            value={selectedEntity}
            onChange={(e) => {
              setSelectedEntity(e.target.value);
              setOffset(0);
            }}
            className="min-h-[40px] rounded-[12px] border border-neutral-200 dark:border-neutral-700 bg-[#f8f9fa] dark:bg-neutral-800/70 px-3 text-xs font-semibold text-neutral-900 dark:text-white focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
          >
            <option value="">Semua Entitas</option>
            <option value="transaction">Transaksi</option>
            <option value="wallet">Dompet</option>
            <option value="debt">Utang & Cicilan</option>
            <option value="settings">Pengaturan</option>
            <option value="auth">Keamanan / PIN</option>
            <option value="recurring">Tagihan Rutin</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <StateView
          kind="loading"
          title="Memuat log audit..."
          description="Mengambil riwayat mutasi dari database."
        />
      ) : error ? (
        <StateView
          kind="error"
          title="Gagal memuat log audit"
          description={error instanceof Error ? error.message : "Terjadi kesalahan."}
          actionLabel="Coba Lagi"
          onAction={() => refetch()}
        />
      ) : logs.length === 0 ? (
        <StateView
          kind="empty"
          title="Belum Ada Aktivitas Audit"
          description="Riwayat perubahan data penting akan tercatat secara otomatis di sini."
        />
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700 rounded-[14px] border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-900">
            {logs.map((log: AuditLogDto) => (
              <div
                key={log.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 hover:bg-[#f8f9fa] dark:hover:bg-neutral-800/40 transition-colors text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-neutral-900 dark:text-white">
                      {formatActionName(log.action)}
                    </span>
                    <Badge tone="neutral" className="text-[10px] uppercase tracking-wide">
                      {log.entityType}
                    </Badge>
                    {log.entityId && (
                      <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                        #{log.entityId}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                    {formatTimestamp(log.createdAt)}
                  </p>
                </div>

                <div className="text-right max-w-md truncate">
                  {log.afterJson && (
                    <span className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300 bg-[#f8f9fa] dark:bg-neutral-800 px-2.5 py-1 rounded-[8px] border border-neutral-200 dark:border-neutral-700 inline-block max-w-full truncate">
                      {log.afterJson}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Halaman <strong className="text-neutral-900 dark:text-white">{currentPage}</strong> dari{" "}
              <strong className="text-neutral-900 dark:text-white">{totalPages}</strong> ({total} log)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                className="min-h-[38px] rounded-[12px] px-3.5 text-xs font-bold"
              >
                Sebelumnya
              </Button>
              <Button
                variant="secondary"
                disabled={offset + limit >= total}
                onClick={() => setOffset((prev) => prev + limit)}
                className="min-h-[38px] rounded-[12px] px-3.5 text-xs font-bold"
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
