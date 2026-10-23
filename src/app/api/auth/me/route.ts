import { NextResponse, NextRequest } from "next/server";
import { requireRole } from "@/lib/session";

export async function GET(req: NextRequest) {
  // no role args = any signed-in user
  const res = new NextResponse(null);
  const auth = await requireRole(req, res);
  if (!("user" in auth)) return auth;

  return Response.json({
    id: auth.user.id,
    email: auth.user.email,
    role: auth.user.role,
  });
}

// export const runtime = "nodejs";