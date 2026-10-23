import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getPeriodView } from "@/modules/timesheet/service";
import { prisma } from "@/prisma/client";
import { GridWithSuspense } from "./grid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheet — HR" };

export default async function TimesheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const view = await getPeriodView(id, await scopeFor(user));
  if (!view) notFound();

  const cfgRow = await prisma.appConfig.findUnique({ where: { id: "app" } });

  return (
    <main className="flex-1 px-8 py-6">
      <GridWithSuspense
        period={{
          id: view.period.id,
          employeeNumber: view.period.employeeNumber,
          start: view.period.start,
          end: view.period.end,
          status: view.period.status,
        }}
        days={view.days}
        weekends={view.weekends}
        holidays={view.holidays}
        projects={view.projects}
        entries={view.entries}
        cfg={
          cfgRow
            ? {
                maxHoursPerDay: cfgRow.maxHoursPerDay,
                standardDailyHours: cfgRow.standardDailyHours,
                maxOvertimePerDay: cfgRow.maxOvertimePerDay,
                maxHoursPerPeriod: cfgRow.maxHoursPerPeriod,
                allowEmptySubmit: cfgRow.allowEmptySubmit,
              }
            : null
        }
        leaveDays={
          await prisma.leaveRequest.findMany({
            where: {
              employeeId: view.period.employeeId,
              status: "APPROVED",
              from: { lte: new Date(`${view.period.end}T23:59:59Z`) },
              to: { gte: new Date(`${view.period.start}T00:00:00Z`) },
            },
            select: { from: true, to: true, days: true },
          })
        }
      />
    </main>
  );
}