import {
  Component,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertIcon, CloseIcon } from "./Icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "heroOutline";

export function Button({
  variant = "primary",
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-[var(--primary-solid)] text-[var(--primary-solid-foreground)] hover:bg-[var(--primary-solid-hover)] active:opacity-85 disabled:opacity-45",
    secondary:
      "bg-[var(--card)] text-[var(--foreground)] border border-[var(--control-border)] hover:bg-[var(--surface)] active:bg-[var(--border)] disabled:opacity-45",
    ghost:
      "bg-transparent text-[var(--foreground)] hover:bg-[var(--surface)] active:bg-[var(--border)] disabled:opacity-45",
    danger:
      "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90 active:opacity-80 disabled:opacity-45",
    heroOutline:
      "border border-[var(--hero-border)] bg-transparent text-[var(--hero-card-foreground)] hover:bg-[var(--hero-surface)] active:bg-[var(--hero-surface)]/80 disabled:opacity-45",
  };
  return (
    <button
      type={type}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-opacity ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export type BadgeTone = "neutral" | "primary" | "soft" | "info" | "highlight" | "danger";

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]",
    primary: "bg-[var(--primary)]/12 text-[var(--primary)] border border-[var(--primary)]/30",
    soft: "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70",
    info: "bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70",
    highlight:
      "bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
    danger:
      "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[10px] px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function ProgressBar({
  value,
  tone = "primary",
  label,
}: {
  value: number;
  tone?: "primary" | "highlight" | "danger" | "soft";
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fillMap = {
    primary: "bg-[var(--primary)]",
    highlight: "bg-[var(--highlight)]",
    danger: "bg-[var(--destructive)]",
    soft: "bg-[var(--chart-income)]",
  };
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-[10px] bg-[var(--surface)] border border-[var(--border)]"
    >
      <div
        className={`h-full transition-[width] duration-200 ${fillMap[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export type ModalSheetSize = "md" | "lg";

export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: ModalSheetSize;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = [
          ...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ].filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !panelRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);

    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      target?.focus();
    }, 10);

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const sizeClass = size === "lg" ? "sm:max-w-2xl lg:max-w-[760px]" : "sm:max-w-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Tutup dialog"
        onClick={onClose}
        className="fixed inset-0 bg-black/55 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ boxShadow: "var(--elevation-float)" }}
        className={`relative z-10 flex w-full max-h-[90dvh] flex-col overflow-hidden rounded-t-[24px] rounded-b-none border border-[var(--border)] bg-[var(--card)] sm:my-6 sm:max-h-[85vh] sm:rounded-[20px] ${sizeClass}`}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-[var(--control-border)]/50" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-[var(--foreground)]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--control-border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
        <div
          className={`flex-1 overflow-y-auto px-5 py-4 sm:px-6 ${footer != null ? "" : "pb-[calc(20px+env(safe-area-inset-bottom))] sm:pb-6"}`}
        >
          {children}
        </div>
        {footer != null && (
          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--card)] px-5 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function StateView({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  actionButton,
  icon,
}: {
  kind: "loading" | "empty" | "filtered-empty" | "error";
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionButton?: ReactNode;
  icon?: ReactNode;
}) {
  if (kind === "loading") {
    return (
      <Card className="space-y-3" aria-busy="true" aria-live="polite">
        <p className="text-sm font-medium text-[var(--muted-foreground)]">{title}</p>
        <div className="h-6 w-2/3 rounded-[10px] bg-[var(--surface)]" />
        <div className="h-4 w-full rounded-[10px] bg-[var(--surface)]" />
        <div className="h-4 w-4/5 rounded-[10px] bg-[var(--surface)]" />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center justify-center text-center gap-3 py-7 sm:py-9">
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface)] text-[var(--primary)] border border-[var(--border)] mb-0.5">
          {icon}
        </div>
      ) : kind === "error" ? (
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--destructive)] text-[var(--destructive-foreground)]">
          <AlertIcon className="w-5 h-5" />
        </span>
      ) : null}
      <div className="space-y-1 max-w-md">
        <h3 className="text-base font-bold text-[var(--foreground)]">{title}</h3>
        <p className="text-xs sm:text-sm text-[var(--muted-foreground)] leading-relaxed">
          {description}
        </p>
      </div>
      {actionButton ? (
        <div className="mt-1.5">{actionButton}</div>
      ) : actionLabel && onAction ? (
        <Button
          variant={kind === "error" ? "primary" : "secondary"}
          onClick={onAction}
          className="min-h-[44px] mt-1.5"
        >
          {actionLabel}
        </Button>
      ) : null}
    </Card>
  );
}

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ boxShadow: "var(--elevation-float)" }}
      className="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--hero)] px-4 py-2.5 text-sm font-semibold text-[var(--hero-foreground)] lg:bottom-6"
    >
      {message}
    </div>
  );
}

type ErrorBoundaryState = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; title?: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || "Terjadi kesalahan pada tampilan." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <main className="mx-auto max-w-md p-6">
          <StateView
            kind="error"
            title={this.props.title ?? "Tampilan mengalami kendala"}
            description={this.state.message}
            actionLabel="Coba Lagi"
            onAction={() => this.setState({ hasError: false, message: "" })}
          />
        </main>
      );
    }
    return this.props.children;
  }
}
