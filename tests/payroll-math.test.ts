import { describe, it, expect } from "vitest";
import { computeTax, computeContribution, prorate, unpaidLeaveDeduction } from "../src/modules/payroll/math";

const BANDS = [
  { min: 0, max: 500000, rate: 0 },
  { min: 500000, max: 2000000, rate: 3 },
  { min: 2000000, max: 5000000, rate: 8 },
  { min: 5000000, max: null, rate: 14 },
];

describe("computeTax (progressive, monthly gross, sen)", () => {
  it("gross below the first band → 0", () => {
    expect(computeTax(499999, BANDS)).toBe(0);
  });

  it("gross exactly on a band boundary (5,000.00) → 0", () => {
    expect(computeTax(500000, BANDS)).toBe(0);
  });

  it("1,000.00 into the 3% band → 30.00", () => {
    // (1,000,000 − 500,000) × 3 / 100 = 15,000
    expect(computeTax(1000000, BANDS)).toBe(15000);
  });

  it("straddles two bands with one rounding at the total", () => {
    // gross 3,000,000: (2,000,000−500,000)×3% = 45,000 + (3,000,000−2,000,000)×8% = 80,000 → 125,000
    expect(computeTax(3000000, BANDS)).toBe(125000);
  });

  it("above all bands", () => {
    // gross 6,000,000: 45,000 + 240,000 + (6,000,000−5,000,000)×14% = 140,000 → 425,000
    expect(computeTax(6000000, BANDS)).toBe(425000);
  });
});

describe("computeContribution (cap + single HALF_UP)", () => {
  it("employee 11% of base 5,000.00, no cap → 550.00", () => {
    expect(computeContribution(500000, { code: "EPF", name: "x", who: "EMPLOYEE", rate: 11, base: "BASE", capPerMonth: null })).toBe(55000);
  });

  it("capped base", () => {
    // base 8,000.00, cap 4,000.00, 11% → 440.00
    expect(computeContribution(800000, { code: "EPF", name: "x", who: "EMPLOYEE", rate: 11, base: "BASE", capPerMonth: 400000 })).toBe(44000);
  });

  it("HALF_UP on the fraction (3% of 100.01 → 3.00, not 2.99)", () => {
    // 10001 × 3 = 30003 / 100 = 300.03 → 300
    expect(computeContribution(10001, { code: "X", name: "x", who: "EMPLOYEE", rate: 3, base: "GROSS", capPerMonth: null })).toBe(300);
  });
});

describe("prorate (employed days)", () => {
  it("full month → unchanged", () => {
    expect(prorate(500000, 31, 31)).toBe(500000);
  });

  it("joins 12/31 → HALF_UP", () => {
    // 5,000,000… wait: 5,000.00 = 500000; 500000 × 12 / 31 = 193548.39 → 193548
    expect(prorate(500000, 12, 31)).toBe(193548);
  });
});

describe("unpaidLeaveDeduction (dailyRate = base / workingDays, HALF_UP once)", () => {
  it("2 unpaid days, base 4,720.00 over 20 working days → 472.00/day × 2", () => {
    expect(unpaidLeaveDeduction(472000, 20, 2)).toBe(47200);
  });

  it("HALF_UP daily rate: base 500,000 / 21 working days = 23,809.52 → 23,810 × 1", () => {
    expect(unpaidLeaveDeduction(500000, 21, 1)).toBe(23810);
  });

  it("zero unpaid days → 0", () => {
    expect(unpaidLeaveDeduction(500000, 21, 0)).toBe(0);
  });
});