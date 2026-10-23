import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { listPeriods } from "@/modules/timesheet/service";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets — HR" };

const statusStyle: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700",
  SUBMITTED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default async function TimesheetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scope = await scopeFor(user);
  const { periods, cfg } = await listPeriods(scope);
  const showEmployee = user.role !== "EMPLOYEE"; // employees only have their own

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Timesheets
          <span className="ml-2 text-sm font-normal text-zinc-500">
            signed in as {user.email} ({user.role})
          </span>
        </h1>
        <div className="flex gap-2">
          <Link href="/employees" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Employees
          </Link>
          <Link href="/leave" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Leave
          </Link>
          <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Payroll
          </Link>
          <Link href="/dashboard" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Dashboard
          </Link>          
          <LogoutButton />
        </div>
      </div>

      {cfg && (
        <p className="mb-3 text-xs text-zinc-500">
          Rules: max {cfg.maxHoursPerDay}h/day · {cfg.standardDailyHours}h standard · OT cap{" "}
          {cfg.maxOvertimePerDay}h/day · {cfg.maxHoursPerPeriod}h per half-month ·{" "}
          {cfg.allowEmptySubmit ? "empty submission allowed" : "empty submission NOT allowed"}
        </p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-zinc-600">
            {showEmployee && <th className="py-2 pr-4">Employee</th>}
            <th className="py-2 pr-4">Period</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-b border-zinc-200 hover:bg-zinc-50">
              {showEmployee && (
                <td className="py-2 pr-4">
                  <span className="font-mono">{p.employeeNumber}</span>{" "}
                  {p.employeeName}
                </td>
              )}
              <td className="py-2 pr-4 font-mono">
                {p.start} → {p.end}
              </td>
              <td className="py-2 pr-4">
                <span className={`rounded px-2 py-0.5 ${statusStyle[p.status] ?? "bg-zinc-100"}`}>
                  {p.status}
                </span>
              </td>
              <td className="py-2 text-right">
                <Link href={`/timesheets/${p.id}`} className="text-blue-600 hover:underline">
                  {user.role === "EMPLOYEE" ? "Open" : "Review"}
                </Link>
              </td>
            </tr>
          ))}
          {periods.length === 0 && (
            <tr>
              <td colSpan={showEmployee ? 4 : 3} className="py-6 text-center text-zinc-500">
                No timesheets in your scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}