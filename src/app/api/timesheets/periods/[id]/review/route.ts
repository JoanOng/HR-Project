import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { reviewPeriod } from "@/modules/timesheet/service";
import { reviewSchema } from "@/lib/validation/timesheet";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "MANAGER", "HR");
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 400, title: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ status: 400, title: "Validation error", errors: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }

  try {
    await reviewPeriod(id, parsed.data.decision, parsed.data.comment, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    if (code === "NO_PERMISSION") return NextResponse.json({ status: 403, title: "You cannot review timesheets" }, { status: 403 });
    if (code === "NEED_COMMENT") return NextResponse.json({ status: 400, title: "A comment is required to reject" }, { status: 400 });
    if (code === "BAD_STATE") return NextResponse.json({ status: 409, title: "Only submitted timesheets can be reviewed" }, { status: 409 });
    throw e;
  }
}