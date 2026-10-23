// Payroll run lifecycle: DRAFT → COMPLETED → PUBLISHED / VOIDED (SKILL.md §3.4).
// HR-only writes; a run can only be completed by someone who did not prepare it.
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import { writeAudit } from "@/modules/employee/audit";
import { generatePayslips, eligibleEmployeeIds } from "./engine";

type Coded = Error & { code: string };
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code }) as Coded;
}

export type RunActor = { id: string; role: string };

/** Month must be fully in the past (last day of the month < today). */
function monthInPast(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)); // last instant of month end
  const now = new Date();
  return lastDay.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export async function createRun(actor: RunActor, input: { year: number; month: number; note?: string; oneOffs?: { employeeId: string; code: string; name: string; amount: number }[] }) {
  const { year, month } = input;
  if (actor.role !== "HR") fail("NO_PERMISSION", "Only HR can create a payroll run");
  if (!monthInPast(year, month)) fail("BAD_STATE", "The month must be fully in the past");

  const existing = await prisma.payrollRun.findFirst({
    where: { year, month, status: { not: "VOIDED" } },
  });
  if (existing) fail("EXISTING_RUN", `A ${existing.status} run already exists for ${year}-${String(month).padStart(2, "0")}`);

  const ids = await eligibleEmployeeIds(year, month);
  const run = await prisma.payrollRun.create({
    data: {
      id: ulid(),
      year,
      month,
      preparedById: actor.id,
      note: input.note ?? null,
      activeRun: 1,
    },
  });
  await generatePayslips(run.id, { year, month, oneOffs: input.oneOffs }, ids);
  await writeAudit(actor.id, "PayrollRun", run.id, "CREATE", undefined, { year, month, employeeCount: ids.length });
  return { id: run.id, year, month, employeeCount: ids.length };
}

async function loadRun(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) fail("NOT_FOUND", "Run not found");
  return run;
}

/** Complete: DRAFT → COMPLETED. Not by the preparer. */
export async function completeRun(actor: RunActor, runId: string) {
  if (actor.role !== "HR") fail("NO_PERMISSION", "Only HR can complete a payroll run");
  const run = await loadRun(runId);
  if (run.status !== "DRAFT") fail("BAD_STATE", `Run is ${run.status}, not DRAFT`);
  if (run.preparedById === actor.id) fail("NO_SELF_APPROVE", "You cannot complete a run you prepared");
  await prisma.payrollRun.update({
    where: { id: runId },
    data: { status: "COMPLETED", approvedById: actor.id, approvedAt: new Date() },
  });
  await writeAudit(actor.id, "PayrollRun", runId, "COMPLETE", { status: "DRAFT" }, { status: "COMPLETED" });
  return { id: runId, status: "COMPLETED" };
}

/** Publish: COMPLETED → PUBLISHED (payslips visible to employees, locked). */
export async function publishRun(actor: RunActor, runId: string) {
  if (actor.role !== "HR") fail("NO_PERMISSION", "Only HR can publish a payroll run");
  const run = await loadRun(runId);
  if (run.status !== "COMPLETED") fail("BAD_STATE", `Run is ${run.status}, not COMPLETED`);
  await prisma.payrollRun.update({
    where: { id: runId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  await writeAudit(actor.id, "PayrollRun", runId, "PUBLISH", { status: "COMPLETED" }, { status: "PUBLISHED" });
  return { id: runId, status: "PUBLISHED" };
}

/** Void: DRAFT/COMPLETED/PUBLISHED → VOIDED. Payslips stay, flagged via the run. */
export async function voidRun(actor: RunActor, runId: string, reason: string) {
  if (actor.role !== "HR") fail("NO_PERMISSION", "Only HR can void a payroll run");
  const run = await loadRun(runId);
  if (run.status === "VOIDED") fail("BAD_STATE", "Run is already voided");
  await prisma.payrollRun.update({
    where: { id: runId },
    data: { status: "VOIDED", activeRun: 0, voidedAt: new Date(), voidReason: reason },
  });
  await writeAudit(actor.id, "PayrollRun", runId, "VOID", { status: run.status }, { status: "VOIDED", reason });
  return { id: runId, status: "VOIDED" };
}

export async function listRuns() {
  const runs = await prisma.payrollRun.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { payslips: true } } },
  });
  return runs.map((r) => ({
    id: r.id,
    year: r.year,
    month: r.month,
    status: r.status,
    employeeCount: r._count.payslips,
    preparedById: r.preparedById,
    preparedAt: r.createdAt.toISOString(),
    completedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    voidReason: r.voidReason,
    note: r.note,
  }));
}

export async function getRun(runId: string) {
  const run = await loadRun(runId);
  const payslips = await prisma.payslip.findMany({
    where: { runId },
    include: {
      employee: { select: { employeeNumber: true, firstName: true, lastName: true } },
      lines: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    id: run.id,
    year: run.year,
    month: run.month,
    status: run.status,
    note: run.note,
    voidReason: run.voidReason,
    preparedAt: run.createdAt.toISOString(),
    completedAt: run.approvedAt ? run.approvedAt.toISOString() : null,
    publishedAt: run.publishedAt ? run.publishedAt.toISOString() : null,
    payslips: payslips.map((p) => ({
      id: p.id,
      employeeNumber: p.employee.employeeNumber,
      employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
      baseMonthly: p.baseMonthly,
      employedDays: p.employedDays,
      calendarDays: p.calendarDays,
      gross: p.gross,
      tax: p.tax,
      empContrib: p.empContrib,
      erContrib: p.erContrib,
      net: p.net,
      flags: p.flags,
      lines: p.lines,
    })),
  };
}

/** One payslip — owner, or HR. Employees can only see PUBLISHED ones. */
export async function getPayslip(payslipId: string, actor: RunActor) {
  const p = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { run: true, employee: true, lines: true },
  });
  if (!p) fail("NOT_FOUND", "Payslip not found");
  if (actor.role !== "HR" && p.employeeId !== actor.id) fail("NOT_FOUND", "Payslip not found");
  if (actor.role !== "HR" && p.run.status !== "PUBLISHED") fail("BAD_STATE", "Payslip is not published yet");
  return {
    id: p.id,
    year: p.year,
    month: p.month,
    employeeNumber: p.employee.employeeNumber,
    employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
    baseMonthly: p.baseMonthly,
    employedDays: p.employedDays,
    calendarDays: p.calendarDays,
    gross: p.gross,
    tax: p.tax,
    empContrib: p.empContrib,
    erContrib: p.erContrib,
    net: p.net,
    flags: p.flags,
    runStatus: p.run.status,
    lines: p.lines,
  };
}