// Pure payroll math. No DB, no Dates-with-timezone games — everything in
// integer minor units (sen). Every division rounds HALF_UP, and the rule is
// documented at each use (SKILL.md §3.4 step 11: round once, at the total
// line level only).

export type TaxBand = { min: number; max: number | null; rate: number }; // rate = percent, e.g. 3
export type Contribution = {
  code: string;
  name: string;
  who: "EMPLOYEE" | "EMPLOYER" | "BOTH";
  rate: number; // percent
  base: "GROSS" | "BASE";
  capPerMonth: number | null; // minor units
};

/** HALF_UP integer division: floor((n / d) + 0.5) for n ≥ 0, d > 0. */
function divHalfUp(n: number, d: number): number {
  if (d <= 0) throw new Error("divHalfUp: divisor must be positive");
  return Math.floor(n / d + 0.5);
}

/**
 * Progressive tax on a monthly gross, in sen.
 * Employee tax = Σ over bands of (min(gross, band.max) − band.min) × rate,
 * clamped at 0 per band, one HALF_UP rounding at the TOTAL.
 */
export function computeTax(gross: number, bands: TaxBand[]): number {
  let raw = 0; // in hundredths-of-a-sen — accumulate exact, round once at the end
  for (const b of bands) {
    const top = b.max === null ? gross : Math.min(gross, b.max);
    const slice = Math.max(0, top - b.min);
    raw += slice * b.rate; // rate is a percent → raw is gross×rate/100 un-divided
  }
  return divHalfUp(raw, 100);
}

/**
 * One contribution line, in sen: min(base, cap) × rate, one HALF_UP rounding.
 */
export function computeContribution(baseAmount: number, c: Contribution): number {
  const capped = c.capPerMonth === null ? baseAmount : Math.min(baseAmount, c.capPerMonth);
  return divHalfUp(capped * c.rate, 100);
}

/**
 * Pro-ration by employed days: monthly × employedDays / calendarDays,
 * one HALF_UP rounding (SKILL.md §3.4 step 2/3).
 */
export function prorate(monthly: number, employedDays: number, calendarDays: number): number {
  if (employedDays >= calendarDays) return monthly;
  return divHalfUp(monthly * employedDays, calendarDays);
}

/**
 * Unpaid-leave deduction (SKILL.md §3.4 step 5):
 * dailyRate = base / workingDaysInMonth (HALF_UP, computed once),
 * deduction = dailyRate × unpaidDays.
 */
export function unpaidLeaveDeduction(base: number, workingDaysInMonth: number, unpaidDays: number): number {
  if (unpaidDays <= 0) return 0;
  const dailyRate = divHalfUp(base, workingDaysInMonth);
  return dailyRate * unpaidDays;
}