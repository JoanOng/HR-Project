import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { scopeFor, scopeWhere } from "@/lib/permissions";
import { createEmployee } from "@/modules/employee/service";
import { createEmployeeSchema } from "@/lib/validation/employee";

export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;

  const scope = await scopeFor(auth.user);
  const { listEmployees } = await import("@/modules/employee/service");
  const rows = await listEmployees(scope);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const res = new NextResponse();
  const auth = await requireRole(req, res, "HR");
  if (!("user" in auth)) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 400, title: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: 400, title: "Validation error", errors: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const employee = await createEmployee(parsed.data, auth.user.id);
    return NextResponse.json({ employee }, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "BAD_MANAGER") return NextResponse.json({ status: 400, title: "Manager not found" }, { status: 400 });
    if (code === "EMAIL_TAKEN") return NextResponse.json({ status: 409, title: "Email already registered" }, { status: 409 });
    throw e;
  }
}