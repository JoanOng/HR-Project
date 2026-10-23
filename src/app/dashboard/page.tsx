import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { prisma } from "@/prisma/client";
import { getCurrentPeriod, pendingTimesheets } from "@/modules/timesheet/service";
import { getLeaveView } from "@/modules/leave/service";
import { listOwnPayslips, listRuns } from "@/modules/payroll/service";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const money = (sen: number) =>
  (sen / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tsStatusStyle: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700",
  SUBMITTED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

function Card({ title, children, link }: { title: string; children: React.ReactNode; link?: string }) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {link && (
          <Link href={link} className="text-xs text-blue-600 hover:underline">
            View all →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scope = await scopeFor(user);
  const employee =
    scope.type !== "all"
      ? await prisma.employee.findFirst({ where: { id: scope.type === "self" ? scope.employeeId : undefined }, include: { _count: { select: { reports: true } } } })
      : null;
  const ownId = scope.type === "self" ? scope.employeeId : null;

  const [period, payslips, leave, pendingTs, runs] = await Promise.all([
    getCurrentPeriod(scope),
    ownId ? listOwnPayslips(ownId) : [],
    getLeaveView(scope),
    scope.type !== "self" ? pendingTimesheets(scope, scope.type === "reports" && employee ? employee.id : undefined) : [],
    user.role === "HR" ? listRuns() : [],
  ]);

  const pendingLeave = leave.requests.filter((r) => r.status === "PENDING" && (ownId ? r.employeeId === ownId : r.employeeId !== employee?.id));

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Dashboard
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {employee ? `${employee.firstName} ${employee.lastName} (${employee.employeeNumber}) · ` : ""}
            {user.role}
          </span>
        </h1>
        <div className="flex gap-2">
          <Link href="/timesheets" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">Timesheets</Link>
          <Link href="/leave" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">Leave</Link>
          {user.role === "HR" && (
            <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">Payroll</Link>
          )}
          <LogoutButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* This half-month */}
        <Card title="This half-month" link={period ? `/timesheets/${period.id}` : "/timesheets"}>
          {period ? (
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono">{period.start} → {period.end}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${tsStatusStyle[period.status]}`}>{period.status}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {period.entryCount} of {period.days} days logged.
                {period.status === "DRAFT" && " Submit when all days are entered."}
                {period.status === "SUBMITTED" && " Waiting for your manager."}
                {period.status === "REJECTED" && " Manager sent it back — edit and resubmit."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No timesheet period for this half-month yet.</p>
          )}
        </Card>

        {/* Leave balances */}
        <Card title={`Leave balance ${leave.year}`} link="/leave">
          <table className="w-full text-sm">
            <tbody>
              {leave.types.map((t) => (
                <tr key={t.code} className="border-b border-zinc-100 last:border-0">
                  <td className="py-1.5">{t.name}</td>
                  <td className="py-1.5 text-right font-mono">
                    {t.available == null ? "∞" : `${t.available} / ${t.entitlement}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pendingLeave.length > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              {pendingLeave.length} pending request{pendingLeave.length > 1 ? "s" : ""} awaiting decision.
            </p>
          )}
        </Card>

        {/* Awaiting your action — managers and HR only */}
        {scope.type !== "self" && (
          <Card title="Awaiting your action">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-2xl font-semibold">{pendingLeave.length}</div>
                <div className="text-xs text-zinc-500">leave requests</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{pendingTs.length}</div>
                <div className="text-xs text-zinc-500">timesheets submitted</div>
              </div>
            </div>
            {(pendingLeave.length > 0 || pendingTs.length > 0) && (
              <div className="mt-3 flex gap-3 text-xs">
                {pendingLeave.length > 0 && <Link href="/leave" className="text-blue-600 hover:underline">Review leave →</Link>}
                {pendingTs.length > 0 && <Link href="/timesheets" className="text-blue-600 hover:underline">Review timesheets →</Link>}
              </div>
            )}
            {pendingLeave.length === 0 && pendingTs.length === 0 && (
              <p className="mt-3 text-xs text-zinc-500">Nothing waiting — all caught up.</p>
            )}
          </Card>
        )}

        {/* My payslips */}
        {ownId && (
          <Card title="My payslips">
            {payslips.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-left text-xs text-zinc-600">
                    <th className="py-1.5">Month</th>
                    <th className="py-1.5 text-right">Gross</th>
                    <th className="py-1.5 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.slice(0, 6).map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-1.5 font-mono">
                        <Link href={`/payroll/payslips/${p.id}`} className="text-blue-600 hover:underline">
                          {p.year}-{String(p.month).padStart(2, "0")}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right font-mono">{money(p.gross)}</td>
                      <td className="py-1.5 text-right font-mono font-semibold">{money(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-zinc-500">No published payslips yet — they appear after each month is published by HR.</p>
            )}
          </Card>
        )}

        {/* HR: payroll run summary */}
        {user.role === "HR" && (
          <Card title="Payroll runs" link="/payroll">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-2xl font-semibold">{runs.filter((r) => r.status === "DRAFT").length}</div>
                <div className="text-xs text-zinc-500">draft</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{runs.filter((r) => r.status === "COMPLETED").length}</div>
                <div className="text-xs text-zinc-500">completed — to publish</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{runs.filter((r) => r.status === "PUBLISHED").length}</div>
                <div className="text-xs text-zinc-500">published</div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}