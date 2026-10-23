import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getEmployee } from "@/modules/employee/service";
import { listSalaryHistory } from "@/modules/employee/salary";
import { getBankMasked } from "@/modules/employee/bank";
import { LogoutButton } from "../logout-button";
import { RevealBank } from "./reveal-bank";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee — HR" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const scope = await scopeFor(user);
  const emp = await getEmployee(id, scope);
  if (!emp) notFound(); // out-of-scope == nonexistent

  const history = await listSalaryHistory(emp.id);
  const bank = await getBankMasked(emp.id); // masked for EVERY role

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/employees" className="text-sm text-blue-600 hover:underline">← Employees</Link>
          <h1 className="text-2xl font-semibold">
            {emp.employeeNumber} — {emp.firstName} {emp.lastName}
          </h1>
        </div>
        <LogoutButton />
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-4xl">
        <section className="rounded border border-zinc-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Profile</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Email" v={emp.email} />
            <Row k="Phone" v={emp.phone ?? "—"} />
            <Row k="Date of birth" v={emp.dateOfBirth ? emp.dateOfBirth.toISOString().slice(0, 10) : "—"} />
            <Row k="Department" v={emp.department ?? "—"} />
            <Row k="Job title" v={emp.jobTitle ?? "—"} />
            <Row k="Hire date" v={emp.hireDate.toISOString().slice(0, 10)} />
            <Row k="Status" v={emp.status === "TERMINATED" ? `TERMINATED (${emp.terminatedAt?.toISOString().slice(0, 10)})` : emp.status} />
            <Row k="Manager" v={emp.reportTo ? `${emp.reportTo.firstName} ${emp.reportTo.lastName}` : "—"} />
            <Row k="Work email" v={emp.workEmail ?? "—"} />
            <Row k="Location" v={emp.location ?? "—"} />
          </dl>
        </section>

        <div className="space-y-6">
          <section className="rounded border border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">Bank account (masked)</h2>
            {bank ? (
              <dl className="space-y-1.5 text-sm">
                <Row k="Bank" v={bank.bankName} />
                <Row k="Account" v={<span className="font-mono">{bank.accountNumber}</span>} />
                <Row k="Holder" v={bank.accountHolderName} />
                <Row k="Currency" v={bank.currency} />
                {user.role === "HR" && <RevealBank employeeId={emp.id} />}
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">No bank account on file.</p>
            )}
          </section>

          <section className="rounded border border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">Salary history</h2>
            {history.length === 0 ? (
              <p className="text-sm text-zinc-500">No salary records.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-600">
                    <th className="py-1.5 pr-3">Base (monthly)</th>
                    <th className="py-1.5 pr-3">Allowances</th>
                    <th className="py-1.5 pr-3">From</th>
                    <th className="py-1.5">To</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100">
                      <td className="py-1.5 pr-3">{(r.baseMonthly / 100).toFixed(2)}</td>
                      <td className="py-1.5 pr-3">
                        {(r.allowances as { code: string; amount: number }[] | null)
                          ?.map((a) => `${a.code} ${(a.amount / 100).toFixed(2)}`)
                          .join(", ") || "—"}
                      </td>
                      <td className="py-1.5 pr-3">{r.effectiveFrom.toISOString().slice(0, 10)}</td>
                      <td className="py-1.5">{r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : "now"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex">
      <dt className="w-32 text-zinc-500">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}