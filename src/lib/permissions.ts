/**
 * Role → scope. Every employee-data query MUST go through this.
 *   EMPLOYEE → own record only
 *   MANAGER  → their direct reports (one level of reportTo) + self
 *   HR       → everything
 */
import type { User } from "@prisma/client";
import { prisma } from "@/prisma/client";

export type Scope =
  | { type: "self"; employeeId: string }
  | { type: "reports"; employeeIds: string[] }
  | { type: "all" };

/**
 * The caller must be an account linked to an Employee record for
 * self/report scoping. An unlinked manager/HR falls back to "all"
 * only for HR; a manager with no employee record gets an empty scope.
 */
export async function scopeFor(user: User): Promise<Scope> {
  if (user.role === "HR") return { type: "all" };

  const employee = await prisma.employee.findFirst({
    where: { userId: user.id, isDeletedAt: null },
    include: { reports: { where: { isDeletedAt: null } } },
  });

  if (user.role === "MANAGER") {
    if (!employee) return { type: "reports", employeeIds: [] };
    return {
      type: "reports",
      employeeIds: [employee.id, ...employee.reports.map((r) => r.id)],
    };
  }

  // EMPLOYEE
  if (!employee) return { type: "self", employeeId: "" }; // matches nothing
  return { type: "self", employeeId: employee.id };
}

/** Convert a scope into a Prisma `where` fragment for employee queries. */
export function scopeWhere(scope: Scope): Record<string, unknown> {
  switch (scope.type) {
    case "all":
      return {};
    case "self":
      return { id: scope.employeeId };
    case "reports":
      return { id: { in: scope.employeeIds } };
  }
}