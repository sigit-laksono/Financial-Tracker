import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { AlertIcon, LockIcon } from "./Icons";
import { Button, Card } from "./UI";

const MIN_PIN_LENGTH = 4;

export function LockScreen({
  mode = "unlock",
  onUnlocked,
}: {
  /** "setup" is shown when the server requires a PIN but none has been created yet. */
  mode?: "unlock" | "setup";
  onUnlocked: () => void;
}) {
  const isSetup = mode === "setup";
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed) {
      setError(
        isSetup
          ? "Buat PIN atau kata sandi untuk mengamankan aplikasi."
          : "Masukkan PIN atau kata sandi untuk membuka aplikasi.",
      );
      return;
    }
    if (isSetup) {
      if (trimmed.length < MIN_PIN_LENGTH) {
        setError(`PIN minimal ${MIN_PIN_LENGTH} karakter.`);
        return;
      }
      if (trimmed !== confirmPin.trim()) {
        setError("Konfirmasi PIN tidak sama.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      if (isSetup) {
        await api.setupPin(trimmed);
      } else {
        await api.login(trimmed);
      }
      onUnlocked();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isSetup
            ? "Gagal menyimpan PIN."
            : "Gagal memverifikasi PIN.",
      );
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3.5 text-base text-[var(--foreground)]";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] px-4 py-8">
      <Card className="w-full max-w-sm space-y-5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[var(--hero)] text-[var(--hero-foreground)]">
            <LockIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Financial Tracker</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {isSetup
                ? "Buat PIN pemilik sebelum mulai memakai aplikasi"
                : "Masukkan PIN pemilik untuk membuka"}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="unlock-pin"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {isSetup ? "PIN / Kata Sandi Baru" : "PIN / Kata Sandi"}
            </label>
            <input
              id="unlock-pin"
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={isSetup ? `Minimal ${MIN_PIN_LENGTH} karakter` : "Masukkan PIN"}
              className={inputClass}
            />
          </div>

          {isSetup && (
            <div className="space-y-1.5">
              <label
                htmlFor="unlock-pin-confirm"
                className="block text-sm font-semibold text-[var(--foreground)]"
              >
                Ulangi PIN
              </label>
              <input
                id="unlock-pin-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="Ketik ulang PIN"
                className={inputClass}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-[var(--destructive)] bg-[var(--surface)] p-3 text-sm text-[var(--destructive)]"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? isSetup
                ? "Menyimpan..."
                : "Memeriksa..."
              : isSetup
                ? "Simpan PIN & Buka"
                : "Buka Aplikasi"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
