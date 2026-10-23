import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { completeRun } from "@/modules/payroll/service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await completeRun(auth.user as { id: string; role: string }, id));
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "NO_SELF_APPROVE" ? 403 : 409;
    return NextResponse.json({ error: err.message ?? "Failed to complete run" }, { status });
  }
}