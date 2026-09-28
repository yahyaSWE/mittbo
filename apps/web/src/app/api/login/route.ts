import { NextRequest, NextResponse } from "next/server";
import { checkPassword, withStore } from "@/lib/store";
import { createSession, publicUser, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Ange e-post och lösenord." }, { status: 400 });
  const user = await withStore((store) => store.users.find((item) => item.email === email));
  if (!user || !checkPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Fel e-postadress eller lösenord." }, { status: 401 });
  }
  const token = await createSession(user.id);
  const response = NextResponse.json({ token, user: publicUser(user) });
  response.cookies.set(sessionCookie, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 60 * 60 });
  return response;
}
