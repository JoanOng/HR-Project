/**
 * Session auth — cookie session via iron-session.
 * Passwords: bcrypt (cost 10). Sessions: { userId, role }.
 */
import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { hash, compare } from "bcryptjs";
import { prisma } from "@/prisma/client";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  email?: string;
  role?: "EMPLOYEE" | "MANAGER" | "HR";
}

const options: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "hr_session",
  ttl: 60 * 60 * 8, // 8 hours
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};

if (!process.env.SESSION_SECRET)
  throw new Error("SESSION_SECRET is not set");

export async function getSession(req: NextRequest, res: NextResponse) {
  return getIronSession<SessionData>(req, res, options);
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("invalid_credentials");
  const ok = await compare(password, user.passwordHash);
  if (!ok) throw new Error("invalid_credentials");
  return { user, passwordHash: user.passwordHash };
}

export function passwordHashOf(plain: string): Promise<string> {
  return hash(plain, 10);
}

/**
 * Gate for route handlers. Returns the user or a 401/403 Response.
 * Usage: const auth = await requireRole(req, res, "HR");
 *        if (!("user" in auth)) return auth;
 */
export async function requireRole(
  req: NextRequest,
  res: NextResponse,
  ...roles: SessionData["role"][]
) {
  const session = await getSession(req, res);
  if (!session.userId) return Response.json({ status: 401, title: "Not authenticated" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });
  if (!user) return Response.json({ status: 401, title: "User no longer exists" }, { status: 401 });
  if (roles.length > 0 && !roles.includes(user.role))
    return Response.json({ status: 403, title: "Forbidden" }, { status: 403 });
  return { user, session };
}

/**
 * Session for React SERVER components (pages).
 * Returns the logged-in User, or null when signed out.
 * (Route handlers keep using requireRole — this is the read-only page twin.)
 */
export async function getCurrentUser() {
  const jar = await cookies();
  const session = await getIronSession<SessionData>(
    {
      get: (name) => {
        const c = jar.get(name);
        return c ? { name, value: c.value } : undefined;
      },
      set: () => {}, // page-level reads only — writes are the route handlers' job
    },
    options,
  );
  if (!session.userId) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}