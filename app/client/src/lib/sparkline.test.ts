import { describe, expect, it } from "bun:test";

describe("Cashflow Sparkline Calculations", () => {
  it("computes cubic bezier curve coordinates without NaN or division by zero", () => {
    const data = [
      { date: "2026-11-16", income: 0, expense: 0 },
      { date: "2026-11-17", income: 0, expense: 0 },
      { date: "2026-11-18", income: 0, expense: 50_000 },
      { date: "2026-11-19", income: 0, expense: 120_000 },
      { date: "2026-11-20", income: 0, expense: 30_000 },
      { date: "2026-11-21", income: 0, expense: 28_000 },
      { date: "2026-11-22", income: 0, expense: 29_000 },
    ];

    const values = data.map((d) => d.expense);
    const min = Math.min(...values);
    const max = Math.max(...values, 10_000);
    const width = 280;
    const height = 54;
    const paddingY = 8;
    const usableHeight = height - paddingY * 2;

    const coords = data.map((d, index) => {
      const x = (index / (data.length - 1 || 1)) * width;
      const normalizedY = (d.expense - min) / (max - min || 1);
      const y = height - paddingY - normalizedY * usableHeight;
      return { x, y, ...d };
    });

    for (const pt of coords) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(pt.y).toBeGreaterThanOrEqual(paddingY);
      expect(pt.y).toBeLessThanOrEqual(height - paddingY);
    }

    const line = coords.reduce((acc, pt, idx, arr) => {
      if (idx === 0) return `M ${pt.x},${pt.y}`;
      const prev = arr[idx - 1]!;
      const cpX1 = prev.x + (pt.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (pt.x - prev.x) / 2;
      const cpY2 = pt.y;
      return `${acc} C ${cpX1},${cpY1} ${cpX2},${cpY2} ${pt.x},${pt.y}`;
    }, "");

    expect(line).not.toContain("NaN");
    expect(line.startsWith("M 0,")).toBe(true);
  });
});
