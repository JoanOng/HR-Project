import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { decideRequest } from "@/modules/leave/service";
import { decideSchema } from "@/lib/validation/leave";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
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
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ status: 400, title: "Validation error" }, { status: 400 });
  try {
    await decideRequest(id, parsed.data.decision, parsed.data.comment ?? null, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    if (code === "NO_PERMISSION" || code === "HR_ONLY") return NextResponse.json({ status: 403, title: (e as Error).message }, { status: 403 });
    if (code === "NEED_COMMENT") return NextResponse.json({ status: 400, title: "A comment is required to reject" }, { status: 400 });
    if (code === "BAD_STATE") return NextResponse.json({ status: 409, title: "Only pending requests can be decided" }, { status: 409 });
    if (code === "NO_BALANCE") return NextResponse.json({ status: 409, title: "Insufficient balance at decision time" }, { status: 409 });
    throw e;
  }
}