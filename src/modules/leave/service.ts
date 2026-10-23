/**
 * Leave engine — §3.3. Request validation (overlap, consecutive days,
 * employed range, balance projection), approve/reject/cancel, balances.
 * Days are 0.5-step numbers; no accrual — fixed entitlement per year, resets Jan 1.
 */
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import type { Scope } from "@/lib/permissions";
import { writeAudit } from "@/modules/employee/audit";
import type { RequestLeaveShape } from "@/lib/validation/leave";

const day0 = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type LoadedReq = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  typeCode: string;
  typeName: string;
  typeEntitlement: number | null;
  from: Date;
  to: Date;
  days: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedAt: Date | null;
  decisionComment: string | null;
};

/** Scope-checked load of one request. Returns null when out of scope (→ 404, never 403). */
async function loadRequest(id: string, scope: Scope): Promise<LoadedReq | null> {
  const empIds =
    scope.type === "all" ? undefined : scope.type === "self" ? [scope.employeeId] : scope.employeeIds;
  const r = await prisma.leaveRequest.findFirst({
    where: { id, ...(empIds ? { employeeId: { in: empIds } } : {}) },
    include: {
      employee: { select: { employeeNumber: true } },
      type: { select: { code: true, name: true, entitlementDays: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeNumber: r.employee.employeeNumber,
    typeCode: r.type.code,
    typeName: r.type.name,
    typeEntitlement: r.type.entitlementDays,
    from: r.from,
    to: r.to,
    days: r.days,
    reason: r.reason,
    status: r.status,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
  };
}

/**
 * Balance check for a PAID type.
 * available = entitlement − Σ(all non-CANCELLED, non-REJECTED days this year)
 * The new request's days must fit.
 */
async function checkBalance(
  employeeId: string,
  typeId: string,
  year: number,
  extraDays: number,
): Promise<{ ok: boolean; available: number; entitlement: number; used: number }> {
  const balance = await prisma.leaveBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId, typeId, year } },
  });
  if (!balance || balance.entitlement == null) {
    return { ok: true, available: Infinity, entitlement: 0, used: 0 };
  }
  const [min, max] = [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31, 23, 59, 59))];
  const consumed = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      typeId,
      status: { in: ["PENDING", "APPROVED"] },
      from: { lte: max },
      to: { gte: min },
    },
    select: { days: true },
  });
  const used = consumed.reduce((a, r) => a + r.days, 0);
  const available = balance.entitlement - used;
  return { ok: available - extraDays >= -1e-9, available, entitlement: balance.entitlement, used };
}

/**
 * The §3.3 request validation. Returns a list of problems; empty = ok.
 * Also returns a `notice` warning (min-notice) that is NOT blocking.
 */
async function validateRequest(
  input: RequestLeaveShape,
  employeeId: string,
  employee: { hireDate: Date; terminatedAt: Date | null },
): Promise<{ problems: string[]; notice: string | null }> {
  const problems: string[] = [];
  let notice: string | null = null;

  const from = day0(input.from);
  const to = day0(input.to);
  if (from > to) {
    problems.push("From date must be on or before to date.");
    return { problems, notice };
  }

  const type = await prisma.leaveType.findUnique({ where: { code: input.typeCode } });
  if (!type || !type.isActive) {
    problems.push(`Leave type ${input.typeCode} is not active.`);
    return { problems, notice };
  }

  // employed during the whole range
  if (from < employee.hireDate) problems.push(`${input.from} is before the hire date.`);
  if (employee.terminatedAt && to >= day0(iso(employee.terminatedAt))) {
    problems.push(`${input.to} is on/after the termination date.`);
  }

  // consecutive-day cap
  const lenDays = (to.getTime() - from.getTime()) / 86400000 + 1;
  if (type.maxConsecutiveDays != null && lenDays > type.maxConsecutiveDays) {
    problems.push(`Request length of ${lenDays} days exceeds the ${type.maxConsecutiveDays}-day maximum for ${type.name}.`);
  }

  // the `days` field must match the calendar span (whole or half days)
  if (input.days < 0.5) problems.push("Request must be at least a half day.");
  if (Math.abs(input.days - lenDays) > 1e-9 && Math.abs(input.days - lenDays + 0.5) > 1e-9) {
    problems.push(`Requested ${input.days} day(s) does not match the calendar span of ${lenDays} day(s). Use 0.5 for a half day.`);
  }

  // overlap with any other non-cancelled, non-rejected request of ANY type
  const overlaps = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      from: { lte: to },
      to: { gte: from },
    },
    select: { id: true, from: true, to: true, type: { select: { code: true } } },
  });
  if (overlaps.length) {
    problems.push(
      `Overlaps an existing request (${overlaps[0].type.code} ${iso(overlaps[0].from)} → ${iso(overlaps[0].to)}).`,
    );
  }

  // balance projection for paid types
  if (type.entitlementDays != null) {
    const bal = await checkBalance(employeeId, type.id, from.getUTCFullYear(), input.days);
    if (!bal.ok) {
      problems.push(
        `Insufficient ${type.name} balance: available ${bal.available} day(s), requested ${input.days} day(s).`,
      );
    }
  }

  // min-notice: warn, not block
  const today = day0(iso(new Date()));
  if (type.minNoticeDays > 0) {
    const noticeDays = Math.floor((from.getTime() - today.getTime()) / 86400000);
    if (noticeDays < type.minNoticeDays) {
      notice = `Short notice: ${type.name} requests usually need ${type.minNoticeDays} day(s) — this one starts in ${Math.max(noticeDays, 0)} day(s). The approver may decline.`;
    }
  }

  return { problems, notice };
}

// ---------- Reads ----------

export type LeaveView = {
  types: {
    code: string;
    name: string;
    entitlement: number | null;
    used: number;
    available: number | null;
  }[];
  year: number;
  requests: {
    id: string;
    employeeId: string;
    employeeNumber: string;
    typeCode: string;
    typeName: string;
    typeEntitlement: number | null;
    from: string;
    to: string;
    days: number;
    reason: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    decidedAt: string | null;
    decisionComment: string | null;
  }[];
};

/** Balances + requests for the caller's scope. */
export async function getLeaveView(scope: Scope): Promise<LeaveView> {
  const empIds =
    scope.type === "all" ? undefined : scope.type === "self" ? [scope.employeeId] : scope.employeeIds;
  const year = new Date().getUTCFullYear();
  const [types, balances, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.leaveBalance.findMany({ where: { year, ...(empIds ? { employeeId: { in: empIds } } : {}) } }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ["PENDING", "APPROVED", "REJECTED"] }, ...(empIds ? { employeeId: { in: empIds } } : {}) },
      include: {
        employee: { select: { employeeNumber: true } },
        type: { select: { code: true, name: true, entitlementDays: true } },
      },
      orderBy: { from: "desc" },
      take: 50,
    }),
  ]);

  // For an EMPLOYEE scope, balances belong to themselves; for reports/all,
  // we show per-employee balances. The UI handles grouping.
  const usedByType = new Map<string, number>();
  for (const r of requests) {
    if (r.status === "APPROVED" || r.status === "PENDING") {
      usedByType.set(r.typeId, (usedByType.get(r.typeId) ?? 0) + r.days);
    }
  }

  return {
    types: types.map((t) => {
      const bal = balances.find((b) => b.typeId === t.id);
      const used = usedByType.get(t.id) ?? 0;
      const available = bal ? Math.max(0, bal.entitlement - used) : null;
      return { code: t.code, name: t.name, entitlement: bal?.entitlement ?? t.entitlementDays, used, available };
    }),
    year,
    requests: requests.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeNumber: r.employee.employeeNumber,
      typeCode: r.type.code,
      typeName: r.type.name,
      typeEntitlement: r.type.entitlementDays,
      from: r.from.toISOString().slice(0, 10),
      to: r.to.toISOString().slice(0, 10),
      days: r.days,
      reason: r.reason,
      status: r.status,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionComment: r.decisionComment,
    })),
  };
}

// ---------- Writes ----------

export async function createRequest(
  input: RequestLeaveShape,
  scope: Scope,
  actorId: string,
): Promise<{ notice: string | null }> {
  // Only an employee creates a request for themselves.
  if (scope.type !== "self") {
    throw Object.assign(new Error("employees only may create leave requests"), { code: "NOT_SELF" });
  }
  const employee = await prisma.employee.findUnique({ where: { id: scope.employeeId } });
  if (!employee) throw Object.assign(new Error("no employee record"), { code: "NOT_FOUND" });

  const { problems, notice } = await validateRequest(input, employee.id, {
    hireDate: employee.hireDate,
    terminatedAt: employee.terminatedAt,
  });
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "VALIDATION", problems });

  const type = await prisma.leaveType.findUniqueOrThrow({ where: { code: input.typeCode } });
  await prisma.leaveRequest.create({
    data: {
      id: ulid(),
      employeeId: employee.id,
      typeId: type.id,
      from: day0(input.from),
      to: day0(input.to),
      days: input.days,
      reason: input.reason,
      status: "PENDING",
    },
  });
  await writeAudit(actorId, "LeaveRequest", input.typeCode, "CREATE", undefined, { from: input.from, to: input.to, days: input.days }, employee.id);
  return { notice };
}

export async function cancelRequest(id: string, reason: string, scope: Scope, actorId: string) {
  const r = await loadRequest(id, scope);
  if (!r) throw Object.assign(new Error("request not found"), { code: "NOT_FOUND" });
  // Only the owner may cancel, and only while PENDING or (for APPROVED) before the from-date.
  if (scope.type !== "self" || scope.employeeId !== r.employeeId) {
    throw Object.assign(new Error("only the owner can cancel a leave request"), { code: "NOT_YOURS" });
  }
  const today = day0(iso(new Date()));
  if (r.status === "APPROVED" && r.from < today) {
    throw Object.assign(new Error("approved leave that has started cannot be cancelled"), { code: "BAD_STATE" });
  }
  if (r.status !== "PENDING" && r.status !== "APPROVED") {
    throw Object.assign(new Error("only pending or approved requests can be cancelled"), { code: "BAD_STATE" });
  }
  await prisma.leaveRequest.update({
    where: { id },
    data: { status: "CANCELLED", decisionComment: reason, decidedAt: new Date(), decidedBy: actorId },
  });
  await writeAudit(actorId, "LeaveRequest", id, "CANCEL", { status: r.status }, { status: "CANCELLED", reason }, r.employeeId);
}

/**
 * Approve or reject. MANAGER acts on their direct reports; HR on anything.
 * A MANAGER_THEN_HR chain requires the manager to delegate first — then HR decides.
 * REJECTED requires a comment.
 */
export async function decideRequest(
  id: string,
  decision: "APPROVED" | "REJECTED",
  comment: string | null,
  scope: Scope,
  actorId: string,
) {
  const r = await loadRequest(id, scope);
  if (!r) throw Object.assign(new Error("request not found"), { code: "NOT_FOUND" });
  if (scope.type === "self") throw Object.assign(new Error("employees cannot decide leave"), { code: "NO_PERMISSION" });
  if (scope.type === "reports" && !scope.employeeIds.includes(r.employeeId)) {
    throw Object.assign(new Error("request not found"), { code: "NOT_FOUND" }); // never 403
  }
  if (r.status !== "PENDING") throw Object.assign(new Error("only pending requests can be decided"), { code: "BAD_STATE" });
  if (decision === "REJECTED" && !comment?.trim()) {
    throw Object.assign(new Error("a comment is required to reject"), { code: "NEED_COMMENT" });
  }
  // MANAGER_THEN_HR: a MANAGER cannot approve, only HR can.
  if (r.typeCode === "UNPAID" && scope.type === "reports") {
    throw Object.assign(new Error("unpaid leave requires HR approval"), { code: "HR_ONLY" });
  }
  // Balance re-check at decision time (someone may have approved an overlapping
  // request between creation and now).
  if (decision === "APPROVED" && r.typeEntitlement != null) {
    const bal = await checkBalance(r.employeeId, (await prisma.leaveType.findUniqueOrThrow({ where: { code: r.typeCode } })).id, r.from.getUTCFullYear(), r.days);
    if (!bal.ok) {
      throw Object.assign(new Error("insufficient balance at decision time — reject or ask HR"), { code: "NO_BALANCE" });
    }
  }
  await prisma.leaveRequest.update({
    where: { id },
    data: { status: decision, decisionComment: comment, decidedAt: new Date(), decidedBy: actorId },
  });
  await writeAudit(actorId, "LeaveRequest", id, decision, { status: "PENDING" }, { status: decision, comment }, r.employeeId);
}