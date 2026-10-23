import { prisma } from "@/prisma/client";
import { ulid } from "ulid";

export async function writeAudit(
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
  employeeIdRef?: string,
) {
  await prisma.auditLog.create({
    data: {
      id: ulid(),
      actorId,
      entity,
      entityId,
      action,
      before: before as never,
      after: after as never,
      employeeIdRef,
    },
  });
}