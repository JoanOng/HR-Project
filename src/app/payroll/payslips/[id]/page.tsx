import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getPayslip } from "@/modules/payroll/service";
import { LogoutButton } from "@/app/employees/logout-button";

export const dynamic = "force-dynamic";

const money = (sen: number) => (sen / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  let p: Awaited<ReturnType<typeof getPayslip>>;
  try {
    p = await getPayslip(id, { id: user.id, role: user.role });
  } catch {
    notFound(); // NOT_FOUND (someone else's) or BAD_STATE (not published yet) → same 404 to employees
  }

  const earned = p.lines.filter((l) => l.kind === "EARNED");
  const deducted = p.lines.filter((l) => l.kind === "DEDUCTED");

  return (
    <main className="flex-1 px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payslip</h1>
        <div className="flex gap-2">
          <Link href="/payroll" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            ← Payroll
          </Link>
          <LogoutButton />
        </div>
      </div>

      <div className="mx-auto max-w-2xl rounded border border-zinc-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between border-b border-zinc-200 pb-4">
          <div>
            <div className="text-sm font-semibold">{p.employeeName}</div>
            <div className="font-mono text-xs text-zinc-500">{p.employeeNumber}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold">{p.year}-{String(p.month).padStart(2, "0")}</div>
            <div className="text-xs text-zinc-500">{p.employedDays} of {p.calendarDays} days</div>
          </div>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left text-xs text-zinc-600">
              <th className="py-1.5">Earned</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {earned.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100">
                <td className="py-1.5">
                  {l.name}
                  {l.note && <span className="ml-1 text-xs text-zinc-500">({l.note})</span>}
                </td>
                <td className="py-1.5 text-right font-mono">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left text-xs text-zinc-600">
              <th className="py-1.5">Deducted</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {deducted.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100">
                <td className="py-1.5">
                  {l.name}
                  {l.note && <span className="ml-1 text-xs text-zinc-500">({l.note})</span>}
                </td>
                <td className="py-1.5 text-right font-mono">-{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 border-t border-zinc-300 pt-3 text-sm">
          <div className="flex justify-between"><span>Gross</span><span className="font-mono">{money(p.gross)}</span></div>
          <div className="flex justify-between text-zinc-600"><span>Income tax</span><span className="font-mono">-{money(p.tax)}</span></div>
          <div className="flex justify-between text-zinc-600"><span>Employee contributions</span><span className="font-mono">-{money(p.empContrib)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Net pay</span><span className="font-mono">{money(p.net)}</span></div>
        </div>

        {p.flags && <p className="mt-4 text-xs text-amber-700">Flags: {p.flags}</p>}
        {p.runStatus === "VOIDED" && <p className="mt-2 text-xs text-red-700">This run has been voided — treat this payslip as void.</p>}
      </div>
    </main>
  );
}