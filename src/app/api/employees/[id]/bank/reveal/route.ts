import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { revealBankAccount } from "@/modules/employee/bank";

/** The only endpoint that returns plaintext bank details.
 *  HR only, and every call writes a BANK_REVEAL audit row. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;

  const { id } = await ctx.params;
  const bank = await revealBankAccount(id, auth.user.id);
  if (!bank) return NextResponse.json({ status: 404, title: "Not found" }, { status: 404 });
  return NextResponse.json({ bank });
}