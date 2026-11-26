import { describe, expect, it } from "bun:test";
import {
  addMonthsToDate,
  ccCycleForDate,
  ccDueDateForCycle,
  ccPostingDateInCycle,
  periodBounds,
} from "../../../shared/src/dates";
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
    expect(formatCompactRupiah(20_000_000)).toBe("Rp\u00A020\u00A0jt");
    expect(formatCompactRupiah(1_500_000)).toBe("Rp\u00A01,5\u00A0jt");
    expect(formatCompactRupiah(-250_000)).toBe("-Rp\u00A0250\u00A0rb");
    expect(formatCompactRupiah(8_000)).toBe("Rp\u00A08\u00A0rb");
    expect(formatCompactRupiah(1_500_000_000)).toBe("Rp\u00A01,5\u00A0M");
    expect(formatCompactRupiah(2_500_000_000)).toBe("Rp\u00A02,5\u00A0M");
    expect(formatCompactRupiah(10_000_000_000)).toBe("Rp\u00A010\u00A0M");
    // Rounding up to the next tier must switch the unit.
    expect(formatCompactRupiah(999_500)).toBe("Rp\u00A01\u00A0jt");
    expect(formatCompactRupiah(999_400)).toBe("Rp\u00A0999\u00A0rb");
    expect(formatCompactRupiah(999_960_000)).toBe("Rp\u00A01\u00A0M");
    expect(formatCompactRupiah(1_000_000_000_000)).toBe("Rp\u00A01\u00A0T");
    expect(formatCompactRupiah(2_500_000_000_000)).toBe("Rp\u00A02,5\u00A0T");
    expect(formatCompactRupiah(-5_000_000_000)).toBe("-Rp\u00A05\u00A0M");
    expect(formatCompactRupiah(500, true)).toBe("Rp\u00A0•••••••");
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

  it("places a card installment on the chosen statement via its posting date", () => {
    // Jenius: cut-off 21, payment day 7. Laptop installment posts on the 29th.
    const first = ccPostingDateInCycle("2026-12", 21, 29);
    expect(first).toBe("2026-11-29");
    expect(ccCycleForDate(first!, 21)).toBe("2026-12");
    expect(ccDueDateForCycle("2026-12", 21, 7)).toBe("2027-01-07");

    // Monthly progression keeps every installment on the next statement, February included.
    const feb = addMonthsToDate(first!, 3).dueDate;
    expect(feb).toBe("2027-02-28");
    expect(ccCycleForDate(feb, 21)).toBe("2027-03");

    // Without a posting day it uses the last day before cut-off, inside the cycle.
    expect(ccPostingDateInCycle("2026-12", 21)).toBe("2026-12-20");
    expect(ccPostingDateInCycle("2026-12", 1)).toBe("2026-11-30");

    // A day before the cut-off falls in the statement month itself.
    expect(ccPostingDateInCycle("2026-12", 21, 5)).toBe("2026-12-05");
    // A day that cannot exist inside the cycle is rejected.
    expect(ccPostingDateInCycle("2027-03", 30, 30)).toBeNull();
  });
});