import { z } from "zod";

// One half-month of entries, exactly as the grid sees it.
// hours: { [isoDay: string]: decimal } — 0.5 increments, 0 allowed (clears).
export type EntryShape = {
  projectId: string | null; // null = non-project row
  workCategory: string | null; // e.g. "LEAVE", "TRAINING" — set iff projectId null
  comment: string | null;
  hours: Record<string, number>;
};

export const entrySchema = z.object({
  projectId: z.string().min(1).nullable(),
  workCategory: z
    .string()
    .min(1)
    .max(20)
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null)),
  comment: z.string().max(500).nullable(),
  hours: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.union([z.literal(0), z.number().nonnegative().multipleOf(0.5)]),
  ),
});

export const savePeriodSchema = z.object({
  entries: z.array(entrySchema),
});

export const withdrawSchema = z.object({
  reason: z.string().min(1, "A reason is required to withdraw a submission").max(500),
});

export const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(500).nullable(),
});