import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ status: 200, title: "Logged out" });
  const session = await getSession(req, res);
  await session.destroy(); // clears the cookie
  return res;
}

// export const runtime = "nodejs";