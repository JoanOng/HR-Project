// zod 4 — shared client/server validation for leave requests.
import { z } from "zod";

export const requestLeaveSchema = z.object({
  typeCode: z.enum(["ANNUAL", "SICK", "UNPAID"]),
  // "YYYY-MM-DD" — inclusive. Half-day precision comes from the `days` field:
  // a same-day request with days = 0.5 is a half day.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().nonnegative().multipleOf(0.5),
  reason: z.string().min(1).max(1000),
});

export const decideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(1000).nullable().optional(),
});

export const cancelSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type RequestLeaveShape = z.infer<typeof requestLeaveSchema>;