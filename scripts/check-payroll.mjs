import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const [cfg, sal, runs, idx] = await Promise.all([
  prisma.payrollConfig.findUnique({ where: { id: "app" } }),
  prisma.salaryRecord.count(),
  prisma.payrollRun.count(),
  prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='PayrollRun'`,
]);
console.log("payrollConfig:", cfg ? "present (version " + cfg.version + ")" : "MISSING");
console.log("salaryRecords:", sal);   // expect 3
console.log("payrollRuns:", runs);    // expect 0
console.log("indexes:", idx.map(i => i.name));
// expect ONLY: "PayrollRun_year_month_activeRun_idx"? No — expect "PayrollRun_one_active_per_month" and NO
// "PayrollRun_year_month_activeRun_key"