import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { terminateEmployee } from "@/modules/employee/service";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  try {
    const row = await terminateEmployee(id, auth.user.id);
    if (!row) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    return NextResponse.json({ employee: row });
  } catch (e) {
    if ((e as { code?: string }).code === "ALREADY_TERMINATED")
      return NextResponse.json({ status: 409, title: "Already terminated" }, { status: 409 });
    throw e;
  }
}