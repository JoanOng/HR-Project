// // Assigns timesheet periods for every half-month boundary up to (and
// // including) today, to every employee who was employed in that range.
// // Idempotent — run whenever; it only fills in missing periods.
// //   node scripts/assign-periods.mjs
// import { PrismaClient } from "@prisma/client";
// import { ulid } from "ulid";

// const prisma = new PrismaClient();

// const day = (iso) => new Date(`${iso}T00:00:00Z`);
// const iso = (d) => d.toISOString().slice(0, 10);

// // Which half-month does date d fall in? -> [start, end] inclusive
// function halfMonthOf(d) {
//   const y = d.getUTCFullYear();
//   const m = d.getUTCMonth();
//   if (d.getUTCDate() <= 15) {
//     return [
//       day(iso(new Date(Date.UTC(y, m, 1)))),
//       day(iso(new Date(Date.UTC(y, m, 15)))),
//     ];
//   }
//   const last = iso(new Date(Date.UTC(y, m + 1, 0))); // 0th of next month
//   return [
//     day(iso(new Date(Date.UTC(y, m, 16)))),
//     day(last),
//   ];
// }

// async function main() {
//   const today = day(iso(new Date()));
//   const from = day(iso(new Date(Date.now() - 90 * 86400000))); // backfill window

//   const employees = await prisma.employee.findMany({
//     where: { isDeletedAt: null },
//     orderBy: { id: "asc" },
//   });

//   // Collect every half-month range that overlaps [from, today]
//   const ranges = [];
//   let d = new Date(from);
//   while (d <= today) {
//     const [start, end] = halfMonthOf(d);
//     ranges.push([start, end]);
//     // hop to the start of the next half-month
//     const sIso = iso(start);
//     const sy = Number(sIso.slice(0, 4));
//     const sm = Number(sIso.slice(5, 7)) - 1;
//     d =
//       sIso.slice(8, 10) === "01"
//         ? new Date(Date.UTC(sy, sm + 1, 1))
//         : new Date(Date.UTC(sy, sm + 1, 16));
//   }

//   let created = 0;
//   for (const emp of employees) {
//     for (const [start, end] of ranges) {
//       // was the employee employed during any of this range?
//       if (emp.hireDate > end || (emp.terminatedAt && emp.terminatedAt < start))
//         continue;
//       const exists = await prisma.timesheetPeriod.findUnique({
//         where: { employeeId_start: { employeeId: emp.id, start } },
//       });
//       if (exists) continue;
//       // mid-period exit shortens the period; join dates earlier than the
//       // start don't lengthen it (the period boundary wins)
//       const realEnd =
//         emp.terminatedAt && emp.terminatedAt < end ? emp.terminatedAt : end;
//       await prisma.timesheetPeriod.create({
//         data: { id: ulid(), employeeId: emp.id, start, end: realEnd },
//       });
//       created++;
//     }
//   }
//   console.log(`assign-periods: ${created} period(s) created`);
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(() => prisma.$disconnect());
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