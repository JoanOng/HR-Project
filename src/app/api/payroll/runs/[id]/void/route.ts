import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { voidRun } from "@/modules/payroll/service";
import { voidSchema } from "@/lib/validation/payroll";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  try {
    return NextResponse.json(await voidRun(auth.user as { id: string; role: string }, id, parsed.data.reason));
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.message ?? "Failed to void run" }, { status: err.code === "NOT_FOUND" ? 404 : 409 });
  }
}