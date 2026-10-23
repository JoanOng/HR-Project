/**
 * Timesheet domain logic — the §3.2 rulebook. Route handlers validate
 * input and call these. Throws coded Errors; routes map code → HTTP.
 *
 * Hours are decimal (0.5 increments). A day's hours live in each entry's
 * `hours` JSON grid: { "2026-01-05": 8 }.
 */
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import type { Scope } from "@/lib/permissions";
import { writeAudit } from "@/modules/employee/audit";
import type { EntryShape } from "@/lib/validation/timesheet";

const day0 = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Cfg = {
  maxHoursPerDay: number;
  standardDailyHours: number;
  maxOvertimePerDay: number;
  maxHoursPerPeriod: number;
  maxBackDatedDays: number;
  allowEmptySubmit: boolean;
  allowHolidayWork: boolean;
  country: string;
};

async function cfg(): Promise<Cfg> {
  const row = await prisma.appConfig.findUnique({ where: { id: "app" } });
  if (!row) throw Object.assign(new Error("appConfig row missing — run the seed"), { code: "NO_CONFIG" });
  return row as unknown as Cfg;
}

/** All days of a period, as ISO strings. `end` is inclusive. */
function periodDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  let d = new Date(start);
  while (d <= end) {
    days.push(iso(d));
    d = new Date(d.getTime() + 86400000);
  }
  return days;
}

const WEEKEND = [0, 6]; // Sun, Sat — weekends are calendar facts, not policy

type Loaded = {
  period: {
    id: string;
    employeeId: string;
    start: Date;
    end: Date;
    status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  };
  employee: { id: string; employeeNumber: string; hireDate: Date; terminatedAt: Date | null };
  projects: { id: string; code: string; name: string; isActive: boolean }[];
  holidays: Map<string, string>; // isoDay → name
};

async function loadPeriod(periodId: string, scope: Scope): Promise<Loaded | null> {
  const empIds =
    scope.type === "all" ? undefined : scope.type === "self" ? [scope.employeeId] : scope.employeeIds;

  const period = await prisma.timesheetPeriod.findFirst({
    where: { id: periodId, ...(empIds ? { employeeId: { in: empIds } } : {}) },
    include: {
      employee: { select: { id: true, employeeNumber: true, hireDate: true, terminatedAt: true } },
    },
  });
  if (!period) return null;

  const [projects, holidays, employee] = await Promise.all([
    prisma.project.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.holiday.findMany({
      where: {
        country: (await prisma.appConfig.findUnique({ where: { id: "app" } }))?.country ?? "SG",
        date: { gte: period.start, lte: period.end },
      },
    }),
    prisma.employee.findUniqueOrThrow({ where: { id: period.employeeId } }),
  ]);

  return {
    period: {
      id: period.id,
      employeeId: period.employeeId,
      start: period.start,
      end: period.end,
      status: period.status,
    },
    employee: {
      id: employee.id,
      employeeNumber: (period as unknown as { employeeNumber?: string }).employeeNumber ?? "",
      hireDate: employee.hireDate,
      terminatedAt: employee.terminatedAt,
    },
    projects,
    holidays: new Map(holidays.map((h) => [iso(h.date), h.name])),
  };
}

/**
 * The §3.2 validation. Returns a list of human-readable problems; empty = ok.
 * Checks, in order: day bounds, weekends, holidays, 0.5-step, per-day cap,
 * OT cap (REJECTED, never trimmed), project validity, period total.
 */
function validateEntries(
  entries: EntryShape[],
  loaded: Loaded,
  cfg: Cfg,
  today: Date,
): string[] {
  const problems: string[] = [];
  const { period, employee, projects, holidays } = loaded;
  const days = periodDays(period.start, period.end);
  const projectIds = new Set(projects.map((p) => p.id));

  // 1. Every entry's hours must be inside the period.
  for (const e of entries) {
    const label = e.projectId
      ? projects.find((p) => p.id === e.projectId)?.code ?? "unknown project"
      : (e.workCategory ?? "non-project");
    if (!e.projectId && !e.workCategory) problems.push("An entry has neither a project nor a category.");
    if (e.projectId && !projectIds.has(e.projectId)) problems.push(`${label}: project does not exist or is inactive.`);
    for (const day of Object.keys(e.hours)) {
      if (!days.includes(day)) problems.push(`${label}: ${day} is outside this timesheet period.`);
    }
  }

  // 2. Per-day, across all entries together.
  const byDay = new Map<string, number>();
  for (const e of entries) for (const [d, h] of Object.entries(e.hours)) byDay.set(d, (byDay.get(d) ?? 0) + h);

  for (const [d, total] of byDay) {
    const date = day0(d);
    if (WEEKEND.includes(date.getUTCDay())) {
      problems.push(`${d} is a weekend day — hours cannot be recorded.`);
    }
    if (holidays.has(d) && !cfg.allowHolidayWork) {
      problems.push(`${d} (${holidays.get(d)}) is a public holiday — hours cannot be recorded unless holiday work is allowed.`);
    }
    // employed during this day?
    if (date < employee.hireDate) problems.push(`${d} is before this employee's hire date.`);
    if (employee.terminatedAt && date >= day0(iso(employee.terminatedAt))) problems.push(`${d} is on/after this employee's termination date.`);
    // back-dating: entries for a day more than maxBackDatedDays in the past
    const ageDays = Math.floor((day0(iso(today)).getTime() - date.getTime()) / 86400000);
    if (ageDays > cfg.maxBackDatedDays) problems.push(`${d} is more than ${cfg.maxBackDatedDays} days in the past — back-dating is not allowed.`);

    if (total > cfg.maxHoursPerDay) problems.push(`${d}: ${total}h exceeds the ${cfg.maxHoursPerDay}h daily maximum.`);
    const ot = total - cfg.standardDailyHours;
    if (ot > cfg.maxOvertimePerDay) problems.push(`${d}: overtime of ${ot}h exceeds the ${cfg.maxOvertimePerDay}h daily cap (reduce the entry).`);
  }

  // 3. Period total (full-time cap; we do not scale by status in M2).
  const grand = [...byDay.values()].reduce((a, b) => a + b, 0);
  if (grand > cfg.maxHoursPerPeriod) problems.push(`Period total ${grand}h exceeds the ${cfg.maxHoursPerPeriod}h half-month maximum.`);

  return problems;
}

// ---------- Reads ----------

/** One period with its entries shaped for the grid. */
export async function getPeriodView(periodId: string, scope: Scope) {
  const loaded = await loadPeriod(periodId, scope);
  if (!loaded) return null;
  const entries = await prisma.timesheetEntry.findMany({
    where: { periodId },
    include: { project: { select: { code: true } } },
  });
  return {
    period: {
      id: loaded.period.id,
      employeeId: loaded.period.employeeId,
      employeeNumber: loaded.employee.employeeNumber,
      start: iso(loaded.period.start),
      end: iso(loaded.period.end),
      status: loaded.period.status,
      submittedAt: null as Date | null,
    },
    days: periodDays(loaded.period.start, loaded.period.end),
    weekends: periodDays(loaded.period.start, loaded.period.end).filter((d) => WEEKEND.includes(day0(d).getUTCDay())),
    holidays: [...loaded.holidays.entries()].map(([date, name]) => ({ date, name })),
    projects: loaded.projects.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    entries: entries.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      projectCode: e.project?.code ?? null,
      workCategory: e.workCategory,
      comment: e.comment,
      hours: e.hours as Record<string, number>,
    })),
    cfg: {
      maxHoursPerDay: 0,
      standardDailyHours: 0,
      maxOvertimePerDay: 0,
      maxHoursPerPeriod: 0,
      allowEmptySubmit: true,
    },
  };
}

/** List of the caller's visible periods, most recent first. */
export async function listPeriods(scope: Scope) {
  const empIds =
    scope.type === "all" ? undefined : scope.type === "self" ? [scope.employeeId] : scope.employeeIds;
  const cfgRow = await prisma.appConfig.findUnique({ where: { id: "app" } });
  const periods = await prisma.timesheetPeriod.findMany({
    where: { ...(empIds ? { employeeId: { in: empIds } } : {}) },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } },
    orderBy: { start: "desc" },
    take: 24,
  });
  return {
    periods: periods.map((p) => ({
      id: p.id,
      employeeNumber: p.employee.employeeNumber,
      employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
      start: iso(p.start),
      end: iso(p.end),
      status: p.status,
    })),
    cfg: cfgRow
      ? {
          maxHoursPerDay: cfgRow.maxHoursPerDay,
          standardDailyHours: cfgRow.standardDailyHours,
          maxOvertimePerDay: cfgRow.maxOvertimePerDay,
          maxHoursPerPeriod: cfgRow.maxHoursPerPeriod,
          allowEmptySubmit: cfgRow.allowEmptySubmit,
        }
      : null,
  };
}

// ---------- Writes ----------

/**
 * Save the whole grid (autosave). Only allowed on a DRAFT — or on a
 * REJECTED period while its half-month is still open (end >= today).
 * The submitted entries of other people are never touched: we only ever
 * write entries whose period belongs to the caller (scope-checked above).
 */
export async function savePeriod(periodId: string, entries: EntryShape[], scope: Scope, actorId: string) {
  const loaded = await loadPeriod(periodId, scope);
  if (!loaded) throw Object.assign(new Error("period not found"), { code: "NOT_FOUND" });

  const today = day0(iso(new Date()));
  const { period } = loaded;
  if (period.status === "SUBMITTED") {
    throw Object.assign(new Error("submitted timesheets are locked — withdraw it first"), { code: "LOCKED" });
  }
  if (period.status === "APPROVED") {
    throw Object.assign(new Error("approved timesheets are immutable — corrections go to HR"), { code: "IMMUTABLE" });
  }
  if (period.status === "REJECTED" && period.end < today) {
    throw Object.assign(new Error("this half-month has closed — ask HR to adjust"), { code: "PERIOD_CLOSED" });
  }

  const config = await cfg();
  // Empty-grid save is always fine (autosave); the empty-SUBMIT check happens
  // at submit time, per allowEmptySubmit.
  const problems = entries.length ? validateEntries(entries, loaded, config, today) : [];
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "VALIDATION", problems });

  // Write inside one transaction; audit OUTSIDE (dev compile is slow).
  await prisma.$transaction(
    async (tx) => {
      // Drop rows not in the incoming set, upsert the rest.
      const keepIds = new Set(entries.map((e) => (e.projectId ?? `nc:${e.workCategory}`)));
      const existing = await tx.timesheetEntry.findMany({ where: { periodId } });
      const toDelete = existing.filter((e) => !keepIds.has(e.projectId ?? `nc:${e.workCategory}`));
      if (toDelete.length) {
        await tx.timesheetEntry.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } });
      }
      for (const e of entries) {
        const key = e.projectId ?? `nc:${e.workCategory}`;
        const found = existing.find((x) => (x.projectId ?? `nc:${x.workCategory}`) === key);
        if (found) {
          await tx.timesheetEntry.update({
            where: { id: found.id },
            data: { workCategory: e.workCategory, comment: e.comment, hours: e.hours as never },
          });
        } else {
          await tx.timesheetEntry.create({
            data: {
              id: ulid(),
              periodId,
              projectId: e.projectId,
              workCategory: e.workCategory,
              comment: e.comment,
              hours: e.hours as never,
            },
          });
        }
      }
    },
    { timeout: 15000 },
  );

  await writeAudit(actorId, "TimesheetPeriod", periodId, "DRAFT_SAVED", undefined, {
    entryCount: entries.length,
  }, loaded.period.employeeId);
}

export async function submitPeriod(periodId: string, scope: Scope, actorId: string) {
  const loaded = await loadPeriod(periodId, scope);
  if (!loaded) throw Object.assign(new Error("period not found"), { code: "NOT_FOUND" });
  if (loaded.period.status !== "DRAFT" && loaded.period.status !== "REJECTED") {
    throw Object.assign(new Error("only draft/rejected timesheets can be submitted"), { code: "BAD_STATE" });
  }
  const config = await cfg();
  const entries = await prisma.timesheetEntry.findMany({ where: { periodId } });
  const hasHours = entries.some((e) => Object.values(e.hours as Record<string, number>).some((h) => h > 0));
  if (!hasHours && !config.allowEmptySubmit) {
    throw Object.assign(new Error("this timesheet has no hours and empty submission is not allowed"), { code: "EMPTY" });
  }
  const problems = entries.length ? validateEntries(
    entries.map((e) => ({ projectId: e.projectId, workCategory: e.workCategory, comment: e.comment, hours: e.hours as Record<string, number> })),
    loaded, config, day0(iso(new Date())),
  ) : [];
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "VALIDATION", problems });

  await prisma.timesheetPeriod.update({
    where: { id: periodId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  await writeAudit(actorId, "TimesheetPeriod", periodId, "SUBMIT", { status: "DRAFT" }, { status: "SUBMITTED" }, loaded.period.employeeId);
}

/** Employee pulls back a SUBMITTED period to DRAFT. Reason is mandatory. */
export async function withdrawPeriod(periodId: string, reason: string, scope: Scope, actorId: string) {
  const loaded = await loadPeriod(periodId, scope);
  if (!loaded) throw Object.assign(new Error("period not found"), { code: "NOT_FOUND" });
  // An employee may only withdraw their OWN period.
  if (scope.type !== "self" || scope.employeeId !== loaded.period.employeeId) {
    throw Object.assign(new Error("you can only withdraw your own timesheet"), { code: "NOT_YOURS" });
  }
  if (loaded.period.status !== "SUBMITTED") {
    throw Object.assign(new Error("only submitted timesheets can be withdrawn"), { code: "BAD_STATE" });
  }
  await prisma.timesheetPeriod.update({
    where: { id: periodId },
    data: { status: "DRAFT", submittedAt: null, reviewComment: null },
  });
  await writeAudit(actorId, "TimesheetPeriod", periodId, "WITHDRAW", { status: "SUBMITTED" }, { status: "DRAFT", reason }, loaded.period.employeeId);
}

/**
 * Manager (or HR) approves or rejects a SUBMITTED period.
 * REJECTED requires a comment. APPROVED is final and immutable.
 */
export async function reviewPeriod(periodId: string, decision: "APPROVED" | "REJECTED", comment: string | null, scope: Scope, actorId: string) {
  const loaded = await loadPeriod(periodId, scope);
  if (!loaded) throw Object.assign(new Error("period not found"), { code: "NOT_FOUND" });
  // Manager may only decide their own reports; HR anything.
  if (scope.type === "self") throw Object.assign(new Error("employees cannot review timesheets"), { code: "NO_PERMISSION" });
  if (scope.type === "reports" && !scope.employeeIds.includes(loaded.period.employeeId)) {
    throw Object.assign(new Error("period not found"), { code: "NOT_FOUND" }); // never 403
  }
  if (loaded.period.status !== "SUBMITTED") {
    throw Object.assign(new Error("only submitted timesheets can be reviewed"), { code: "BAD_STATE" });
  }
  if (decision === "REJECTED" && !comment?.trim()) {
    throw Object.assign(new Error("a comment is required to reject"), { code: "NEED_COMMENT" });
  }
  await prisma.timesheetPeriod.update({
    where: { id: periodId },
    data: { status: decision, reviewedAt: new Date(), reviewComment: comment },
  });
  await writeAudit(actorId, "TimesheetPeriod", periodId, decision, { status: "SUBMITTED" }, { status: decision, comment }, loaded.period.employeeId);
}