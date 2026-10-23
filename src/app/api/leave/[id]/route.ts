import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { cancelRequest } from "@/modules/leave/service";
import { cancelSchema } from "@/lib/validation/leave";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 400, title: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ status: 400, title: "A reason is required to cancel" }, { status: 400 });
  try {
    await cancelRequest(id, parsed.data.reason, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    if (code === "NOT_YOURS" || code === "NO_PERMISSION") return NextResponse.json({ status: 403, title: "Not yours to cancel" }, { status: 403 });
    if (code === "BAD_STATE") return NextResponse.json({ status: 409, title: "Cannot cancel in this state" }, { status: 409 });
    throw e;
  }
}