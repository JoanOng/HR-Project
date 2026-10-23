/**
 * Employee domain logic. Route handlers validate input and call these;
 * these call Prisma and write audit rows. No HTTP types in here.
 */
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import type { Scope } from "@/lib/permissions";
import { writeAudit } from "./audit";
import type { CreateEmployeeInput, UpdateEmployeeInput } from "@/lib/validation/employee";

/**
 * Next number = max existing + 1, zero-padded to 4.
 * Counts SOFT-DELETED rows on purpose — a number, once issued, is never reused
 * (audit log references it, and HR paperwork does too).
 */
async function nextEmployeeNumber(): Promise<string> {
  const last = await prisma.employee.findFirst({
    orderBy: { employeeNumber: "desc" },
    select: { employeeNumber: true },
  });
  const n = last ? parseInt(last.employeeNumber.slice(4), 10) + 1 : 1;
  return `EMP-${String(n).padStart(4, "0")}`;
}

/**
 * Walk up the reporting chain from the proposed manager. If we reach the
 * employee being updated, the assignment would create a cycle (or a
 * self-report) and is rejected.
 */
async function wouldCreateCycle(employeeId: string, newManagerId: string): Promise<boolean> {
  let cursor: string | null = newManagerId;
  while (cursor) {
    if (cursor === employeeId) return true;
    const mgr: { reportToId: string | null } | null = await prisma.employee.findUnique({
      where: { id: cursor },
      select: { reportToId: true },
    });
    cursor = mgr?.reportToId ?? null;
  }
  return false;
}

const publicShape = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  maritalStatus: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  department: true,
  jobTitle: true,
  hireDate: true,
  workEmail: true,
  location: true,
  status: true,
  terminatedAt: true,
  reportTo: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
} as const;

export async function listEmployees(scope: Scope) {
  const where =
    scope.type === "all"
      ? { isDeletedAt: null }
      : scope.type === "self"
        ? { id: scope.employeeId, isDeletedAt: null }
        : { id: { in: scope.employeeIds }, isDeletedAt: null };

  return prisma.employee.findMany({
    where,
    select: publicShape,
    orderBy: { employeeNumber: "asc" },
  });
}

export async function getEmployee(id: string, scope: Scope) {
  // Out-of-scope ids behave exactly like nonexistent ones: 404, never 403.
  // That way Alice can't probe Bob's id and learn he exists.
  const ids =
    scope.type === "all" ? undefined
    : scope.type === "self" ? [scope.employeeId]
    : scope.employeeIds;

  return prisma.employee.findFirst({
    where: { id, isDeletedAt: null, ...(ids ? { id: { in: ids } } : {}) },
    select: publicShape,
  });
}

export async function createEmployee(input: CreateEmployeeInput, actorId: string) {
  if (input.reportToId) {
    const mgr = await prisma.employee.findUnique({
      where: { id: input.reportToId },
      select: { id: true },
    });
    if (!mgr) throw Object.assign(new Error("reportToId does not refer to an employee"), { code: "BAD_MANAGER" });
  }
  // email collision: the employee's email must also be free at the User level
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw Object.assign(new Error("email already registered"), { code: "EMAIL_TAKEN" });

  const employee = await prisma.employee.create({
    data: {
      id: ulid(),
      employeeNumber: await nextEmployeeNumber(),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone || null,
      dateOfBirth: input.dateOfBirth,
      department: input.department || null,
      jobTitle: input.jobTitle || null,
      hireDate: input.hireDate,
      status: input.status,
      reportToId: input.reportToId || null,
    },
  });

  await writeAudit(actorId, "Employee", employee.id, "CREATE", undefined, {
    firstName: employee.firstName,
    lastName: employee.lastName,
    status: employee.status,
    hireDate: employee.hireDate,
  }, employee.id);

  return employee;
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput, actorId: string) {
  const before = await prisma.employee.findFirst({ where: { id, isDeletedAt: null } });
  if (!before) return null;

  if (input.reportToId) {
    if (await wouldCreateCycle(before.id, input.reportToId)) {
      throw Object.assign(new Error("reportTo would create a reporting cycle"), { code: "CYCLE" });
    }
  }

  const after = await prisma.employee.update({
    where: { id: before.id },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone !== undefined ? input.phone || null : undefined,
      dateOfBirth: input.dateOfBirth,
      department: input.department !== undefined ? input.department || null : undefined,
      jobTitle: input.jobTitle !== undefined ? input.jobTitle || null : undefined,
      hireDate: input.hireDate,
      status: input.status,
      reportToId: input.reportToId !== undefined ? input.reportToId || null : undefined,
    },
  });

  // audit ONLY the fields that are policy-relevant: status + status-ish changes
  if (input.status !== undefined && input.status !== before.status) {
    await writeAudit(actorId, "Employee", before.id, "STATUS_CHANGE",
      { status: before.status, terminatedAt: before.terminatedAt },
      { status: after.status }, before.id);
  }

  return after;
}

/** Terminate = soft. The row stays (payroll history, audit refs); it just
 *  gets status TERMINATED + terminatedAt. */
export async function terminateEmployee(id: string, actorId: string) {
  const before = await prisma.employee.findFirst({ where: { id, isDeletedAt: null } });
  if (!before) return null;
  if (before.status === "TERMINATED") throw Object.assign(new Error("already terminated"), { code: "ALREADY_TERMINATED" });

  const after = await prisma.employee.update({
    where: { id: before.id },
    data: { status: "TERMINATED", terminatedAt: new Date() },
  });
  await writeAudit(actorId, "Employee", before.id, "TERMINATE",
    { status: before.status }, { status: "TERMINATED", terminatedAt: after.terminatedAt }, before.id);
  return after;
}