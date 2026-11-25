import { useState } from "react";
import { BudgetIcon, ClockIcon, DownloadIcon, LockIcon } from "../components/Icons";
import type { DashboardDto, WalletDto } from "../lib/api";
import { AuditLogsTab } from "./settings/AuditLogsTab";
import { CycleBudgetTab } from "./settings/CycleBudgetTab";
import { DataBackupTab } from "./settings/DataBackupTab";
import { ProfileSecurityTab, type ThemePref } from "./settings/ProfileSecurityTab";

export type { ThemePref };

export type SettingsTabId = "security" | "cycle" | "backup" | "audit";

interface SettingsTabConfig {
  id: SettingsTabId;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}

const SETTINGS_TABS: SettingsTabConfig[] = [
  {
    id: "security",
    label: "Profil & Keamanan",
    shortLabel: "Keamanan",
    icon: <LockIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
  },
  {
    id: "cycle",
    label: "Siklus & Gaji",
    shortLabel: "Siklus",
    icon: <BudgetIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
  },
  {
    id: "backup",
    label: "Cadangan & Data",
    shortLabel: "Backup",
    icon: <DownloadIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
  },
  {
    id: "audit",
    label: "Log Aktivitas",
    shortLabel: "Audit",
    icon: <ClockIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
  },
];

export function SettingsPage({
  data,
  theme,
  pinConfigured,
  onThemeChange,
  onReconcileWallet: _onReconcileWallet,
  onOpenWallets: _onOpenWallets,
  onAuthChanged,
  onToast,
}: {
  data: DashboardDto;
  theme: ThemePref;
  pinConfigured: boolean;
  onThemeChange: (next: ThemePref) => void;
  onReconcileWallet?: (wallet: WalletDto) => void;
  onOpenWallets?: () => void;
  onAuthChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("security");

  return (
    <div className="space-y-6 pb-8 lg:pb-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Pengaturan Sistem</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Kelola keamanan akun, siklus gaji, cadangan data, dan log aktivitas.
        </p>
      </div>

      {/* Settings Navigation Rail / Tabs */}
      <div className="grid grid-cols-4 gap-1 pb-1.5 border-b border-[var(--border)] sm:flex sm:items-center sm:gap-1.5">
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[44px] items-center justify-center sm:justify-start gap-1 sm:gap-2 rounded-[14px] px-1.5 sm:px-4 text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? "bg-[var(--hero)] text-[var(--hero-foreground)] shadow-xs"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "security" && (
          <ProfileSecurityTab
            theme={theme}
            pinConfigured={pinConfigured}
            onThemeChange={onThemeChange}
            onAuthChanged={onAuthChanged}
            onToast={onToast}
          />
        )}

        {activeTab === "cycle" && <CycleBudgetTab data={data} onToast={onToast} />}

        {activeTab === "backup" && <DataBackupTab data={data} onToast={onToast} />}

        {activeTab === "audit" && <AuditLogsTab />}
      </div>
    </div>
  );
}
