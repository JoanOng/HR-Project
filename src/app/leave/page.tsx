import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getLeaveView } from "@/modules/leave/service";
import { LeaveActions } from "./leave-actions";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leave — HR" };

const statusStyle: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export default async function LeavePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scope = await scopeFor(user);
  const { types, year, requests } = await getLeaveView(scope);
  const isManager = user.role === "MANAGER" || user.role === "HR";

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Leave
          <span className="ml-2 text-sm font-normal text-zinc-500">
            signed in as {user.email} ({user.role})
          </span>
        </h1>
        <div className="flex gap-2">
          <Link href="/employees" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Employees
          </Link>
          <Link href="/timesheets" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Timesheets
          </Link>
          <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Payroll
          </Link>
          <LogoutButton />
        </div>
      </div>

      {/* balances */}
      <div className="mb-6 flex flex-wrap gap-4">
        {types.map((t) => (
          <div key={t.code} className="rounded border border-zinc-200 bg-zinc-50 px-4 py-2">
            <div className="text-xs text-zinc-500">{t.name}</div>
            <div className="text-lg font-semibold">
              {t.entitlement == null ? "unlimited" : `${t.available} left`}
              {t.entitlement != null && (
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  of {t.entitlement} {year}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* new request — employees only; HR/manager act on the queue */}
        <LeaveActions
          canRequest={user.role === "EMPLOYEE"}
          canDecide={isManager}
          types={types}
          requests={requests}
        />

        {/* history / queue */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left text-zinc-600">
              {isManager && <th className="py-2 pr-4">Employee</th>}
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">From</th>
              <th className="py-2 pr-4">To</th>
              <th className="py-2 pr-4">Days</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Comment</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-zinc-200 hover:bg-zinc-50">
                {isManager && (
                  <td className="py-2 pr-4">
                    <span className="font-mono">{r.employeeNumber}</span>
                  </td>
                )}
                <td className="py-2 pr-4">{r.typeName}</td>
                <td className="py-2 pr-4 font-mono">{r.from.slice(0, 10)}</td>
                <td className="py-2 pr-4 font-mono">{r.to.slice(0, 10)}</td>
                <td className="py-2 pr-4 font-mono">{r.days}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 ${statusStyle[r.status]}`}>{r.status}</span>
                </td>
                <td className="max-w-[16rem] truncate py-2 pr-4 text-zinc-500" title={r.reason ?? ""}>
                  {r.decisionComment ?? r.reason ?? "—"}
                </td>
                <td className="py-2 text-right">
                  {isManager && r.status === "PENDING" ? (
                    <span className="text-xs text-amber-700">pending review</span>
                  ) : r.status === "APPROVED" && r.from.slice(0, 10) > new Date().toISOString().slice(0, 10) ? (
                    <span className="text-xs text-zinc-400">cancellable</span>
                  ) : (
                    <span className="text-xs text-zinc-300">—</span>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={isManager ? 8 : 7} className="py-6 text-center text-zinc-500">
                  No leave requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}