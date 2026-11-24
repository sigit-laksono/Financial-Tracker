import { describe, expect, it } from "bun:test";
import { periodBounds } from "../../../shared/src/dates";
import {
  buildWeekSlices,
  currentPeriodForCycle,
  formatCompactRupiah,
  formatRupiah,
  formatSignedDigitsInput,
  parseSignedInt,
  spellOutRupiah,
} from "./format";

describe("Client & shared formatting helpers", () => {
  it("builds week slices covering exact gajian bounds", () => {
    const bounds = periodBounds("2026-10", "gajian", 25, 20);
    const slices = buildWeekSlices(bounds.start, bounds.end);
    expect(slices[0]).toEqual({
      index: 1,
      label: "Minggu 1",
      start: "2026-10-25",
      end: "2026-10-31",
    });
    expect(slices[slices.length - 1]?.end).toBe("2026-11-24");
  });

  it("computes currentPeriodForCycle consistently with gajian and cc rules", () => {
    expect(currentPeriodForCycle("gajian", 25, 20, "2026-11-24")).toBe("2026-10");
    expect(currentPeriodForCycle("gajian", 25, 20, "2026-11-25")).toBe("2026-11");
    expect(currentPeriodForCycle("cc", 25, 20, "2026-11-19")).toBe("2026-11");
    expect(currentPeriodForCycle("cc", 25, 20, "2026-11-20")).toBe("2026-12");
  });

  it("formats compact Rupiah and parses signed overdraft amounts", () => {
    expect(formatCompactRupiah(20_000_000)).toBe("Rp20 jt");
    expect(formatCompactRupiah(1_500_000)).toBe("Rp1,5 jt");
    expect(formatCompactRupiah(-250_000)).toBe("-Rp250 rb");
    expect(formatCompactRupiah(1_500_000_000)).toBe("Rp1,5 M");
    expect(formatCompactRupiah(2_500_000_000)).toBe("Rp2,5 M");
    expect(formatCompactRupiah(10_000_000_000)).toBe("Rp10 M");
    expect(formatCompactRupiah(1_000_000_000_000)).toBe("Rp1 T");
    expect(formatCompactRupiah(2_500_000_000_000)).toBe("Rp2,5 T");
    expect(formatCompactRupiah(-5_000_000_000)).toBe("-Rp5 M");
    expect(parseSignedInt("-150.000")).toBe(-150_000);
    expect(formatSignedDigitsInput("-150000")).toBe("-150.000");
    expect(formatRupiah(-50_000)).toContain("\u2212");
  });

  it("spells out Rupiah in Indonesian words accurately", () => {
    expect(spellOutRupiah(0)).toBe("Nol rupiah");
    expect(spellOutRupiah(1000)).toBe("Seribu rupiah");
    expect(spellOutRupiah(25000)).toBe("Dua puluh lima ribu rupiah");
    expect(spellOutRupiah(50000)).toBe("Lima puluh ribu rupiah");
    expect(spellOutRupiah(1500000)).toBe("Satu juta lima ratus ribu rupiah");
    expect(spellOutRupiah(10000000)).toBe("Sepuluh juta rupiah");
    expect(spellOutRupiah(2000000000)).toBe("Dua miliar rupiah");
    expect(spellOutRupiah(1000000000000)).toBe("Satu triliun rupiah");
    expect(spellOutRupiah(-250000)).toBe("Minus Dua ratus lima puluh ribu rupiah");
  });
});
