import { NextResponse, NextRequest } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { getSession, login } from "@/lib/session";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { status: 400, title: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        status: 400,
        title: "Validation error",
        errors: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  let user;
  try {
    user = (await login(parsed.data.email, parsed.data.password)).user;
  } catch {
    return Response.json(
      { status: 401, title: "Invalid email or password" },
      { status: 401 },
    );
  }
  // login() throws "invalid_credentials" for unknown email OR wrong password
  // — same message on purpose, so the endpoint never reveals which.

  const res = NextResponse.json(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    { status: 200 },
  );

  const session = await getSession(req, res);
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  // iron-session writes the cookie automatically when the response finishes.
  await session.save();
  return res;
}

// export const runtime = "nodejs";