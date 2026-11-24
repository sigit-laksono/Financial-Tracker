import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CycleMode } from "../../shared/src/types";
import { api, ApiError, type DashboardDto, type TransactionDto, type WalletDto } from "./lib/api";
import { currentPeriodForCycle } from "./lib/format";
import { AddDebtModal } from "./components/AddDebtModal";
import {
  AssetIcon,
  BudgetIcon,
  CardDebtIcon,
  EyeIcon,
  EyeOffIcon,
  GoalsIcon,
  LockIcon,
  MenuIcon,
  MoonIcon,
  OverviewIcon,
  PlusIcon,
  SettingsIcon,
  SidebarToggleIcon,
  SunIcon,
  TransactionsIcon,
  WalletIcon,
} from "./components/Icons";
import { usePrivacyMode } from "./lib/usePrivacyMode";
import { LockScreen } from "./components/LockScreen";
import { QuickAddSheet, type QuickAddMode } from "./components/QuickAddSheet";
import { ReceiveSalaryModal } from "./components/ReceiveSalaryModal";
import { ReconcileModal } from "./components/ReconcileModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { SplitPayModal, type SplitPayTarget } from "./components/SplitPayModal";
import { Button, ErrorBoundary, ModalSheet, StateView, Toast } from "./components/UI";
import { OverviewPage } from "./pages/OverviewPage";
import type { ThemePref } from "./pages/SettingsPage";
import { INITIAL_TRANSACTION_FILTERS, type TransactionFiltersState } from "./lib/filters";

const WalletsPage = lazy(() =>
  import("./pages/WalletsPage").then((m) => ({ default: m.WalletsPage })),
);
const TransactionsPage = lazy(() =>
  import("./pages/TransactionsPage").then((m) => ({ default: m.TransactionsPage })),
);
const BudgetPage = lazy(() =>
  import("./pages/BudgetPage").then((m) => ({ default: m.BudgetPage })),
);
const GoalsPage = lazy(() => import("./pages/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const AssetsPage = lazy(() =>
  import("./pages/AssetsPage").then((m) => ({ default: m.AssetsPage })),
);
const DebtsPage = lazy(() => import("./pages/DebtsPage").then((m) => ({ default: m.DebtsPage })));
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

type TabId =
  | "overview"
  | "wallets"
  | "transactions"
  | "budget"
  | "goals"
  | "assets"
  | "debts"
  | "settings";

function applyThemeClass(pref: ThemePref): void {
  const isDark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export function App() {
  const queryClient = useQueryClient();
  const { isMasked, toggle: togglePrivacy } = usePrivacyMode();
  const [tab, setTab] = useState<TabId>("overview");
  const [cycle, setCycle] = useState<CycleMode>("gajian");
  const [period, setPeriod] = useState<string>(() => currentPeriodForCycle("gajian"));
  const [txFilters, setTxFilters] = useState<TransactionFiltersState>(INITIAL_TRANSACTION_FILTERS);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => {
    const saved = localStorage.getItem("ft-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [pinBannerDismissed, setPinBannerDismissed] = useState(false);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>("expense");
  const [editingTx, setEditingTx] = useState<TransactionDto | null>(null);
  const [preselectedInstIds, setPreselectedInstIds] = useState<number[]>([]);
  const [preselectedCcCycle, setPreselectedCcCycle] = useState("");
  const [splitPayTarget, setSplitPayTarget] = useState<SplitPayTarget | null>(null);
  const [addDebtOpen, setAddDebtOpen] = useState(false);
  const [receiveSalaryOpen, setReceiveSalaryOpen] = useState(false);
  const [reconcileWallet, setReconcileWallet] = useState<WalletDto | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const syncedCyclesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem("ft-theme", theme);
    applyThemeClass(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyThemeClass("system");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 2800);
  }, []);

  const authQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: api.getAuthStatus,
    retry: false,
  });

  const isAuthenticated = authQuery.data?.authenticated === true;
  const pinConfigured = authQuery.data?.pinConfigured === true;

  useEffect(() => {
    if (!isAuthenticated) return;
    const syncKey = cycle === "cc" ? `cc:${period}` : "daily";
    if (syncedCyclesRef.current.has(syncKey)) return;
    syncedCyclesRef.current.add(syncKey);

    api
      .syncLedger(cycle === "cc" ? { cycleKey: period } : {})
      .then((res) => {
        if (res.feesInserted > 0 || res.payrollSettled > 0) {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["debts"] });
        }
      })
      .catch(() => {
        // Daily sync failure does not block read-only UI rendering.
      });
  }, [isAuthenticated, cycle, period, queryClient]);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", cycle, period],
    queryFn: () => api.getDashboard(cycle, period),
    enabled: isAuthenticated,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return count < 1;
    },
  });

  const debtsQuery = useQuery({
    queryKey: ["debts"],
    queryFn: api.getDebts,
    enabled: isAuthenticated,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return count < 1;
    },
  });

  useEffect(() => {
    const err = dashboardQuery.error ?? debtsQuery.error;
    if (err instanceof ApiError && err.status === 401) {
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    }
  }, [dashboardQuery.error, debtsQuery.error, queryClient]);

  useEffect(() => {
    if (!isAuthenticated || !dashboardQuery.data) return;
    const completed = localStorage.getItem("ft-onboarding-completed");
    if (completed) return;

    if (dashboardQuery.data.needsOnboarding) {
      setOnboardingOpen(true);
    } else {
      localStorage.setItem("ft-onboarding-completed", "true");
    }
  }, [isAuthenticated, dashboardQuery.data]);

  const handleCycleChange = (next: CycleMode) => {
    setCycle(next);
    const s = dashboardQuery.data?.settings;
    setPeriod(currentPeriodForCycle(next, s?.gajianStartDay ?? 25, s?.cardCutoffDay ?? 20));
    setTxFilters((prev) => ({ ...prev, weekChoice: "all" }));
  };

  const handlePeriodChange = (nextPeriod: string) => {
    setPeriod(nextPeriod);
    setTxFilters((prev) => ({ ...prev, weekChoice: "all" }));
  };

  const openQuickAdd = (mode: QuickAddMode = "expense") => {
    setEditingTx(null);
    setPreselectedInstIds([]);
    setPreselectedCcCycle("");
    setQuickAddMode(mode);
    setQuickAddOpen(true);
  };

  const openPayInstallment = (installmentId: number) => {
    setEditingTx(null);
    setPreselectedCcCycle("");
    setPreselectedInstIds([installmentId]);
    setQuickAddMode("settle");
    setQuickAddOpen(true);
  };

  const openPayCcCycle = (cycleKey: string, installmentIds: number[]) => {
    setEditingTx(null);
    setPreselectedCcCycle(cycleKey);
    setPreselectedInstIds(installmentIds);
    setQuickAddMode("settle");
    setQuickAddOpen(true);
  };

  if (authQuery.isPending) {
    return (
      <main className="mx-auto max-w-md p-6">
        <StateView
          kind="loading"
          title="Memeriksa sesi..."
          description="Menghubungkan ke server Financial Tracker."
        />
      </main>
    );
  }

  if (authQuery.error) {
    return (
      <main className="mx-auto max-w-md p-6">
        <StateView
          kind="error"
          title="Server tidak terjangkau"
          description="Pastikan server backend berjalan dan coba muat ulang."
          actionLabel="Coba Lagi"
          onAction={() => authQuery.refetch()}
        />
      </main>
    );
  }

  if (pinConfigured && !isAuthenticated) {
    return (
      <LockScreen
        onUnlocked={async () => {
          syncedCyclesRef.current.clear();
          await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          await queryClient.invalidateQueries({ queryKey: ["debts"] });
        }}
      />
    );
  }

  const navItems: Array<{ id: TabId; label: string; shortLabel: string; icon: ReactNode }> = [
    { id: "overview", label: "Ringkasan", shortLabel: "Home", icon: <OverviewIcon /> },
    { id: "wallets", label: "Dompet", shortLabel: "Dompet", icon: <WalletIcon /> },
    { id: "transactions", label: "Transaksi", shortLabel: "Transaksi", icon: <TransactionsIcon /> },
    { id: "budget", label: "Budgeting", shortLabel: "Budget", icon: <BudgetIcon /> },
    { id: "goals", label: "Target & Goals", shortLabel: "Goals", icon: <GoalsIcon /> },
    { id: "assets", label: "Aset & Net Worth", shortLabel: "Aset", icon: <AssetIcon /> },
    { id: "debts", label: "Kartu & Utang", shortLabel: "Kartu", icon: <CardDebtIcon /> },
    { id: "settings", label: "Pengaturan", shortLabel: "Atur", icon: <SettingsIcon /> },
  ];

  const nextCycleTheme = (): ThemePref => {
    if (theme === "light") return "dark";
    if (theme === "dark") return "light";
    return document.documentElement.classList.contains("dark") ? "light" : "dark";
  };

  const isDarkActive =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const tabSuspenseFallback = (
    <StateView kind="loading" title="Memuat halaman..." description="Menyiapkan tampilan tab." />
  );

  const fallbackDashboardData = {
    cycle,
    period,
    periodStart: "",
    periodEnd: "",
    currentCcCycle: "",
    availablePeriods: [],
    metrics: {
      safeToSpend: 0,
      dailyAllowance: 0,
      daysRemaining: 0,
      totalIncome: 0,
      totalExpense: 0,
      totalCcExpense: 0,
      salaryReceivedThisCycle: false,
    },
    wallets: [],
    categories: [],
    transactions: [],
    dailyTotals: [],
    settings: {
      grossSalary: 0,
      netSalary: 0,
      payrollDeduction: 0,
      defaultSalaryWalletId: null,
      gajianStartDay: 25,
      cardCutoffDay: 20,
      statementDay: 21,
      cardPaymentDay: 10,
      cardLimit: 10_000_000,
    },
  } as unknown as DashboardDto;

  const renderTabContent = () => {
    // 1. Debts (independent query)
    if (tab === "debts") {
      if (debtsQuery.isPending) {
        return (
          <StateView
            kind="loading"
            title="Memuat data kartu & utang..."
            description="Mengambil tagihan siklus CC dan jadwal cicilan."
          />
        );
      }
      if (debtsQuery.error || !debtsQuery.data) {
        return (
          <StateView
            kind="error"
            title="Gagal memuat data kartu & utang"
            description={
              debtsQuery.error instanceof Error
                ? debtsQuery.error.message
                : "Terjadi kendala saat mengambil data utang."
            }
            actionLabel="Coba Lagi"
            onAction={() => debtsQuery.refetch()}
          />
        );
      }
      return (
        <Suspense fallback={tabSuspenseFallback}>
          <DebtsPage
            data={debtsQuery.data}
            onOpenAddDebt={() => setAddDebtOpen(true)}
            onPayInstallment={openPayInstallment}
            onPayCcCycle={openPayCcCycle}
            onOpenSplitPay={(target) => setSplitPayTarget(target)}
            onToast={showToast}
          />
        </Suspense>
      );
    }

    // 2. Wallets (independent)
    if (tab === "wallets") {
      return (
        <Suspense fallback={tabSuspenseFallback}>
          <WalletsPage onToast={showToast} onOpenQuickAdd={openQuickAdd} />
        </Suspense>
      );
    }

    // 3. Budget (independent)
    if (tab === "budget") {
      return (
        <Suspense fallback={tabSuspenseFallback}>
          <BudgetPage onToast={showToast} />
        </Suspense>
      );
    }

    // 4. Goals (independent)
    if (tab === "goals") {
      return (
        <Suspense fallback={tabSuspenseFallback}>
          <GoalsPage onToast={showToast} />
        </Suspense>
      );
    }

    // 5. Assets (independent)
    if (tab === "assets") {
      return (
        <Suspense fallback={tabSuspenseFallback}>
          <AssetsPage onToast={showToast} />
        </Suspense>
      );
    }

    // 6. Settings (semi-independent: uses dashboardQuery if available, has safe fallback & retry banner)
    if (tab === "settings") {
      return (
        <Suspense fallback={tabSuspenseFallback}>
          {dashboardQuery.error && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[var(--destructive)]/40 bg-[var(--surface)] p-3 text-xs text-[var(--destructive)]">
              <span>
                Data keuangan terkini gagal dimuat dari server. Menu keamanan, tema, dan ekspor
                tetap dapat digunakan.
              </span>
              <Button
                variant="secondary"
                onClick={() => dashboardQuery.refetch()}
                className="min-h-[36px] text-xs px-3"
              >
                Coba Lagi
              </Button>
            </div>
          )}
          <SettingsPage
            data={dashboardQuery.data ?? fallbackDashboardData}
            theme={theme}
            pinConfigured={pinConfigured}
            onThemeChange={setTheme}
            onReconcileWallet={(w) => setReconcileWallet(w)}
            onAuthChanged={() => queryClient.invalidateQueries({ queryKey: ["auth-status"] })}
            onToast={showToast}
          />
        </Suspense>
      );
    }

    // 7. Overview & Transactions (require dashboardQuery)
    if (dashboardQuery.isPending) {
      return (
        <StateView
          kind="loading"
          title="Memuat catatan keuangan..."
          description="Menghitung saldo dompet, tagihan CC, dan jadwal cicilan."
        />
      );
    }

    if (dashboardQuery.error || !dashboardQuery.data) {
      return (
        <StateView
          kind="error"
          title="Gagal memuat data keuangan"
          description={
            dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : "Terjadi kendala saat mengambil data dari server."
          }
          actionLabel="Coba Lagi"
          onAction={() => dashboardQuery.refetch()}
        />
      );
    }

    if (tab === "overview") {
      return (
        <OverviewPage
          data={dashboardQuery.data}
          cycle={cycle}
          period={period}
          onCycleChange={handleCycleChange}
          onPeriodChange={handlePeriodChange}
          onPayInstallment={openPayInstallment}
          onOpenTransactions={() => setTab("transactions")}
          onOpenDebts={() => setTab("debts")}
          onOpenReconcile={() => setTab("wallets")}
          onOpenReceiveSalary={() => setReceiveSalaryOpen(true)}
          onOpenBudget={() => setTab("budget")}
          onOpenGoals={() => setTab("goals")}
          onOpenAssets={() => setTab("assets")}
          onReconcileWallet={(w) => setReconcileWallet(w)}
          onToast={showToast}
        />
      );
    }

    // tab === "transactions"
    return (
      <Suspense fallback={tabSuspenseFallback}>
        <TransactionsPage
          data={dashboardQuery.data}
          period={period}
          filters={txFilters}
          onFiltersChange={setTxFilters}
          onPeriodChange={handlePeriodChange}
          onEditTransaction={(tx) => {
            setEditingTx(tx);
            setQuickAddOpen(true);
          }}
          onSplitPay={(tx) =>
            setSplitPayTarget({
              id: tx.id,
              merchant: tx.merchant,
              amount: tx.amount,
              transactionDate: tx.transactionDate,
            })
          }
          onAddTransaction={() => openQuickAdd("expense")}
          onToast={showToast}
        />
      </Suspense>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)] lg:flex">
      {/* Desktop Left Navigation Rail */}
      <aside
        aria-label="Navigasi utama"
        className={`hidden lg:flex lg:flex-col lg:shrink-0 lg:border-r lg:border-[var(--border)] lg:bg-[var(--card)] lg:p-3 lg:sticky lg:top-0 lg:h-[100dvh] transition-[width] duration-150 ${
          railCollapsed ? "lg:w-[76px]" : "lg:w-[236px]"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-1 py-2">
          {!railCollapsed && (
            <span className="text-base font-extrabold tracking-tight text-[var(--foreground)]">
              Financial Tracker
            </span>
          )}
          <button
            type="button"
            aria-expanded={!railCollapsed}
            aria-label={railCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
            onClick={() => setRailCollapsed((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] hover:bg-[var(--surface)]"
          >
            <SidebarToggleIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="my-3">
          <Button
            onClick={() => openQuickAdd("expense")}
            aria-label="Catat transaksi baru"
            className={railCollapsed ? "w-11 px-0" : "w-full"}
          >
            <PlusIcon className="w-5 h-5" />
            {!railCollapsed && <span>Catat Transaksi</span>}
          </Button>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                aria-label={railCollapsed ? item.label : undefined}
                title={railCollapsed ? item.label : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                    : "text-[var(--foreground)] hover:bg-[var(--surface)]"
                } ${railCollapsed ? "justify-center px-0" : ""}`}
              >
                <span className="shrink-0">{item.icon}</span>
                {!railCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={togglePrivacy}
            aria-label={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
            className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] ${
              railCollapsed ? "justify-center px-0" : ""
            }`}
          >
            {isMasked ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            {!railCollapsed && <span>{isMasked ? "Buka Nominal" : "Sembunyikan Nominal"}</span>}
          </button>

          <button
            type="button"
            onClick={() => setTheme(nextCycleTheme())}
            aria-label={isDarkActive ? "Beralih ke mode terang" : "Beralih ke mode gelap"}
            className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] ${
              railCollapsed ? "justify-center px-0" : ""
            }`}
          >
            {isDarkActive ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            {!railCollapsed && <span>{isDarkActive ? "Mode Terang" : "Mode Gelap"}</span>}
          </button>

          {pinConfigured && (
            <button
              type="button"
              onClick={async () => {
                await api.logout();
                await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
              }}
              aria-label="Kunci aplikasi"
              className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)] ${
                railCollapsed ? "justify-center px-0" : ""
              }`}
            >
              <LockIcon className="w-5 h-5" />
              {!railCollapsed && <span>Kunci Sesi</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Container */}
      <div className="flex-1 min-w-0">
        {/* Compact Mobile Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 py-2.5 lg:hidden">
          <span className="text-base font-extrabold tracking-tight text-[var(--foreground)]">
            Financial Tracker
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePrivacy}
              aria-label={isMasked ? "Tampilkan nominal" : "Sembunyikan nominal"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] bg-[var(--card)]"
            >
              {isMasked ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setTheme(nextCycleTheme())}
              aria-label={isDarkActive ? "Beralih ke mode terang" : "Beralih ke mode gelap"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] bg-[var(--card)]"
            >
              {isDarkActive ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setTab("settings")}
              aria-label="Buka Pengaturan"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] bg-[var(--card)] ${
                tab === "settings"
                  ? "border-[var(--primary)] text-[var(--primary)] ring-2 ring-[var(--primary)]/30"
                  : "text-[var(--foreground)]"
              }`}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            {pinConfigured && (
              <button
                type="button"
                onClick={async () => {
                  await api.logout();
                  await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
                }}
                aria-label="Kunci aplikasi"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--control-border)] bg-[var(--card)]"
              >
                <LockIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* Mobile Quick Navigation Rail (Horizontal 1-tap switching for all tabs) */}
        <nav
          aria-label="Navigasi cepat mobile"
          className="lg:hidden border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 overflow-x-auto"
        >
          <div className="flex items-center gap-1.5 min-w-max">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all ${
                    active
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--control-border)]"
                  }`}
                >
                  <span className="w-4 h-4 shrink-0">{item.icon}</span>
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <main className="mx-auto w-full max-w-[1040px] px-4 pt-4 safe-bottom-pad sm:px-6 sm:pt-6">
          {!pinConfigured && !pinBannerDismissed && tab !== "settings" && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm">
              <span>
                PIN keamanan belum aktif. Aktifkan jika aplikasi akan diakses lewat jaringan publik.
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setTab("settings")}
                  className="min-h-[44px] px-3 text-xs"
                >
                  Atur PIN
                </Button>
                <button
                  type="button"
                  onClick={() => setPinBannerDismissed(true)}
                  className="min-h-[44px] px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:underline"
                >
                  Nanti
                </button>
              </div>
            </div>
          )}

          <ErrorBoundary key={tab}>{renderTabContent()}</ErrorBoundary>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar + Center Quick-Add FAB */}
      <nav
        aria-label="Navigasi bawah"
        style={{ boxShadow: "var(--elevation-float)" }}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--card)] px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 items-center gap-1">
          {/* 1. Ringkasan */}
          <button
            type="button"
            onClick={() => setTab("overview")}
            aria-current={tab === "overview" ? "page" : undefined}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[11px] font-semibold transition-colors ${
              tab === "overview"
                ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            <OverviewIcon className="w-5 h-5" />
            <span>Home</span>
          </button>

          {/* 2. Transaksi */}
          <button
            type="button"
            onClick={() => setTab("transactions")}
            aria-current={tab === "transactions" ? "page" : undefined}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[11px] font-semibold transition-colors ${
              tab === "transactions"
                ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            <TransactionsIcon className="w-5 h-5" />
            <span>Transaksi</span>
          </button>

          {/* 3. Center Quick-Add FAB */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => openQuickAdd("expense")}
              aria-label="Catat transaksi baru"
              style={{ boxShadow: "var(--elevation-float)" }}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-95 active:scale-95 transition-transform"
            >
              <PlusIcon className="w-6 h-6" />
            </button>
          </div>

          {/* 4. Dompet */}
          <button
            type="button"
            onClick={() => setTab("wallets")}
            aria-current={tab === "wallets" ? "page" : undefined}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[11px] font-semibold transition-colors ${
              tab === "wallets"
                ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            <WalletIcon className="w-5 h-5" />
            <span>Dompet</span>
          </button>

          {/* 5. Menu Fitur Lainnya */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Buka menu fitur lainnya"
            aria-expanded={mobileMenuOpen}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[11px] font-semibold transition-colors relative ${
              ["budget", "goals", "assets", "debts", "settings"].includes(tab)
                ? "bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab === "budget" ? (
              <BudgetIcon className="w-5 h-5" />
            ) : tab === "goals" ? (
              <GoalsIcon className="w-5 h-5" />
            ) : tab === "assets" ? (
              <AssetIcon className="w-5 h-5" />
            ) : tab === "debts" ? (
              <CardDebtIcon className="w-5 h-5" />
            ) : tab === "settings" ? (
              <SettingsIcon className="w-5 h-5" />
            ) : (
              <MenuIcon className="w-5 h-5" />
            )}
            <span>
              {tab === "budget"
                ? "Budget"
                : tab === "goals"
                  ? "Goals"
                  : tab === "assets"
                    ? "Aset"
                    : tab === "debts"
                      ? "Kartu"
                      : tab === "settings"
                        ? "Atur"
                        : "Menu"}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Sheet */}
      <ModalSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        title="Menu & Fitur"
        subtitle="Pilih fitur perencanaan, portofolio, dan konfigurasi aplikasi."
      >
        <div className="space-y-4 py-1">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
              Perencanaan Keuangan
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTab("budget");
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2.5 p-3 rounded-[12px] border text-left transition-all ${
                  tab === "budget"
                    ? "border-[var(--primary)] bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                    : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-[var(--foreground)]"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] text-[var(--primary)]">
                  <BudgetIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold">Budgeting</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">Pagu Anggaran Bulanan</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTab("goals");
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2.5 p-3 rounded-[12px] border text-left transition-all ${
                  tab === "goals"
                    ? "border-[var(--primary)] bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                    : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-[var(--foreground)]"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] text-[var(--primary)]">
                  <GoalsIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold">Target & Goals</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">Dana Darurat</div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
              Portofolio & Kewajiban
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTab("assets");
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2.5 p-3 rounded-[12px] border text-left transition-all ${
                  tab === "assets"
                    ? "border-[var(--primary)] bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                    : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-[var(--foreground)]"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] text-[var(--primary)]">
                  <AssetIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold">Aset & Net Worth</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">Kekayaan Bersih</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTab("debts");
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2.5 p-3 rounded-[12px] border text-left transition-all ${
                  tab === "debts"
                    ? "border-[var(--primary)] bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                    : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-[var(--foreground)]"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] text-[var(--primary)]">
                  <CardDebtIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold">Kartu & Utang</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    Multi-CC & Cicilan
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
              Sistem
            </h3>
            <button
              type="button"
              onClick={() => {
                setTab("settings");
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-[12px] border text-left transition-all ${
                tab === "settings"
                  ? "border-[var(--primary)] bg-[var(--soft)] text-[var(--soft-foreground)] font-bold"
                  : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] text-[var(--primary)]">
                <SettingsIcon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold">Pengaturan Aplikasi</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  Keamanan PIN, tagihan rutin, siklus gajian, cadangan data
                </div>
              </div>
            </button>
          </div>
        </div>
      </ModalSheet>

      {/* Modals */}
      {dashboardQuery.data && (
        <QuickAddSheet
          open={quickAddOpen}
          onClose={() => {
            setQuickAddOpen(false);
            setEditingTx(null);
          }}
          wallets={dashboardQuery.data.wallets}
          categories={dashboardQuery.data.categories}
          debts={debtsQuery.data}
          initialMode={quickAddMode}
          editingTx={editingTx}
          preselectedInstallmentIds={preselectedInstIds}
          preselectedCcCycleKey={preselectedCcCycle}
          onSuccessMessage={showToast}
          onRequestSplitPay={(tx) =>
            setSplitPayTarget({
              id: tx.id,
              merchant: tx.merchant,
              amount: tx.amount,
              transactionDate: tx.transactionDate,
            })
          }
        />
      )}

      <SplitPayModal
        target={splitPayTarget}
        onClose={() => setSplitPayTarget(null)}
        onSuccess={showToast}
      />

      <AddDebtModal
        open={addDebtOpen}
        onClose={() => setAddDebtOpen(false)}
        onSuccess={showToast}
      />

      {dashboardQuery.data && (
        <ReceiveSalaryModal
          open={receiveSalaryOpen}
          period={period}
          data={dashboardQuery.data}
          onClose={() => setReceiveSalaryOpen(false)}
          onSuccess={showToast}
        />
      )}

      <ReconcileModal
        wallet={reconcileWallet}
        onClose={() => setReconcileWallet(null)}
        onSuccess={showToast}
      />

      <OnboardingModal
        open={onboardingOpen}
        settings={dashboardQuery.data?.settings}
        existingWallets={dashboardQuery.data?.wallets}
        onClose={() => setOnboardingOpen(false)}
        onComplete={() => {
          setOnboardingOpen(false);
          showToast("Pengaturan awal berhasil disimpan! Selamat mencatat.");
        }}
      />

      <Toast message={toast} />
    </div>
  );
}
