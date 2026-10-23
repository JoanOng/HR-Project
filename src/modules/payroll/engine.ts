// The monthly payroll pipeline (SKILL.md §3.4). Produces payslips for every
// employee employed during the month. Money is integer minor units end to end.
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import {
  type TaxBand,
  type Contribution,
  computeTax,
  computeContribution,
  prorate,
  unpaidLeaveDeduction,
} from "./math";

type Coded = Error & { code: string; problems?: string[] };
function fail(code: string, message: string, problems?: string[]): never {
  throw Object.assign(new Error(message), { code, problems }) as Coded;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function atMidnight(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

type MoneyLine = { code: string; name: string; amount: number; kind: "EARNED" | "DEDUCTED"; note?: string | null };

export type PayslipDraft = {
  employeeId: string;
  baseMonthly: number;
  employedDays: number;
  calendarDays: number;
  lines: MoneyLine[];
  gross: number;
  tax: number;
  empContrib: number;
  erContrib: number;
  net: number;
  flags: string[];
};

export type MonthInput = {
  year: number;
  month: number; // 1-12
  oneOffs?: { employeeId: string; code: string; name: string; amount: number }[]; // taxable bonuses / one-offs
};

/** Calendar days in the month (UTC). */
export function calendarDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Working days = weekdays minus that country's holidays in the month. */
async function workingDaysIn(year: number, month: number): Promise<number> {
  const [appCfg, payCfg] = await Promise.all([
    prisma.appConfig.findUnique({ where: { id: "app" } }),
    prisma.payrollConfig.findUnique({ where: { id: "app" } }),
  ]);
  const country = appCfg?.country ?? "SG";
  const last = calendarDays(year, month);
  const pad = String(month).padStart(2, "0");
  const from = atMidnight(`${year}-${pad}-01`);
  const to = new Date(Date.UTC(year, month, 0, 15, 59, 59));
  const holidays = await prisma.holiday.findMany({ where: { country, date: { gte: from, lte: to } } });
  const holidaySet = new Set(holidays.map((h) => iso(h.date)));
  // Weekend flags come from PayrollConfig when present; default Sat+Sun (§3.5.3).
  const satOff = payCfg?.workingDaysSat === false; // false → Saturday IS a working day
  const sunOff = payCfg?.workingDaysSun === false;
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
    if (wd === 6 && !satOff) continue;
    if (wd === 0 && !sunOff) continue;
    if (holidaySet.has(`${year}-${pad}-${String(d).padStart(2, "0")}`)) continue;
    n++;
  }
  return Math.max(1, n);
}

/**
 * Compute one employee's payslip draft for the month. Pure except for the
 * DB reads; the caller does the writes.
 */
export async function computePayslip(input: MonthInput, employeeId: string): Promise<PayslipDraft> {
  const { year, month } = input;
  const cDays = calendarDays(year, month);
  const monthStart = atMidnight(`${year}-${String(month).padStart(2, "0")}-01`);
  const monthEnd = new Date(Date.UTC(year, month, 0, 15, 59, 59));

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) fail("NOT_FOUND", "Employee not found");

  const flags: string[] = [];

  // 1. Eligibility: employed at any point during the month.
  const effHire = employee.hireDate;
  const effTerm = employee.terminatedAt ?? null;
  if (effTerm && effTerm < monthStart) fail("NOT_ELIGIBLE", "Employee terminated before the month");
  if (effHire > monthEnd) fail("NOT_ELIGIBLE", "Employee hired after the month");

  // Employed days (inclusive, calendar days), clamped to the month.
  const first = effHire > monthStart ? new Date(effHire) : monthStart;
  const last = effTerm ? new Date(effTerm) : new Date(monthEnd);
  const employedDays = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000) + 1);
  if (effHire > monthStart) flags.push("JOINED_MID_MONTH");
  if (effTerm && effTerm < monthEnd) flags.push("TERMINATED_MID_MONTH");

  // 2. Base pay — salary record in force at month start.
  const sal = await prisma.salaryRecord.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: monthStart },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: monthStart } }],
    },
  });
  if (!sal) fail("NO_SALARY", `No salary record in force for ${iso(monthStart)}`);

  const lines: MoneyLine[] = [];
  const base = prorate(sal.baseMonthly, employedDays, cDays);
  lines.push({
    code: "BASE",
    name: "Base salary",
    amount: base,
    kind: "EARNED",
    note: employedDays < cDays ? `pro-rated ${employedDays}/${cDays} days` : null,
  });

  // 3. Allowances & standing deductions (pro-rated alongside base when partial month).
  const allowanceList = (sal.allowances as { code: string; name: string; amount: number }[] | null) ?? [];
  for (const a of allowanceList) {
    lines.push({
      code: `ALLOW_${a.code}`,
      name: a.name,
      amount: prorate(a.amount, employedDays, cDays),
      kind: "EARNED",
    });
  }
  for (const d of (sal.standingDeductions as { code: string; name: string; amount: number }[] | null) ?? []) {
    lines.push({
      code: `DED_${d.code}`,
      name: d.name,
      amount: prorate(d.amount, employedDays, cDays),
      kind: "DEDUCTED",
    });
  }

  // 4. No overtime pay (decision).

  // 5. Leave — paid leave is inside base; unpaid leave deducts dailyRate × days.
  const unpaid = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      typeId: { in: [] }, // filled below
    },
  });
  const unpaidType = await prisma.leaveType.findUnique({ where: { code: "UNPAID" } });
  let unpaidDays = 0;
  if (unpaidType) {
    for (const r of unpaid.filter((r) => r.typeId === unpaidType.id)) {
      // days overlapping this month (requests are 00:00-UTC inclusive ranges)
      const f = r.from > monthStart ? r.from : monthStart;
      const t = r.to < monthEnd ? r.to : monthEnd;
      if (f <= t) unpaidDays += Math.round((f.getTime() - t.getTime()) / 86400000) + 1;
    }
  }
  // Half-day requests: `days` is the source of truth, not calendar span.
  if (unpaidType) {
    unpaidDays = 0;
    for (const r of unpaid.filter((r) => r.typeId === unpaidType.id)) {
      const f = r.from > monthStart ? r.from : monthStart;
      const t = r.to < monthEnd ? r.to : monthEnd;
      if (f <= t) unpaidDays += r.days; // sum stored days; cross-month splits are rare — note it
    }
  }
  const wdInMonth = await workingDaysIn(year, month);
  const ulDeduction = unpaidLeaveDeduction(base, wdInMonth, unpaidDays);
  if (ulDeduction > 0) {
    lines.push({
      code: "UNPAID_LEAVE",
      name: "Unpaid leave",
      amount: ulDeduction,
      kind: "DEDUCTED",
      note: `${unpaidDays} day(s) × daily rate ${Math.floor(base / wdInMonth + 0.5) / 100}`,
    });
  }

  // 10. One-off items (taxable, EARNED unless a negative is ever needed — keep
  //     one-off deductions as DEDUCTED lines via a negative code prefix).
  for (const o of (input.oneOffs ?? []).filter((o) => o.employeeId === employeeId)) {
    lines.push({ code: o.code, name: o.name, amount: o.amount, kind: "EARNED", note: "one-off" });
  }

  // 6. Gross = base + allowances + one-offs − standing deductions − unpaid leave.
  const earned = lines.filter((l) => l.kind === "EARNED").reduce((s, l) => s + l.amount, 0);
  const preTaxDeducted = lines.filter((l) => l.kind === "DEDUCTED").reduce((s, l) => s + l.amount, 0);
  const gross = earned - preTaxDeducted;

  // 7-8. Tax + contributions — config is data, DEMO until confirmed.
  const cfg = await prisma.payrollConfig.findUnique({ where: { id: "app" } });
  if (!cfg) fail("NO_CONFIG", "PayrollConfig missing — run the seed");
  const bands = cfg.taxBands as TaxBand[];
  const contributions = cfg.contributions as Contribution[];

  const tax = computeTax(gross, bands);
  let empContrib = 0;
  let erContrib = 0;
  for (const c of contributions) {
    const cBase = c.base === "GROSS" ? gross : base;
    const amount = computeContribution(cBase, c);
    if (c.who === "EMPLOYEE" || c.who === "BOTH") {
      empContrib += amount;
      lines.push({ code: `C_${c.code}`, name: `${c.name} (employee)`, amount, kind: "DEDUCTED" });
    }
    if (c.who === "EMPLOYER" || c.who === "BOTH") {
      erContrib += amount;
    }
  }
  if (tax > 0) lines.push({ code: "TAX", name: "Income tax", amount: tax, kind: "DEDUCTED" });

  // 9. Net = gross − pre-tax deductions − tax − employee contributions.
  const net = gross - preTaxDeducted - tax - empContrib;

  return { employeeId, baseMonthly: sal.baseMonthly, employedDays, calendarDays: cDays, lines, gross, tax, empContrib, erContrib, net, flags };
}

/**
 * Run the whole month: every eligible employee gets a payslip in `run`.
 * Idempotency is enforced by the (year, month, activeRun) unique index at the
 * caller when the run row is created; this only writes payslips.
 */
export async function generatePayslips(runId: string, input: MonthInput, employeeIds: string[]): Promise<void> {
  for (const employeeId of employeeIds) {
    try {
      const draft = await computePayslip(input, employeeId);
      const ps = await prisma.payslip.create({
        data: {
          id: ulid(),
          runId,
          employeeId: draft.employeeId,
          year: input.year,
          month: input.month,
          baseMonthly: draft.baseMonthly,
          employedDays: draft.employedDays,
          calendarDays: draft.calendarDays,
          gross: draft.gross,
          tax: draft.tax,
          empContrib: draft.empContrib,
          erContrib: draft.erContrib,
          net: draft.net,
          flags: draft.flags.join(",") || null,
        },
      });
      for (const l of draft.lines) {
        await prisma.payslipLine.create({
          data: { id: ulid(), payslipId: ps.id, code: l.code, name: l.name, amount: l.amount, kind: l.kind, note: l.note },
        });
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "NOT_ELIGIBLE") continue;
      const problems = (e as { problems?: string[] }).problems;
      if (code === "VALIDATION") fail("VALIDATION", "A payslip failed validation", problems);
      throw e;
    }
  }
}

/** Eligible employee ids for a month (employed at any point in it). */
export async function eligibleEmployeeIds(year: number, month: number): Promise<string[]> {
  const monthStart = atMidnight(`${year}-${String(month).padStart(2, "0")}-01`);
  const monthEnd = new Date(Date.UTC(year, month, 0, 15, 59, 59));
  const rows = await prisma.employee.findMany({
    where: {
      hireDate: { lte: monthEnd },
      OR: [{ terminatedAt: null }, { terminatedAt: { gte: monthStart } }],
      isDeletedAt: null,
    },
    select: { id: true },
    orderBy: { employeeNumber: "asc" },
  });
  return rows.map((r) => r.id);
}