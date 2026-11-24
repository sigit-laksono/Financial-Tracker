import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { AlertIcon, LockIcon } from "./Icons";
import { Button, Card } from "./UI";

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError("Masukkan PIN atau kata sandi untuk membuka aplikasi.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.login(pin);
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memverifikasi PIN.");
    } finally {
      setBusy(false);
    }
  };

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
              Masukkan PIN pemilik untuk membuka
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="unlock-pin"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              PIN / Kata Sandi
            </label>
            <input
              id="unlock-pin"
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Masukkan PIN"
              className="min-h-[44px] w-full rounded-[10px] border border-[var(--control-border)] bg-[var(--card)] px-3.5 text-base text-[var(--foreground)]"
            />
          </div>

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
            {busy ? "Memeriksa..." : "Buka Aplikasi"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
