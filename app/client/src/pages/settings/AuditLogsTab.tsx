import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, StateView } from "../../components/UI";
import { api, type AuditLogDto } from "../../lib/api";
import { formatMonthTitle, formatRupiah, formatShortDate } from "../../lib/format";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  transaction: "Transaksi",
  wallet: "Dompet",
  debt: "Utang & Cicilan",
  debt_account: "Utang & Cicilan",
  installment: "Jadwal Angsuran",
  settings: "Pengaturan",
  auth: "Keamanan",
  recurring: "Tagihan Rutin",
  recurring_rule: "Tagihan Rutin",
  salary: "Gaji",
  backup: "Cadangan",
};

const ACTION_LABELS: Record<string, string> = {
  import_backup: "Impor Cadangan Data",
  receive_salary: "Catat Gaji Masuk",
  update_debt_account: "Perbarui Akun Utang",
  delete_debt_account: "Hapus Akun Utang",
  early_payoff: "Pelunasan Dipercepat",
  unsettle: "Batalkan Pelunasan",
  update_settings: "Perbarui Pengaturan",
  reset_all_database: "Reset Total Database",
  reset_database: "Reset Transaksi Database",
  create_transaction: "Tambah Transaksi",
  create: "Tambah Data",
  update: "Perbarui Data",
  delete: "Hapus Data",
  reconcile: "Cocokkan Saldo",
  change_pin: "Ubah PIN Keamanan",
};

const FIELD_LABELS: Record<string, string> = {
  exportedAt: "Waktu Ekspor",
  importedAt: "Waktu Impor",
  createdAt: "Waktu Dibuat",
  updatedAt: "Waktu Diperbarui",
  period: "Periode",
  lastPaidPeriod: "Periode Terakhir Dibayar",
  firstPeriod: "Periode Awal",
  ccCycleKey: "Siklus Kartu Kredit",
  grossSalary: "Gaji Kotor",
  netSalary: "Gaji Bersih",
  payrollDeduction: "Potongan Kantor",
  totalPayrollDue: "Total Potongan Angsuran",
  amount: "Nominal",
  balance: "Saldo",
  actualBalance: "Saldo Riil",
  openingBalance: "Saldo Awal",
  previousBalance: "Saldo Sebelumnya",
  newBalance: "Saldo Baru",
  delta: "Selisih",
  creditLimit: "Limit Kartu",
  cardLimit: "Limit Kartu",
  limitAmount: "Limit Anggaran",
  payoffAmount: "Nominal Pelunasan",
  plannedAmount: "Nominal Rencana",
  principalAmount: "Pokok Pinjaman",
  interestAmount: "Bunga",
  initialBalance: "Saldo Awal Utang",
  adminFee: "Biaya Admin",
  merchant: "Merchant / Deskripsi",
  category: "Kategori",
  name: "Nama",
  lender: "Pemberi Pinjaman",
  walletId: "ID Dompet",
  defaultSalaryWalletId: "ID Dompet Gaji",
  gajianStartDay: "Tanggal Gajian",
  cardCutoffDay: "Tanggal Tutup Buku",
  statementDay: "Tanggal Cetak Tagihan",
  cardPaymentDay: "Tanggal Jatuh Tempo",
  dueDay: "Tanggal Jatuh Tempo",
  transactionDate: "Tanggal Transaksi",
  dueDate: "Tanggal Jatuh Tempo",
  paymentDate: "Tanggal Bayar",
  firstDueDate: "Jatuh Tempo Pertama",
  isActive: "Status Aktif",
  pinConfigured: "PIN Aktif",
  mode: "Mode",
  type: "Tipe",
  kind: "Jenis",
  paymentMethod: "Metode Pembayaran",
  paidInstallmentsCount: "Angsuran Terbayar",
  settledCount: "Cicilan Dilunasi",
  counts: "Ringkasan Data",
  wallets: "Dompet",
  categories: "Kategori",
  accounts: "Akun Utang",
  installments: "Jadwal Cicilan",
  transactions: "Transaksi",
  budgets: "Anggaran",
  goals: "Target",
  assets: "Aset",
};

const AMOUNT_KEYS = new Set([
  "grossSalary",
  "netSalary",
  "payrollDeduction",
  "totalPayrollDue",
  "amount",
  "balance",
  "actualBalance",
  "openingBalance",
  "previousBalance",
  "newBalance",
  "delta",
  "creditLimit",
  "cardLimit",
  "limitAmount",
  "payoffAmount",
  "plannedAmount",
  "principalAmount",
  "interestAmount",
  "initialBalance",
  "adminFee",
]);

const TIMESTAMP_KEYS = new Set(["exportedAt", "importedAt", "createdAt", "updatedAt"]);
const PERIOD_KEYS = new Set(["period", "lastPaidPeriod", "firstPeriod", "ccCycleKey"]);
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PERIOD_REGEX = /^\d{4}-\d{2}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function humanizeFallback(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function translateEntityType(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? humanizeFallback(entityType);
}

export function translateAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? humanizeFallback(action);
}

function formatJakartaDateTime(input: number | string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  const datePart = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(date);
  return `${datePart} ${timePart} WIB`;
}

export interface FormattedAuditEntry {
  key: string;
  label: string;
  value: string;
}

function formatScalarValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Ya" : "Tidak";
  if (typeof val === "number") {
    if (AMOUNT_KEYS.has(key) || /amount|balance|salary|limit|fee|delta|nominal/i.test(key)) {
      return formatRupiah(val);
    }
    return val.toLocaleString("id-ID");
  }
  if (typeof val === "string") {
    if ((TIMESTAMP_KEYS.has(key) && !Number.isNaN(Date.parse(val))) || ISO_UTC_REGEX.test(val)) {
      return formatJakartaDateTime(val);
    }
    if ((PERIOD_KEYS.has(key) && PERIOD_REGEX.test(val)) || PERIOD_REGEX.test(val)) {
      return formatMonthTitle(val);
    }
    if (DATE_ONLY_REGEX.test(val)) {
      return formatShortDate(val);
    }
    return val || "—";
  }
  if (Array.isArray(val)) {
    return `${val.length} item`;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "—";
    return entries
      .map(([k, v]) => `${FIELD_LABELS[k] ?? humanizeFallback(k)}: ${formatScalarValue(k, v)}`)
      .join(" · ");
  }
  return String(val);
}

export function formatAuditPayload(jsonStr: string | null): {
  entries: FormattedAuditEntry[];
  rawPretty: string;
} {
  if (!jsonStr) {
    return { entries: [], rawPretty: "" };
  }
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    const rawPretty = JSON.stringify(parsed, null, 2);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        entries: [
          {
            key: "value",
            label: "Nilai",
            value: formatScalarValue("value", parsed),
          },
        ],
        rawPretty,
      };
    }

    const entries: FormattedAuditEntry[] = [];
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length <= 12
      ) {
        for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
          entries.push({
            key: `${key}.${subKey}`,
            label: `${FIELD_LABELS[key] ?? humanizeFallback(key)} · ${FIELD_LABELS[subKey] ?? humanizeFallback(subKey)}`,
            value: formatScalarValue(subKey, subVal),
          });
        }
      } else {
        entries.push({
          key,
          label: FIELD_LABELS[key] ?? humanizeFallback(key),
          value: formatScalarValue(key, value),
        });
      }
    }
    return { entries, rawPretty };
  } catch {
    return {
      entries: [{ key: "raw", label: "Catatan", value: jsonStr }],
      rawPretty: jsonStr,
    };
  }
}

function PayloadDetailPanel({
  log,
  showRaw,
  onToggleRaw,
}: {
  log: AuditLogDto;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const afterFormatted = useMemo(() => formatAuditPayload(log.afterJson), [log.afterJson]);
  const beforeFormatted = useMemo(() => formatAuditPayload(log.beforeJson), [log.beforeJson]);
  const hasPayload = Boolean(log.afterJson || log.beforeJson);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--foreground)]">
              {translateAuditAction(log.action)}
            </h3>
            <Badge tone="neutral">{translateEntityType(log.entityType)}</Badge>
            {log.entityId !== null && (
              <span className="font-mono text-xs text-[var(--muted-foreground)]">
                #{log.entityId}
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-[var(--muted-foreground)]">
            {formatJakartaDateTime(log.createdAt)}
          </p>
        </div>

        {hasPayload && (
          <button
            type="button"
            onClick={onToggleRaw}
            className="inline-flex min-h-[36px] items-center rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap"
          >
            {showRaw ? "Sembunyikan JSON Mentah" : "Lihat JSON Mentah"}
          </button>
        )}
      </div>

      {!hasPayload ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Tidak ada detail perubahan tambahan pada catatan aktivitas ini.
        </p>
      ) : (
        <div className="space-y-4">
          {beforeFormatted.entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                Sebelum Perubahan
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {beforeFormatted.entries.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <dt className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                      {item.label}
                    </dt>
                    <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)] break-words tabular-nums">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {afterFormatted.entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                {beforeFormatted.entries.length > 0 ? "Sesudah Perubahan" : "Detail Aktivitas"}
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {afterFormatted.entries.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <dt className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                      {item.label}
                    </dt>
                    <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)] break-words tabular-nums">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {showRaw && (
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                JSON Mentah
              </p>
              {beforeFormatted.rawPretty && (
                <pre className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 font-mono text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                  {`// beforeJson\n${beforeFormatted.rawPretty}`}
                </pre>
              )}
              {afterFormatted.rawPretty && (
                <pre className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 font-mono text-[11px] text-[var(--foreground)] leading-relaxed">
                  {afterFormatted.rawPretty}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditLogsTab() {
  const [offset, setOffset] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [expandedMobileId, setExpandedMobileId] = useState<number | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
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

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => {
      const actionLabel = translateAuditAction(log.action).toLowerCase();
      const entityLabel = translateEntityType(log.entityType).toLowerCase();
      return (
        actionLabel.includes(q) ||
        entityLabel.includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entityType.toLowerCase().includes(q) ||
        (log.entityId !== null && `#${log.entityId}`.includes(q)) ||
        (log.afterJson?.toLowerCase().includes(q) ?? false) ||
        (log.beforeJson?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [logs, searchQuery]);

  useEffect(() => {
    if (filteredLogs.length === 0) {
      setSelectedLogId(null);
      return;
    }
    if (!filteredLogs.some((item) => item.id === selectedLogId)) {
      setSelectedLogId(filteredLogs[0]!.id);
    }
  }, [filteredLogs, selectedLogId]);

  const activeLog = useMemo(
    () => filteredLogs.find((item) => item.id === selectedLogId) ?? filteredLogs[0] ?? null,
    [filteredLogs, selectedLogId],
  );

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-5">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">
            Log Audit & Riwayat Sistem
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            Pencatatan transparan untuk setiap perubahan data penting, mutasi akun, dan aksi
            keamanan (zona waktu WIB).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="search"
            aria-label="Cari log aktivitas"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari aksi, entitas, atau detail..."
            className="h-11 w-full sm:w-56 rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-xs font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
          />
          <select
            id="audit-filter-entity"
            aria-label="Filter entitas log audit"
            value={selectedEntity}
            onChange={(e) => {
              setSelectedEntity(e.target.value);
              setOffset(0);
            }}
            className="h-11 w-full sm:w-auto rounded-[12px] border border-[var(--control-border)] bg-[var(--surface)] px-3.5 text-xs font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
          >
            <option value="">Semua Entitas</option>
            <option value="transaction">Transaksi</option>
            <option value="wallet">Dompet</option>
            <option value="debt_account">Utang &amp; Cicilan</option>
            <option value="installment">Jadwal Angsuran</option>
            <option value="salary">Gaji</option>
            <option value="recurring_rule">Tagihan Rutin</option>
            <option value="settings">Pengaturan</option>
            <option value="auth">Keamanan / PIN</option>
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
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--muted-foreground)]">
          Tidak ada log yang cocok dengan pencarian &ldquo;{searchQuery}&rdquo; pada halaman ini.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Desktop Master-Detail Split View & Mobile Expandable List */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Master List */}
            <div className="lg:col-span-5 divide-y divide-[var(--border)] rounded-[14px] border border-[var(--border)] overflow-hidden bg-[var(--card)]">
              {filteredLogs.map((log: AuditLogDto) => {
                const isSelectedDesktop = activeLog?.id === log.id;
                const isExpandedMobile = expandedMobileId === log.id;
                const previewEntries = formatAuditPayload(log.afterJson ?? log.beforeJson).entries;
                const summaryLine = previewEntries
                  .slice(0, 2)
                  .map((item) => `${item.label}: ${item.value}`)
                  .join(" · ");

                return (
                  <div key={log.id} className="bg-[var(--card)]">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLogId(log.id);
                        setExpandedMobileId((prev) => (prev === log.id ? null : log.id));
                        setShowRawJson(false);
                      }}
                      className={`w-full text-left px-3.5 py-3 transition-colors space-y-1.5 ${
                        isSelectedDesktop
                          ? "lg:bg-[var(--surface)] lg:border-l-4 lg:border-l-[var(--primary)]"
                          : "hover:bg-[var(--surface)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="text-xs font-bold text-[var(--foreground)]">
                            {translateAuditAction(log.action)}
                          </span>
                          <Badge tone="neutral" className="text-[11px]">
                            {translateEntityType(log.entityType)}
                          </Badge>
                          {log.entityId !== null && (
                            <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                              #{log.entityId}
                            </span>
                          )}
                        </div>
                        <span className="lg:hidden text-[11px] font-semibold text-[var(--primary)] shrink-0">
                          {isExpandedMobile ? "Tutup ▲" : "Detail ▼"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                          {formatJakartaDateTime(log.createdAt)}
                        </span>
                      </div>

                      {summaryLine && (
                        <p className="text-[11px] text-[var(--muted-foreground)] line-clamp-1">
                          {summaryLine}
                        </p>
                      )}
                    </button>

                    {/* Mobile Expandable Row Detail */}
                    {isExpandedMobile && (
                      <div className="lg:hidden border-t border-[var(--border)] bg-[var(--surface)] p-3.5">
                        <PayloadDetailPanel
                          log={log}
                          showRaw={showRawJson}
                          onToggleRaw={() => setShowRawJson((v) => !v)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Detail Panel */}
            <div className="hidden lg:block lg:col-span-7 lg:sticky lg:top-6 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
              {activeLog ? (
                <PayloadDetailPanel
                  log={activeLog}
                  showRaw={showRawJson}
                  onToggleRaw={() => setShowRawJson((v) => !v)}
                />
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Pilih salah satu baris log di sebelah kiri untuk melihat detail perubahan.
                </p>
              )}
            </div>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
            <span className="text-xs text-[var(--muted-foreground)]">
              Halaman <strong className="text-[var(--foreground)]">{currentPage}</strong> dari{" "}
              <strong className="text-[var(--foreground)]">{totalPages}</strong> ({total} log)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                className="min-h-[44px] rounded-[12px] px-3.5 text-xs font-bold"
              >
                Sebelumnya
              </Button>
              <Button
                variant="secondary"
                disabled={offset + limit >= total}
                onClick={() => setOffset((prev) => prev + limit)}
                className="min-h-[44px] rounded-[12px] px-3.5 text-xs font-bold"
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
