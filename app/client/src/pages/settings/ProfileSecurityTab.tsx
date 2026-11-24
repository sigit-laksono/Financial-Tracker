import { useState, type FormEvent } from "react";
import { AlertIcon, LockIcon, MoonIcon, SunIcon } from "../../components/Icons";
import { Badge, Button, Card } from "../../components/UI";
import { api, ApiError } from "../../lib/api";

export type ThemePref = "light" | "dark" | "system";

export function ProfileSecurityTab({
  theme,
  pinConfigured,
  onThemeChange,
  onAuthChanged,
  onToast,
}: {
  theme: ThemePref;
  pinConfigured: boolean;
  onThemeChange: (next: ThemePref) => void;
  onAuthChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handlePinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPinError("");
    setIsPending(true);
    try {
      if (!pinConfigured) {
        if (newPin.trim().length < 4) {
          setPinError("PIN minimal 4 karakter.");
          return;
        }
        await api.setupPin(newPin.trim());
        setNewPin("");
        onAuthChanged();
        onToast("PIN keamanan diaktifkan");
        return;
      }
      await api.changePin(currentPin, newPin.trim() || null);
      setCurrentPin("");
      setNewPin("");
      onAuthChanged();
      onToast(newPin.trim() ? "PIN diperbarui" : "Kunci PIN dinonaktifkan");
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : "Gagal memperbarui PIN.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Appearance Card */}
        <Card className="space-y-4 rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs">
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">Tampilan Tema</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Sesuaikan preferensi pencahayaan layar untuk kenyamanan visual Anda.
            </p>
          </div>
          <fieldset className="grid grid-cols-3 gap-1.5 p-1.5 rounded-[16px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 m-0">
            <legend className="sr-only">Pilih tema tampilan</legend>
            {(
              [
                ["light", "Terang", <SunIcon key="sun" className="w-4 h-4" />],
                ["dark", "Gelap", <MoonIcon key="moon" className="w-4 h-4" />],
                ["system", "Sistem", null],
              ] as const
            ).map(([key, label, icon]) => {
              const active = theme === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onThemeChange(key)}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[12px] text-xs font-bold transition-all ${
                    active
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-neutral-700/50"
                  }`}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              );
            })}
          </fieldset>
        </Card>

        {/* Security PIN Card */}
        <Card className="space-y-4 rounded-[18px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <LockIcon className="w-4 h-4 text-[var(--primary)]" />
              <h2 className="text-base font-bold text-[var(--foreground)]">Keamanan & Kunci PIN</h2>
            </div>
            <Badge tone={pinConfigured ? "soft" : "neutral"}>
              {pinConfigured ? "PIN Aktif" : "Belum Diatur"}
            </Badge>
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">
            Proteksi privasi catatan keuangan Anda saat perangkat ditinggal atau berpindah tangan.
          </p>

          <form onSubmit={handlePinSubmit} className="space-y-3.5">
            {pinConfigured && (
              <div className="space-y-1.5">
                <label
                  htmlFor="pin-current"
                  className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
                >
                  PIN Saat Ini
                </label>
                <input
                  id="pin-current"
                  type="password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="••••"
                  className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono tracking-widest"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label
                htmlFor="pin-next"
                className="block text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
              >
                {pinConfigured
                  ? "PIN Baru (kosongkan jika ingin mematikan kunci)"
                  : "Buat PIN Baru (minimal 4 karakter)"}
              </label>
              <input
                id="pin-next"
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="••••"
                className="w-full rounded-[14px] bg-[#f8f9fa] dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/25 transition-all font-mono tracking-widest"
              />
            </div>

            {pinError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[14px] border border-[var(--destructive)] bg-[var(--surface)] p-3 text-xs text-[var(--destructive)]"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{pinError}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 pt-1">
              <Button type="submit" disabled={isPending} className="min-h-[44px] rounded-[14px] px-5 font-bold">
                {isPending ? "Memproses..." : pinConfigured ? "Simpan PIN" : "Aktifkan PIN"}
              </Button>
              {pinConfigured && (
                <>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={async () => {
                      await api.logout();
                      onAuthChanged();
                    }}
                    className="min-h-[44px] rounded-[14px] font-semibold"
                  >
                    Kunci Sekarang
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={async () => {
                      await api.logoutAll();
                      onAuthChanged();
                      onToast("Semua sesi perangkat lain dicabut");
                    }}
                    className="min-h-[44px] rounded-[14px] font-semibold"
                  >
                    Kunci Semua Sesi
                  </Button>
                </>
              )}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
