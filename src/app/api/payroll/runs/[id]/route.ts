import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getRun } from "@/modules/payroll/service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await getRun(id));
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.message ?? "Failed to load run" }, { status: err.code === "NOT_FOUND" ? 404 : 500 });
  }
}