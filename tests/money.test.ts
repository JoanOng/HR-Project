import { describe, it, expect } from "vitest";
import { add, sub, divRoundHalfUp, mulDiv, formatDisplay } from "../src/lib/money";

describe("money", () => {
  it("adds and subtracts minor units", () => {
    expect(add(1000, 250)).toBe(1250);
    expect(sub(1250, 4000)).toBe(-2750);
  });

  describe("divRoundHalfUp", () => {
    it("rounds .5 up, not .49", () => {
      expect(divRoundHalfUp(50, 1)).toBe(50);
      expect(divRoundHalfUp(5, 2)).toBe(3);      // 2.5 → 3
      expect(divRoundHalfUp(15, 2)).toBe(8);     // 7.5 → 8
      expect(divRoundHalfUp(4, 2)).toBe(2);      // exact, unchanged
      expect(divRoundHalfUp(9, 2)).toBe(5);      // 4.5 → 5
    });

    it("rounds down below .5", () => {
      expect(divRoundHalfUp(100, 3)).toBe(33);   // 33.33…
      expect(divRoundHalfUp(101, 3)).toBe(34);   // 33.66…
    });

    it("handles negatives and rejects zero divisor", () => {
      expect(divRoundHalfUp(-5, 2)).toBe(-3);    // -2.5 → -3 (HALF_UP away from zero)
      expect(() => divRoundHalfUp(10, 0)).toThrow("division by zero");
    });
  });

  describe("mulDiv (the payroll pro-ration shape)", () => {
    // 5,000.00 (500000) for 20 of 31 days = 322580.6… → 322581
    it("pro-rates as ONE division, HALF_UP once", () => {
      expect(mulDiv(500000, 20, 31)).toBe(322581);
    });
    it("unpaid-leave deduction shape", () => {
      // 5,000.00, 2 unpaid days, 22 working days = 45454.5… → 45455
      expect(mulDiv(500000, 2, 22)).toBe(45455);
    });
  });

  it("formats for display without affecting math", () => {
    expect(formatDisplay(123456)).toBe("1,234.56");
    expect(formatDisplay(-50)).toBe("-0.50");
  });
});