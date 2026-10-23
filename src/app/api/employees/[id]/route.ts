import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getEmployee, updateEmployee } from "@/modules/employee/service";
import { updateEmployeeSchema } from "@/lib/validation/employee";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  const scope = await scopeFor(auth.user);
  const row = await getEmployee(id, scope);
  if (!row) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
  return NextResponse.json({ employee: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: 400, title: "Validation error", errors: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const row = await updateEmployee(id, parsed.data, auth.user.id);
    if (!row) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    return NextResponse.json({ employee: row });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "CYCLE") return NextResponse.json({ status: 400, title: "Report-to would create a cycle" }, { status: 400 });
    if (code === "USE_TERMINATE") return NextResponse.json({ status: 400, title: "Use the terminate action" }, { status: 400 });
    throw e;
  }
}