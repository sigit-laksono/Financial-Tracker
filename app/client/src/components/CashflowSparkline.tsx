import { useId, useMemo, useState } from "react";
import { formatCompactRupiah, formatRupiah, formatShortDate } from "../lib/format";

export type DailyDataPoint = {
  date: string;
  income: number;
  expense: number;
};

export interface CashflowSparklineProps {
  data: DailyDataPoint[];
  days?: number;
  className?: string;
  variant?: "standalone" | "embedded";
}

export function CashflowSparkline({
  data,
  days = 7,
  className = "",
  variant = "standalone",
}: CashflowSparklineProps) {
  const gradientId = useId();
  const [activePoint, setActivePoint] = useState<DailyDataPoint | null>(null);

  // Ambil data N hari terakhir
  const recentData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice(-days);
  }, [data, days]);

  const { points, areaPath, linePath, totalExpense } = useMemo(() => {
    if (recentData.length === 0) {
      return { points: [], areaPath: "", linePath: "", totalExpense: 0 };
    }

    const values = recentData.map((d) => d.expense);
    const sumExpense = values.reduce((acc, curr) => acc + curr, 0);
    const min = Math.min(...values);
    const max = Math.max(...values, 10_000); // Mencegah deviasi nol

    const width = 320;
    const height = 58;
    const paddingY = 8;
    const usableHeight = height - paddingY * 2;

    const coords = recentData.map((d, index) => {
      const x = (index / (recentData.length - 1 || 1)) * width;
      const normalizedY = (d.expense - min) / (max - min || 1);
      // Inversi Y (koordinat SVG 0 berada di atas)
      const y = height - paddingY - normalizedY * usableHeight;
      return { x, y, ...d };
    });

    // Buat SVG Path dengan Smooth Bézier Curve (cubic approximation)
    const line = coords.reduce((acc, pt, idx, arr) => {
      if (idx === 0) return `M ${pt.x},${pt.y}`;
      const prev = arr[idx - 1]!;
      const cpX1 = prev.x + (pt.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (pt.x - prev.x) / 2;
      const cpY2 = pt.y;
      return `${acc} C ${cpX1},${cpY1} ${cpX2},${cpY2} ${pt.x},${pt.y}`;
    }, "");

    const lastX = coords[coords.length - 1]?.x ?? width;
    const area = `${line} L ${lastX},${height} L 0,${height} Z`;

    return {
      points: coords,
      areaPath: area,
      linePath: line,
      totalExpense: sumExpense,
    };
  }, [recentData]);

  if (recentData.length < 2) {
    return (
      <div
        className={`flex h-[54px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--muted-foreground)] ${className}`}
      >
        Belum cukup data transaksi {days} hari.
      </div>
    );
  }

  const containerClass =
    variant === "embedded"
      ? `w-full ${className}`
      : `relative w-full rounded-[16px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-xs ${className}`;

  return (
    <div
      role="img"
      aria-label={`Tren pengeluaran ${days} hari terakhir. Total pengeluaran: ${formatRupiah(totalExpense)}.`}
      className={containerClass}
    >
      <div className="flex items-center justify-between pb-2 text-xs text-[var(--muted-foreground)]">
        <span className="font-bold uppercase tracking-wider text-[11px] text-[var(--foreground)] flex items-center gap-1.5">
          Tren Belanja {days} Hari
        </span>
        <span className="tabular-nums font-bold text-[var(--foreground)]">
          {activePoint ? (
            <span className="text-[var(--primary)] font-mono">
              {formatShortDate(activePoint.date)}: {formatRupiah(activePoint.expense)}
            </span>
          ) : (
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">
              Total{" "}
              <strong className="font-mono text-[var(--foreground)]">
                {formatCompactRupiah(totalExpense)}
              </strong>
            </span>
          )}
        </span>
      </div>

      <svg
        viewBox="0 0 320 58"
        preserveAspectRatio="none"
        className="h-[58px] w-full overflow-visible"
        aria-hidden="true"
        onPointerLeave={() => setActivePoint(null)}
        onPointerMove={(e) => {
          if (points.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const relativeX = ((e.clientX - rect.left) / rect.width) * 320;
          let closest = points[0]!;
          let minDist = Math.abs(closest.x - relativeX);
          for (const pt of points) {
            const dist = Math.abs(pt.x - relativeX);
            if (dist < minDist) {
              minDist = dist;
              closest = pt;
            }
          }
          setActivePoint(closest);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-expense)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-expense)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Gradient Fill Path */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Trend Stroke Line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--chart-expense)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Titik-titik Data */}
        {points.map((pt) => {
          const isSelected = activePoint?.date === pt.date;
          return (
            <circle
              key={pt.date}
              cx={pt.x}
              cy={pt.y}
              r={isSelected ? 5 : 3.5}
              className={`transition-all ${
                isSelected
                  ? "fill-[var(--primary)] stroke-[var(--card)] stroke-2"
                  : "fill-[var(--chart-expense)] stroke-[var(--card)] stroke-1.5"
              }`}
            />
          );
        })}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-[var(--muted-foreground)]">
        <span>{formatShortDate(recentData[0]!.date)}</span>
        <span>{formatShortDate(recentData[recentData.length - 1]!.date)}</span>
      </div>
    </div>
  );
}
