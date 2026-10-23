import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor } from "@/lib/permissions";
import { listPeriods } from "@/modules/timesheet/service";

export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;
  const scope = await scopeFor(auth.user);
  return NextResponse.json(await listPeriods(scope));
}