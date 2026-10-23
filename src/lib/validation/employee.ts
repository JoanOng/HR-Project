import { z } from "zod";

export const employmentStatuses = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.email(),
  phone: z.string().max(30).optional().or(z.literal("")),
  dateOfBirth: z.coerce.date().optional(),
  department: z.string().max(100).optional().or(z.literal("")),
  jobTitle: z.string().max(100).optional().or(z.literal("")),
  hireDate: z.coerce.date(),
  reportToId: z.string().optional().or(z.literal("")),
  status: z.enum(employmentStatuses).default("FULL_TIME"),
});

export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;