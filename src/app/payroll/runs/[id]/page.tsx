import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getRun } from "@/modules/payroll/service";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";

const statusStyle: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700",
  COMPLETED: "bg-blue-100 text-blue-800",
  PUBLISHED: "bg-green-100 text-green-700",
  VOIDED: "bg-red-100 text-red-700",
};

const money = (sen: number) => (sen / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "HR") notFound();

  const { id } = await params;
  const run = await getRun(id);

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Payroll {run.year}-{String(run.month).padStart(2, "0")}
          <span className={`ml-3 rounded px-2 py-0.5 text-sm ${statusStyle[run.status]}`}>{run.status}</span>
        </h1>
        <div className="flex gap-2">
          <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            ← Payroll
          </Link>
          <LogoutButton />
        </div>
      </div>

      {(run.note || run.voidReason) && (
        <p className="mb-4 text-sm text-zinc-600">
          {run.status === "VOIDED" ? `Voided: ${run.voidReason}` : run.note}
        </p>
      )}

      {run.payslips.map((p) => (
        <div key={p.id} className="mb-4 rounded border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm">
              <span className="font-mono">{p.employeeNumber}</span> {p.employeeName}
              {p.flags && <span className="ml-2 text-xs text-amber-700">{p.flags}</span>}
            </div>
            <Link href={`/payroll/payslips/${p.id}`} className="text-xs text-blue-600 hover:underline">
              Full payslip →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 sm:grid-cols-5">
            <div>Base <div className="font-mono text-sm text-zinc-900">{money(p.baseMonthly)}</div></div>
            <div>Days <div className="font-mono text-sm text-zinc-900">{p.employedDays}/{p.calendarDays}</div></div>
            <div>Gross <div className="font-mono text-sm text-zinc-900">{money(p.gross)}</div></div>
            <div>Tax + EPF <div className="font-mono text-sm text-zinc-900">{money(p.tax + p.empContrib)}</div></div>
            <div>Net <div className="font-mono text-sm font-semibold text-zinc-900">{money(p.net)}</div></div>
          </div>
        </div>
      ))}
      {run.payslips.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-500">No payslips in this run.</p>
      )}
    </main>
  );
}