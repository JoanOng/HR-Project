/**
 * Money math — integer minor units only.
 * A monthly base of 500000 === 5,000.00.
 *
 * Rounding rule (SKILL.md §3.4, agreed): every division in the payroll
 * pipeline is ONE integer division, rounded HALF_UP once. No intermediate
 * fractional values, no precomputed daily rates.
 */

/** a + b */
export function add(a: number, b: number): number {
  return a + b;
}

/** a - b (result may be negative, e.g. deductions) */
export function sub(a: number, b: number): number {
  return a - b;
}

/**
 * numerator / denominator, rounded HALF_UP.
 * Both operands are integers (minor units or day counts).
 * HALF_UP: 50/3 = 16.67 → 17. (Only exact .5 rounds up; ties on
 * integer results are exact anyway.)
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("division by zero");
  const q = Math.floor(Math.abs(numerator) / denominator);
  const r = Math.abs(numerator) - q * denominator;
  const rounded = 2 * r >= denominator ? q + 1 : q;
  return numerator < 0 && rounded > 0 ? -rounded : rounded;
}

/**
 * The only division shapes the payroll pipeline may use:
 *   numerator = amount (minor units) × factor (days)
 *   denominator = day count
 * e.g. baseMonthly × employedDays / calendarDaysInMonth
 *      baseMonthly × unpaidDays / workingDaysInMonth
 */
export function mulDiv(amount: number, factor: number, divisor: number): number {
  return divRoundHalfUp(amount * factor, divisor);
}

/** minor units → "1,234.56" for display only (never for math) */
export function formatDisplay(minorUnits: number): string {
  const sign = minorUnits < 0 ? "-" : "";
  const abs = Math.abs(minorUnits);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return sign + major.toLocaleString("en-US") + "." + cents;
}