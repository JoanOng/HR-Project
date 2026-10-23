/**
 * Salary — effective-dated chain, integer minor units only.
 * Money comes in as a number with ≤2 decimals (5000.50) and is stored
 * as 500050. No floats ever reach the database.
 */
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import { writeAudit } from "./audit";

/** "5000" or "5000.50" → 500000. Rejects more than 2 decimals and negatives. */
export function toMinor(input: unknown): number {
  if (typeof input !== "number" && typeof input !== "string") {
    throw Object.assign(new Error("amount must be a number"), { code: "BAD_AMOUNT" });
  }
  const s = String(input).trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw Object.assign(new Error("amount must have at most 2 decimal places"), { code: "BAD_AMOUNT" });
  return parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0);
}

export interface SalaryLineInput {
  code: string;
  name: string;
  amount: unknown; // major units, ≤2 decimals
}

export interface CreateSalaryInput {
  baseMonthly: unknown;
  effectiveFrom: Date;
  allowances?: SalaryLineInput[];
  standingDeductions?: SalaryLineInput[];
}

function linesMinor(lines: SalaryLineInput[] | undefined): { code: string; name: string; amount: number }[] | null {
  if (!lines || lines.length === 0) return null;
  return lines.map((l) => ({ code: l.code, name: l.name, amount: toMinor(l.amount) }));
}

/**
 * Create a new salary record and close the one it replaces.
 * The "current" record is the one with effectiveTo = null; creating a record
 * whose effectiveFrom is ON or AFTER the current record's effectiveFrom closes
 * the current one (its effectiveTo becomes the new record's effectiveFrom).
 */
export async function createSalaryRecord(employeeId: string, input: CreateSalaryInput, actorId: string) {
  const base = toMinor(input.baseMonthly);
  const allowances = linesMinor(input.allowances);
  const standingDeductions = linesMinor(input.standingDeductions);

  // Only the DB changes live inside the transaction — the audit row is
  // written after commit, so a slow dev compile can't blow the tx budget.
  const { record, previous } = await prisma.$transaction(
    async (tx) => {
      // find the record in force at effectiveFrom: effectiveFrom <= t, effectiveTo null or > t
      const current = await tx.salaryRecord.findFirst({
        where: {
          employeeId,
          effectiveFrom: { lte: input.effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveFrom } }],
        },
      });

      // a record already covering that exact date → refuse
      if (current && current.effectiveFrom.getTime() === input.effectiveFrom.getTime()) {
        throw Object.assign(new Error("a salary record already starts on this date"), { code: "SALARY_EXISTS" });
      }

      // close the record it replaces
      if (current) {
        await tx.salaryRecord.update({
          where: { id: current.id },
          data: { effectiveTo: input.effectiveFrom },
        });
      }

      const record = await tx.salaryRecord.create({
        data: {
          id: ulid(),
          employeeId,
          baseMonthly: base,
          allowances: (allowances ?? undefined) as never,
          standingDeductions: (standingDeductions ?? undefined) as never,
          effectiveFrom: input.effectiveFrom,
        },
      });

      return { record, previous: current };
    },
    { timeout: 15000 },
  );

  await writeAudit(actorId, "SalaryRecord", record.id, "SALARY_CREATE",
    previous ? { id: previous.id, baseMonthly: previous.baseMonthly } : undefined,
    { id: record.id, baseMonthly: record.baseMonthly, effectiveFrom: record.effectiveFrom },
    employeeId);

  return record;
}

/** Full history, newest first. Money comes back as MINOR UNITS — display code converts. */
export async function listSalaryHistory(employeeId: string) {
  return prisma.salaryRecord.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
  });
}