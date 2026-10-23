import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { listEmployees } from "@/modules/employee/service";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employees — HR" };

export default async function EmployeesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scope = await scopeFor(user);
  const rows = await listEmployees(scope);

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Employees
          <span className="ml-2 text-sm font-normal text-zinc-500">
            signed in as {user.email} ({user.role})
          </span>
        </h1>
        <div className="flex gap-2">
          <Link href="/timesheets" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Timesheets
          </Link>

          <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Payroll
          </Link>
          
          <Link href="/dashboard" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Dashboard
          </Link>

          {user.role === "HR" && (
            <Link href="/employees/new" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
              + New employee
            </Link>
          )}
          <LogoutButton />
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-zinc-600">
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Department</th>
            <th className="py-2 pr-4">Job title</th>
            <th className="py-2 pr-4">Manager</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-zinc-200 hover:bg-zinc-50">
              <td className="py-2 pr-4 font-mono">{e.employeeNumber}</td>
              <td className="py-2 pr-4">{e.firstName} {e.lastName}</td>
              <td className="py-2 pr-4">{e.email}</td>
              <td className="py-2 pr-4">{e.department ?? "—"}</td>
              <td className="py-2 pr-4">{e.jobTitle ?? "—"}</td>
              <td className="py-2 pr-4">
                {e.reportTo ? `${e.reportTo.firstName} ${e.reportTo.lastName}` : "—"}
              </td>
              <td className="py-2 pr-4">
                <span
                  className={
                    e.status === "TERMINATED"
                      ? "rounded bg-red-100 px-2 py-0.5 text-red-700"
                      : "rounded bg-zinc-100 px-2 py-0.5"
                  }
                >
                  {e.status}
                </span>
              </td>
              <td className="py-2 text-right">
                <Link href={`/employees/${e.id}`} className="text-blue-600 hover:underline">
                  View
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center text-zinc-500">
                No employees in your scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}