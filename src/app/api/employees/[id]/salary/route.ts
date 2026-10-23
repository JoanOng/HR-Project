import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getEmployee } from "@/modules/employee/service";
import { createSalaryRecord, listSalaryHistory } from "@/modules/employee/salary";
import { createSalarySchema } from "@/lib/validation/salary";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  const scope = await scopeFor(auth.user);
  const emp = await getEmployee(id, scope);
  if (!emp) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });

  const history = await listSalaryHistory(id);
  // minor units in, major units out — display only, never re-parsed for math
  return NextResponse.json({
    history: history.map((r) => ({
      id: r.id,
      baseMonthly: r.baseMonthly / 100,
      allowances: (r.allowances as { code: string; name: string; amount: number }[] | null)
        ?.map((l) => ({ ...l, amount: l.amount / 100 })) ?? null,
      standingDeductions: (r.standingDeductions as { code: string; name: string; amount: number }[] | null)
        ?.map((l) => ({ ...l, amount: l.amount / 100 })) ?? null,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 400, title: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSalarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: 400, title: "Validation error", errors: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const record = await createSalaryRecord(id, parsed.data, auth.user.id);
    return NextResponse.json(
      { record: { id: record.id, baseMonthly: record.baseMonthly / 100, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo } },
      { status: 201 },
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "BAD_AMOUNT") return NextResponse.json({ status: 400, title: "Invalid amount" }, { status: 400 });
    if (code === "SALARY_EXISTS") return NextResponse.json({ status: 409, title: "A salary record already starts on this date" }, { status: 409 });
    throw e;
  }
}