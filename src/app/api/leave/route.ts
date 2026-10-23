import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getLeaveView, createRequest } from "@/modules/leave/service";
import { requestLeaveSchema } from "@/lib/validation/leave";

function badRequest(title: string, extra?: { problems?: string[] }) {
  return NextResponse.json({ status: 400, title, ...extra }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const view = await getLeaveView(await scopeFor(auth.user));
  return NextResponse.json(view);
}

export async function POST(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = requestLeaveSchema.safeParse(body);
  if (!parsed.success) return badRequest("Validation error", { problems: parsed.error.issues.map((i) => i.message) });
  try {
    const { notice } = await createRequest(parsed.data, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true, notice });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const problems = (e as { problems?: string[] }).problems;
    if (code === "VALIDATION") return badRequest("Request rejected", { problems });
    if (code === "NOT_SELF") return NextResponse.json({ status: 403, title: "Only the employee can create their own request" }, { status: 403 });
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    throw e;
  }
}