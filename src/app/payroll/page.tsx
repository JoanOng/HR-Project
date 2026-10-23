import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listRuns } from "@/modules/payroll/service";
import { RunActions } from "./run-actions";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll — HR" };

const statusStyle: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700",
  COMPLETED: "bg-blue-100 text-blue-800",
  PUBLISHED: "bg-green-100 text-green-700",
  VOIDED: "bg-red-100 text-red-700",
};

export default async function PayrollPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isHr = user.role === "HR";
  const runs = isHr ? await listRuns() : [];

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Payroll
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
          <Link href="/leave" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Leave
          </Link>
          <LogoutButton />
        </div>
      </div>

      {isHr ? (
        <>
          <RunActions
            runs={runs.map((r) => ({ ...r, isSelfPrepared: r.preparedById === user.id }))}
          />
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Employees</th>
                <th className="py-2 pr-4">Completed</th>
                <th className="py-2 pr-4">Published</th>
                <th className="py-2 pr-4">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-zinc-200 hover:bg-zinc-50">
                  <td className="py-2 pr-4 font-mono">
                    {r.year}-{String(r.month).padStart(2, "0")}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded px-2 py-0.5 ${statusStyle[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="py-2 pr-4">{r.employeeCount}</td>
                  <td className="py-2 pr-4 font-mono">{r.completedAt?.slice(0, 10) ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono">{r.publishedAt?.slice(0, 10) ?? "—"}</td>
                  <td className="max-w-[16rem] truncate py-2 pr-4 text-zinc-500" title={r.note ?? r.voidReason ?? ""}>
                    {(r.status === "VOIDED" ? r.voidReason : r.note) ?? "—"}
                  </td>
                  <td className="py-2 text-right">
                    <Link href={`/payroll/runs/${r.id}`} className="text-blue-600 hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">
                    No payroll runs yet. Create one for a fully-past month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <div className="mt-6 rounded border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">
            Payroll runs are managed by HR. You can see your own payslips once they are published.
          </p>
          {user.role === "EMPLOYEE" && (
            <p className="mt-2 text-xs text-zinc-500">
              Payslips appear here after each month is published.
            </p>
          )}
        </div>
      )}
    </main>
  );
}