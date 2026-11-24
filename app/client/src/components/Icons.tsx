import type { ReactNode } from "react";

function Svg({ children, className = "w-5 h-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 19h18M5 19V11h3v8M10.5 19V5h3v14M16 19v-6h3v6" />
    </Svg>
  );
}

export function TransactionsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h11M4 17h8M17 14v6M14 17h6" />
    </Svg>
  );
}

export function CardDebtIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </Svg>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 7h8M16 7h4M12 5v4M4 12h4M12 12h8M8 10v4M4 17h10M18 17h2M14 15v4" />
    </Svg>
  );
}

export function HelpCircleIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </Svg>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m5 12 4.5 4.5L19 7" />
    </Svg>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

export function TransferIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />
    </Svg>
  );
}

export function WalletIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H19v4h2v6h-2v4H4.5A1.5 1.5 0 0 1 3 17.5v-11Z" />
      <path d="M16 12h5" />
    </Svg>
  );
}

export function EditIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </Svg>
  );
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </Svg>
  );
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 3 2.5 20h19L12 3ZM12 9v5M12 17h.01" />
    </Svg>
  );
}

export function SunIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </Svg>
  );
}

export function SplitPayIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="7" height="14" rx="1" />
      <rect x="14" y="5" width="7" height="6" rx="1" />
      <rect x="14" y="13" width="7" height="6" rx="1" />
    </Svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 4v11m0 0-4-4m4 4 4-4M4 19h16" />
    </Svg>
  );
}

export function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 4v16" />
    </Svg>
  );
}

export function CalendarIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  );
}

export function ClockIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </Svg>
  );
}

export function EyeIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function EyeOffIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
    </Svg>
  );
}

export function BudgetIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 3v9h9" />
      <path d="M20.5 14.5A9 9 0 1 1 9.5 3.5" />
    </Svg>
  );
}

export function GoalsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </Svg>
  );
}

export function AssetIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
    </Svg>
  );
}

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Svg>
  );
}

export function ReceiptIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </Svg>
  );
}

export function LightbulbIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </Svg>
  );
}

export function SparkIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}
