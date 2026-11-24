import { useEffect, useState } from "react";

const STORAGE_KEY = "ft_privacy_mode";
const LEGACY_STORAGE_KEY = "budggt_privacy_mode";
const EVENT_NAME = "ft_privacy_change";

let globalIsMasked = false;
if (typeof window !== "undefined") {
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  globalIsMasked = stored === "true";
}

export function setPrivacyMode(masked: boolean): void {
  globalIsMasked = masked;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, String(masked));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: masked }));
  }
}

export function togglePrivacyMode(): void {
  setPrivacyMode(!globalIsMasked);
}

export function usePrivacyMode(): {
  isMasked: boolean;
  toggle: () => void;
  setMasked: (val: boolean) => void;
} {
  const [isMasked, setIsMasked] = useState<boolean>(globalIsMasked);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      setIsMasked(custom.detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return {
    isMasked,
    toggle: togglePrivacyMode,
    setMasked: setPrivacyMode,
  };
}
