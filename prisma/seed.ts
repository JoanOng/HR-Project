/**
 * Dev seed — creates one user per role plus a tiny reporting tree.
 * Run: npx prisma db seed
 * Idempotent: safe to run repeatedly (upserts on email / employeeNumber).
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { ulid } from "ulid";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Password123!"; // dev only

type SeedUser = {
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "HR";
  employee?: {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    reportToNumber?: string;
    hireDate: string;
    department: string;
    jobTitle: string;
  };
};

const SEED: SeedUser[] = [
  { email: "hr@example.com", role: "HR" },
  { email: "hr2@example.com", role: "HR" },
  {
    email: "manager@example.com",
    role: "MANAGER",
    employee: {
      employeeNumber: "EMP-0001",
      firstName: "Morgan",
      lastName: "Lead",
      hireDate: "2023-01-02",
      department: "Engineering",
      jobTitle: "Engineering Manager",
    },
  },
  {
    email: "alice@example.com",
    role: "EMPLOYEE",
    employee: {
      employeeNumber: "EMP-0002",
      firstName: "Alice",
      lastName: "Tan",
      reportToNumber: "EMP-0001",
      hireDate: "2024-03-01",
      department: "Engineering",
      jobTitle: "Software Engineer",
    },
  },
  {
    email: "bob@example.com",
    role: "EMPLOYEE",
    employee: {
      employeeNumber: "EMP-0003",
      firstName: "Bob",
      lastName: "Ng",
      reportToNumber: "EMP-0001",
      hireDate: "2024-09-15",
      department: "Engineering",
      jobTitle: "Software Engineer",
    },
  },
];

const day0 = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function main() {
  const passwordHash = await hash(DEV_PASSWORD, 10);

  for (const s of SEED) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { id: ulid(), email: s.email, passwordHash, role: s.role },
    });

    if (!s.employee) continue;
    const e = s.employee;
    const reportTo = e.reportToNumber
      ? await prisma.employee.findUnique({
          where: { employeeNumber: e.reportToNumber },
        })
      : null;

    await prisma.employee.upsert({
      where: { employeeNumber: e.employeeNumber },
      update: {},
      create: {
        id: ulid(),
        userId: user.id,
        employeeNumber: e.employeeNumber,
        firstName: e.firstName,
        lastName: e.lastName,
        email: s.email,
        hireDate: new Date(e.hireDate),
        department: e.department,
        jobTitle: e.jobTitle,
        reportToId: reportTo?.id ?? null,
        status: "FULL_TIME",
      },
    });
  }

  // ---- M2: project codes ----
  for (const p of [
    { code: "PRJ-001", name: "Website Redesign" },
    { code: "PRJ-002", name: "Mobile App" },
  ]) {
    await prisma.project.upsert({
      where: { code: p.code },
      update: {},
      create: { id: ulid(), code: p.code, name: p.name },
    });
  }

  // ---- M2: app config (one row, country drives the holiday calendar) ----
  const COUNTRY = process.env.COUNTRY ?? "SG";
  await prisma.appConfig.upsert({
      where: { id: "app" },
      update: { country: COUNTRY },
      create: { id: "app", country: COUNTRY }, // other fields = §3.5.3 defaults
    });

    // ---- M2: public holidays for COUNTRY ----
    // EMPTY by design: statutory dates are country/company facts and must come
    // from the official list, never be guessed. Fill this with the real
    // holidays for COUNTRY, or manage them later in the HR settings screen.
    const HOLIDAYS: { date: string; name: string }[] = [
      // e.g. { date: "2026-05-01", name: "Labour Day" },
    ];
    for (const h of HOLIDAYS) {
      await prisma.holiday.upsert({
        where: {
          country_date: { country: COUNTRY, date: day0(h.date) },
        },
        update: {},
        create: { id: ulid(), country: COUNTRY, date: day0(h.date), name: h.name },
      });
    }

    // ---- M3: leave types (placeholder entitlements — confirm with company) ----
    type LeaveTypeSeed = {
      code: string;
      name: string;
      entitlementDays: number | null;
      maxConsecutiveDays: number | null;
      minNoticeDays: number;
      approvalChain: "MANAGER" | "MANAGER_THEN_HR";
      allowCancellation: boolean;
    };

    for (const t of [
      { code: "ANNUAL", name: "Annual Leave", entitlementDays: 14, maxConsecutiveDays: 14, minNoticeDays: 14, approvalChain: "MANAGER", allowCancellation: true },
      { code: "SICK", name: "Sick Leave", entitlementDays: 20, maxConsecutiveDays: null, minNoticeDays: 0, approvalChain: "MANAGER", allowCancellation: true },
      { code: "UNPAID", name: "Unpaid Leave", entitlementDays: null, maxConsecutiveDays: null, minNoticeDays: 0, approvalChain: "MANAGER_THEN_HR", allowCancellation: true },
    ] satisfies LeaveTypeSeed[]) {
      await prisma.leaveType.upsert({
        where: { code: t.code },
        update: {}, // don't overwrite live config on re-seed
        create: { id: ulid(), code: t.code, name: t.name, entitlementDays: t.entitlementDays, maxConsecutiveDays: t.maxConsecutiveDays, minNoticeDays: t.minNoticeDays, approvalChain: t.approvalChain, allowCancellation: t.allowCancellation },
      });
    }

    // ---- M3: current-year balances (no accrual — fixed per year, resets Jan 1) ----
    // On-join pro-ration: entitlement × remaining months / 12, rounded UP to the
    // next 0.5. Joined in an earlier year → full entitlement.
    const year = new Date().getUTCFullYear();
    const types = await prisma.leaveType.findMany({ where: { isActive: true } });
    const employees = await prisma.employee.findMany({
      where: { status: { not: "TERMINATED" }, isDeletedAt: null },
    });
    for (const e of employees) {
      for (const t of types) {
        if (t.entitlementDays == null) continue; // UNPAID has no balance row
        let entitlement = t.entitlementDays;
        const hire = new Date(e.hireDate);
        if (hire.getUTCFullYear() === year) {
          const monthsLeft =
            12 - hire.getUTCMonth() + 1; // hire month counts as a full month
          entitlement = Math.ceil((t.entitlementDays * monthsLeft) / 12 * 2) / 2;
        }
        await prisma.leaveBalance.upsert({
          where: { employeeId_typeId_year: { employeeId: e.id, typeId: t.id, year } },
          update: {}, // entitlement is fixed once the year starts — never overwritten
          create: { id: ulid(), employeeId: e.id, typeId: t.id, year, entitlement },
        });
      }
    }

    // ---- M4: payroll config (DEMO values — confirm with company) ----
    const payCfg = await prisma.payrollConfig.findUnique({ where: { id: "app" } });
    if (!payCfg) {
      await prisma.payrollConfig.create({
        data: {
          id: "app",
          version: 1,
          // DEMO progressive monthly bands, minor units, percent rates.
          taxBands: [
            { min: 0, max: 500000, rate: 0 },      // first 5,000.00 tax-free
            { min: 500000, max: 2000000, rate: 3 }, // next 1,500.00 @ 3%
            { min: 2000000, max: 5000000, rate: 8 }, // next 3,000.00 @ 8%
            { min: 5000000, max: null, rate: 14 },  // above 5,000.00 @ 14%
          ],
          contributions: [
            { code: "EPF", name: "Provident fund", who: "BOTH", rate: 11, base: "BASE", capPerMonth: null },
          ],
        },
      });
    }

    // ---- M2: assign the current half-month timesheet to every active employee ----
    // Idempotent — the @@unique([employeeId, start]) prevents duplicates.
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const dom = now.getUTCDate();
    const [start, end] =
      dom <= 15
        ? [day0(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)),
          day0(new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 10))]
        : [
            day0(new Date(Date.UTC(y, m, 16)).toISOString().slice(0, 10)),
            day0(new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)), // last day of month
          ];
    const active = await prisma.employee.findMany({
      where: { status: { not: "TERMINATED" }, isDeletedAt: null },
    });
    for (const e of active) {
      await prisma.timesheetPeriod.upsert({
        where: { employeeId_start: { employeeId: e.id, start } },
        update: {},
        create: { id: ulid(), employeeId: e.id, start, end },
      });
    }

    // ---- M4: salary records (DEMO amounts in sen — replace with real ones) ----
    for (const s of [
      { number: "EMP-0001", base: 600000, allowances: [] },
      { number: "EMP-0002", base: 450000, allowances: [{ code: "HOUSE", name: "Housing allowance", amount: 100000 }] },
      { number: "EMP-0003", base: 400000, allowances: [] },
    ]) {
      const emp = await prisma.employee.findUnique({ where: { employeeNumber: s.number } });
      if (!emp) continue;
      const existing = await prisma.salaryRecord.findFirst({ where: { employeeId: emp.id } });
      if (existing) continue; // don't overwrite live salary on re-seed
      await prisma.salaryRecord.create({
        data: {
          id: ulid(),
          employeeId: emp.id,
          baseMonthly: s.base,
          allowances: s.allowances,
          standingDeductions: [],
          effectiveFrom: new Date("2023-01-01T00:00:00.000Z"),
          effectiveTo: null,
        },
      });
    }

  
  console.log(
    `Seeded ${SEED.length} users. Dev password for all: ${DEV_PASSWORD}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());