import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/UI";
import { api, ApiError, type DashboardDto } from "../../lib/api";
import { formatDigitsInput, formatRupiah, parsePositiveInt } from "../../lib/format";
import { budgetKeys } from "../../lib/queryKeys";

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

  useEffect(() => {
    setGrossSalary(data.settings.grossSalary.toLocaleString("id-ID"));
    setPayrollDeduction(data.settings.payrollDeduction.toLocaleString("id-ID"));
    setNetSalary(data.settings.netSalary.toLocaleString("id-ID"));
    setCycleType(data.settings.gajianStartDay === 1 ? "monthly" : "gajian");
    setGajianStartDay(String(data.settings.gajianStartDay));
    setDefaultSalaryWalletId(data.settings.defaultSalaryWalletId ?? null);
  }, [data.settings]);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    await queryClient.invalidateQueries({ queryKey: ["budgets"] });
    await queryClient.invalidateQueries({ queryKey: budgetKeys.summaryRoot });
    await queryClient.invalidateQueries({ queryKey: ["goals"] });
    await queryClient.invalidateQueries({ queryKey: ["salary-preview"] });
  };

  const settingsMutation = useMutation({
    mutationFn: () => {
      const parsedGross = parsePositiveInt(grossSalary);
      const parsedDeduction = parsePositiveInt(payrollDeduction);
      const parsedNet = parsePositiveInt(netSalary);
      if (
        parsedGross > 2_147_483_647 ||
        parsedDeduction > 2_147_483_647 ||
        parsedNet > 2_147_483_647
      ) {
        throw new Error("Nominal gaji maksimal Rp 2.147.483.647.");
      }
      return api.updateSettings({
        grossSalary: parsedGross,
        payrollDeduction: parsedDeduction,
        netSalary: parsedNet,
        gajianStartDay: Number(gajianStartDay),
        defaultSalaryWalletId: defaultSalaryWalletId || null,
      });
    },
    onSuccess: async () => {
      await invalidateAll();
      onToast("Pengaturan gaji & siklus disimpan");
    },
    onError: (err) => {
      onToast(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan.");
    },
  });

  return (
    <div className="space-y-6">
      {/* Salary & Cycle Rules */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">
            Aturan Gaji & Siklus Anggaran
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
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
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-3.5">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
              Mode Siklus Anggaran Utama
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition-all ${
                  cycleType === "monthly"
                    ? "border-[var(--primary)] bg-[var(--card)] ring-2 ring-[var(--primary)]/25 shadow-xs"
                    : "border-[var(--border)] bg-[var(--card)]/70 hover:border-[var(--control-border)]"
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
                  <span className="block text-sm font-bold text-[var(--foreground)]">
                    Bulanan Kalender (Tgl 1 - Akhir Bulan)
                  </span>
                  <span className="block text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                    Anggaran dihitung per 1 bulan kalender (contoh: 1 Okt s/d 31 Okt). Cocok untuk
                    pebisnis atau penghasilan awal bulan.
                  </span>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition-all ${
                  cycleType === "gajian"
                    ? "border-[var(--primary)] bg-[var(--card)] ring-2 ring-[var(--primary)]/25 shadow-xs"
                    : "border-[var(--border)] bg-[var(--card)]/70 hover:border-[var(--control-border)]"
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
                  <span className="block text-sm font-bold text-[var(--foreground)]">
                    Siklus Gajian (Payroll Cycle)
                  </span>
                  <span className="block text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
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
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
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
                  className="min-h-[44px] w-full rounded-[14px] bg-[var(--card)] border border-[var(--control-border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] tabular-nums font-mono focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
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
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Gaji Bersih / Take-Home Pay (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--muted-foreground)]">
                  Rp
                </span>
                <input
                  id="set-net"
                  inputMode="numeric"
                  value={netSalary}
                  onChange={(e) => setNetSalary(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="min-h-[44px] w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="set-gross"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Gaji Kotor (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--muted-foreground)]">
                  Rp
                </span>
                <input
                  id="set-gross"
                  inputMode="numeric"
                  value={grossSalary}
                  onChange={(e) => setGrossSalary(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="min-h-[44px] w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="set-ded"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Potongan Kantor (Rp)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--muted-foreground)]">
                  Rp
                </span>
                <input
                  id="set-ded"
                  inputMode="numeric"
                  value={payrollDeduction}
                  onChange={(e) => setPayrollDeduction(formatDigitsInput(e.target.value))}
                  placeholder="0"
                  className="min-h-[44px] w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] pl-11 pr-4 py-2.5 text-sm font-semibold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] font-mono tabular-nums focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="set-def-salary-wallet"
              className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Dompet Penerima Gaji Default
            </label>
            <select
              id="set-def-salary-wallet"
              value={defaultSalaryWalletId ?? ""}
              onChange={(e) =>
                setDefaultSalaryWalletId(e.target.value ? Number(e.target.value) : null)
              }
              className="h-11 w-full rounded-[14px] bg-[var(--surface)] border border-[var(--control-border)] px-4 text-sm font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
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

          <div className="flex border-t border-[var(--border)] pt-3">
            <Button
              type="submit"
              disabled={settingsMutation.isPending}
              className="w-full sm:w-auto sm:ml-auto min-h-[44px] rounded-[14px] px-5 font-bold"
            >
              {settingsMutation.isPending ? "Menyimpan..." : "Simpan Aturan Gaji & Siklus"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
