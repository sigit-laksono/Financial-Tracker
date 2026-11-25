import type { ReactNode } from "react";
import type { WalletProvider } from "../../../shared/src/types";

interface BankBadgeProps {
  provider: WalletProvider | string;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  showLabel?: boolean;
}

interface ProviderMeta {
  code: string;
  label: string;
  bg: string;
  text: string;
  border?: string;
  icon?: ReactNode;
}

export const PROVIDER_CONFIGS: Record<WalletProvider, ProviderMeta> = {
  bca: {
    code: "BCA",
    label: "Bank Central Asia",
    bg: "#00529C",
    text: "#FFFFFF",
  },
  mandiri: {
    code: "MDR",
    label: "Bank Mandiri",
    bg: "#003D79",
    text: "#FFB81C",
  },
  bni: {
    code: "BNI",
    label: "Bank Negara Indonesia",
    bg: "#005E6A",
    text: "#F37024",
  },
  bri: {
    code: "BRI",
    label: "Bank Rakyat Indonesia",
    bg: "#00529F",
    text: "#FFFFFF",
  },
  jago: {
    code: "JAGO",
    label: "Bank Jago",
    bg: "#FFD500",
    text: "#212121",
  },
  seabank: {
    code: "SEA",
    label: "SeaBank",
    bg: "#FE5D26",
    text: "#FFFFFF",
  },
  blu: {
    code: "BLU",
    label: "blu by BCA Digital",
    bg: "#00C2FF",
    text: "#002D40",
  },
  gopay: {
    code: "GOPAY",
    label: "GoPay",
    bg: "#00AED6",
    text: "#FFFFFF",
  },
  ovo: {
    code: "OVO",
    label: "OVO",
    bg: "#4C2A86",
    text: "#FFFFFF",
  },
  dana: {
    code: "DANA",
    label: "DANA",
    bg: "#118EEA",
    text: "#FFFFFF",
  },
  shopeepay: {
    code: "SPAY",
    label: "ShopeePay",
    bg: "#EE4D2D",
    text: "#FFFFFF",
  },
  btn: {
    code: "BTN",
    label: "Bank BTN",
    bg: "#003A70",
    text: "#FFFFFF",
  },
  cimb: {
    code: "CIMB",
    label: "CIMB Niaga",
    bg: "#ED1B2D",
    text: "#FFFFFF",
  },
  bsi: {
    code: "BSI",
    label: "Bank Syariah Indonesia",
    bg: "#00A39D",
    text: "#FFFFFF",
  },
  permata: {
    code: "PRMT",
    label: "Permata Bank",
    bg: "#78BE20",
    text: "#FFFFFF",
  },
  danamon: {
    code: "DNM",
    label: "Bank Danamon",
    bg: "#003366",
    text: "#FFFFFF",
  },
  jenius: {
    code: "JNS",
    label: "Jenius",
    bg: "#00A4E4",
    text: "#FFFFFF",
  },
  linkaja: {
    code: "LINK",
    label: "LinkAja",
    bg: "#ED1C24",
    text: "#FFFFFF",
  },
  astrapay: {
    code: "ASTRA",
    label: "AstraPay",
    bg: "#004B93",
    text: "#FFFFFF",
  },
  isaku: {
    code: "ISAKU",
    label: "i.saku",
    bg: "#0072CE",
    text: "#FFFFFF",
  },
  mega: {
    code: "MEGA",
    label: "Bank Mega",
    bg: "#F7941D",
    text: "#FFFFFF",
  },
  spaylater: {
    code: "SPAYL",
    label: "SPayLater",
    bg: "#EE4D2D",
    text: "#FFFFFF",
  },
  gopaylater: {
    code: "GOPAYL",
    label: "GoPay Later",
    bg: "#00AED6",
    text: "#FFFFFF",
  },
  kredivo: {
    code: "KRED",
    label: "Kredivo",
    bg: "#FF5722",
    text: "#FFFFFF",
  },
  akulaku: {
    code: "AKU",
    label: "Akulaku",
    bg: "#E51C23",
    text: "#FFFFFF",
  },
  traveloka_paylater: {
    code: "TRVL",
    label: "Traveloka PayLater",
    bg: "#0264D6",
    text: "#FFFFFF",
  },
  indodana: {
    code: "INDO",
    label: "Indodana",
    bg: "#00A859",
    text: "#FFFFFF",
  },
  atome: {
    code: "ATOME",
    label: "Atome",
    bg: "#FFFF00",
    text: "#000000",
  },
  cash: {
    code: "TUNAI",
    label: "Kas Tunai",
    bg: "#10B981",
    text: "#FFFFFF",
  },
  other: {
    code: "BANK",
    label: "Dompet / Bank",
    bg: "#475569",
    text: "#F8FAFC",
  },
};

export function BankBadge({
  provider,
  name,
  size = "md",
  className = "",
  showLabel = false,
}: BankBadgeProps) {
  const normKey = (provider?.toLowerCase() || "other") as WalletProvider;
  const config = PROVIDER_CONFIGS[normKey] ?? PROVIDER_CONFIGS.other;

  const sizeClasses = {
    sm: "h-6 px-1.5 text-[10px] min-w-[24px] font-bold tracking-tight rounded-[5px]",
    md: "h-9 px-2.5 text-xs min-w-[36px] font-extrabold tracking-wide rounded-[8px]",
    lg: "h-11 px-3 text-sm min-w-[44px] font-black tracking-wider rounded-[10px]",
  }[size];

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span
        role="img"
        aria-label={config.label}
        style={{
          backgroundColor: config.bg,
          color: config.text,
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
        }}
        className={`inline-flex items-center justify-center select-none border border-black/10 dark:border-white/15 shadow-sm transition-transform active:scale-95 ${sizeClasses}`}
      >
        {config.code}
      </span>
      {showLabel && (
        <span className="text-xs font-semibold text-[var(--foreground)] truncate">
          {name || config.label}
        </span>
      )}
    </div>
  );
}
