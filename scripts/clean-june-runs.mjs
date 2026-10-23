import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Dev-only cleanup: delete all June 2026 payroll runs.
// Their payslips and lines are removed automatically (onDelete: Cascade).
const r = await prisma.payrollRun.deleteMany({ where: { year: 2026, month: 6 } });
console.log(`Deleted ${r.count} June 2026 run(s).`);
await prisma.$disconnect();