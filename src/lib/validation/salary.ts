import { z } from "zod";

export const createSalarySchema = z.object({
  // string or number, validated as ≤2 decimals by toMinor()
  baseMonthly: z.union([z.string(), z.number()]),
  effectiveFrom: z.coerce.date(),
  allowances: z.array(z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    amount: z.union([z.string(), z.number()]),
  })).optional(),
  standingDeductions: z.array(z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    amount: z.union([z.string(), z.number()]),
  })).optional(),
});

export const createBankSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().regex(/^[A-Za-z0-9]{6,20}$/, "6-20 letters/digits, no spaces"),
  accountHolderName: z.string().min(1),
  currency: z.string().length(3).optional(),
});

export type CreateSalaryBody = z.infer<typeof createSalarySchema>;
export type CreateBankBody = z.infer<typeof createBankSchema>;