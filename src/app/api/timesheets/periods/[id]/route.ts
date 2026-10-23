import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getPeriodView, savePeriod, submitPeriod, withdrawPeriod } from "@/modules/timesheet/service";
import { savePeriodSchema, withdrawSchema } from "@/lib/validation/timesheet";

type Ctx = { params: Promise<{ id: string }> };

function badRequest(title: string, extra?: { problems?: string[] }) {
  return NextResponse.json({ status: 400, title, ...extra }, { status: 400 });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  const view = await getPeriodView(id, await scopeFor(auth.user));
  if (!view) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = savePeriodSchema.safeParse(body);
  if (!parsed.success) return badRequest("Validation error", { problems: parsed.error.issues.map((i) => i.message) });

  try {
    await savePeriod(id, parsed.data.entries, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const problems = (e as { problems?: string[] }).problems;
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    if (code === "VALIDATION") return badRequest("Entry rejected", { problems });
    if (code === "LOCKED") return NextResponse.json({ status: 409, title: "Submitted timesheets are locked — withdraw first" }, { status: 409 });
    if (code === "IMMUTABLE") return NextResponse.json({ status: 409, title: "Approved timesheets are immutable" }, { status: 409 });
    if (code === "PERIOD_CLOSED") return NextResponse.json({ status: 409, title: "This half-month has closed" }, { status: 409 });
    throw e;
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body = plain submit */
  }
  const action = (body as { action?: string }).action ?? "submit";

  if (action === "withdraw") {
    const parsed = withdrawSchema.safeParse(body);
    if (!parsed.success) return badRequest("A reason is required to withdraw");
    try {
      await withdrawPeriod(id, parsed.data.reason, await scopeFor(auth.user), auth.user.id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
      if (code === "NOT_YOURS" || code === "NO_PERMISSION") return NextResponse.json({ status: 403, title: "Not yours to withdraw" }, { status: 403 });
      if (code === "BAD_STATE") return NextResponse.json({ status: 409, title: "Only submitted timesheets can be withdrawn" }, { status: 409 });
      throw e;
    }
  }

  // default: submit
  try {
    await submitPeriod(id, await scopeFor(auth.user), auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const problems = (e as { problems?: string[] }).problems;
    if (code === "NOT_FOUND") return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
    if (code === "VALIDATION") return badRequest("Timesheet rejected", { problems });
    if (code === "EMPTY") return NextResponse.json({ status: 400, title: "No hours recorded and empty submission is not allowed" }, { status: 400 });
    if (code === "BAD_STATE") return NextResponse.json({ status: 409, title: "Only draft or rejected timesheets can be submitted" }, { status: 409 });
    throw e;
  }
}