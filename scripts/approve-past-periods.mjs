// One-time data fix: mark every fully-past period (end before today) as APPROVED.
// Future/current periods are left alone. Re-running is safe (no-op if nothing past remains).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const past = await prisma.timesheetPeriod.findMany({
  where: { end: { lt: today }, status: { not: "APPROVED" } },
});

await prisma.timesheetPeriod.updateMany({
  where: { id: { in: past.map((p) => p.id) } },
  data: {
    status: "APPROVED",
    reviewedAt: new Date(),
    reviewComment: "Backfilled — pre-launch periods",
  },
});

console.log(`${past.length} past period(s) set to APPROVED`);
await prisma.$disconnect();