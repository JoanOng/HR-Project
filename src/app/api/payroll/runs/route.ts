import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { createRun, listRuns } from "@/modules/payroll/service";
import { createRunSchema } from "@/lib/validation/payroll";

export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;
  return NextResponse.json(await listRuns());
}

export async function POST(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  try {
    return NextResponse.json(await createRun(auth.user as { id: string; role: string }, parsed.data), { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const status = err.code === "EXISTING_RUN" || err.code === "BAD_STATE" ? 409 : 500;
    return NextResponse.json({ error: err.message ?? "Failed to create run" }, { status });
  }
}