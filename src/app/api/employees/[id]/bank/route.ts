import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { getEmployee } from "@/modules/employee/service";
import { upsertBankAccount, getBankMasked } from "@/modules/employee/bank";
import { createBankSchema } from "@/lib/validation/salary";

/** GET: the masked view — every role that can see the employee gets
 *  "****1234", nothing more. Plaintext lives ONLY behind /reveal, HR-only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  const scope = await scopeFor(auth.user);
  const emp = await getEmployee(id, scope);
  if (!emp) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });

  const bank = await getBankMasked(id);
  return NextResponse.json({ bank });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 400, title: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createBankSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: 400, title: "Validation error", errors: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const account = await upsertBankAccount(id, parsed.data, auth.user.id);
  const masked = await getBankMasked(id);
  return NextResponse.json(
    { bank: masked, id: account.id, created: true },
    { status: 200 },
  );
}