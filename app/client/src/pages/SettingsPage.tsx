import { useState } from "react";
import {
  BudgetIcon,
  ClockIcon,
  DownloadIcon,
  LockIcon,
  ReceiptIcon,
  WalletIcon,
} from "../components/Icons";
import type { DashboardDto, WalletDto } from "../lib/api";
import { AuditLogsTab } from "./settings/AuditLogsTab";
import { CategoriesConfigTab } from "./settings/CategoriesConfigTab";
import { CycleBudgetTab } from "./settings/CycleBudgetTab";
import { DataBackupTab } from "./settings/DataBackupTab";
import { ProfileSecurityTab, type ThemePref } from "./settings/ProfileSecurityTab";
import { WalletsConfigTab } from "./settings/WalletsConfigTab";

export type { ThemePref };

export type SettingsTabId = "security" | "wallets" | "cycle" | "categories" | "backup" | "audit";

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
    icon: <LockIcon className="w-4 h-4" />,
  },
  {
    id: "wallets",
    label: "Rekening & Kartu",
    shortLabel: "Dompet",
    icon: <WalletIcon className="w-4 h-4" />,
  },
  {
    id: "cycle",
    label: "Siklus & Anggaran",
    shortLabel: "Siklus",
    icon: <BudgetIcon className="w-4 h-4" />,
  },
  {
    id: "categories",
    label: "Kategori Transaksi",
    shortLabel: "Kategori",
    icon: <ReceiptIcon className="w-4 h-4" />,
  },
  {
    id: "backup",
    label: "Cadangan & Data",
    shortLabel: "Backup",
    icon: <DownloadIcon className="w-4 h-4" />,
  },
  {
    id: "audit",
    label: "Log Aktivitas",
    shortLabel: "Audit",
    icon: <ClockIcon className="w-4 h-4" />,
  },
];

export function SettingsPage({
  data,
  theme,
  pinConfigured,
  onThemeChange,
  onReconcileWallet,
  onAuthChanged,
  onToast,
}: {
  data: DashboardDto;
  theme: ThemePref;
  pinConfigured: boolean;
  onThemeChange: (next: ThemePref) => void;
  onReconcileWallet: (wallet: WalletDto) => void;
  onAuthChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("security");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--foreground)]">Pengaturan Sistem</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Pusat kendali akun, preferensi siklus, rekening keuangan, kategori anggaran, dan keamanan
          data.
        </p>
      </div>

      {/* Settings Navigation Rail / Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[var(--border)] no-scrollbar">
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[14px] px-4 text-xs font-bold transition-all ${
                isActive
                  ? "bg-[var(--hero)] text-white shadow-xs"
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

        {activeTab === "wallets" && (
          <WalletsConfigTab data={data} onReconcileWallet={onReconcileWallet} onToast={onToast} />
        )}

        {activeTab === "cycle" && <CycleBudgetTab data={data} onToast={onToast} />}

        {activeTab === "categories" && <CategoriesConfigTab data={data} onToast={onToast} />}

        {activeTab === "backup" && <DataBackupTab data={data} onToast={onToast} />}

        {activeTab === "audit" && <AuditLogsTab />}
      </div>
    </div>
  );
}
