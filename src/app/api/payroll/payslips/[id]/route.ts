import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPayslip } from "@/modules/payroll/service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res); // any role; scoping happens in the service
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await getPayslip(id, auth.user as { id: string; role: string }));
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.message ?? "Failed to load payslip" }, { status: err.code === "NOT_FOUND" ? 404 : err.code === "BAD_STATE" ? 409 : 500 });
  }
}