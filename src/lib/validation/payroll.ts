import { z } from "zod";

export const createRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  note: z.string().max(1000).optional(),
  oneOffs: z
    .array(
      z.object({
        employeeId: z.string(),
        code: z.string().max(40),
        name: z.string().max(100),
        amount: z.number().int().min(0),
      }),
    )
    .optional(),
});

export const voidSchema = z.object({
  reason: z.string().min(1).max(1000),
});