import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role, User } from "@mittbo/shared";
import { authClient, userClient } from "./supabase/server";

const accessCookie = "mittbo_access";
const refreshCookie = "mittbo_refresh";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 60 * 60 };

export async function setWebSession(accessToken: string, refreshToken: string) {
  const jar = await cookies();
  jar.set(accessCookie, accessToken, cookieOptions);
  jar.set(refreshCookie, refreshToken, cookieOptions);
}

export async function clearWebSession() {
  const jar = await cookies();
  jar.set(accessCookie, "", { ...cookieOptions, maxAge: 0 });
  jar.set(refreshCookie, "", { ...cookieOptions, maxAge: 0 });
}

export function sameOrigin(request: NextRequest) {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export interface Identity { user: User; db: SupabaseClient; accessToken: string }

export async function getCurrentUser(request: NextRequest): Promise<Identity | null> {
  const bearer = request.headers.get("authorization");
  if (bearer && !bearer.startsWith("Bearer ")) return null;
  const mobileToken = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  const jar = await cookies();
  let token = mobileToken || jar.get(accessCookie)?.value;
  if (!token && !jar.get(refreshCookie)?.value) return null;
  const auth = authClient();
  let result = token ? await auth.auth.getUser(token) : null;
  if ((!result || result.error || !result.data.user) && !mobileToken) {
    const refresh = jar.get(refreshCookie)?.value;
    if (!refresh) return null;
    const refreshed = await auth.auth.refreshSession({ refresh_token: refresh });
    if (refreshed.error || !refreshed.data.session) return null;
    token = refreshed.data.session.access_token;
    await setWebSession(token, refreshed.data.session.refresh_token);
    result = await auth.auth.getUser(token);
  }
  if (!token || !result?.data.user || result.error) return null;
  const db = userClient(token);
  const { data, error } = await db.from("profiles").select("id, organization_id, unit_id, role, name, email").eq("id", result.data.user.id).single();
  if (error || !data) return null;
  const user: User = { id: data.id, organizationId: data.organization_id, unitId: data.unit_id || undefined, role: data.role as Role, name: data.name, email: data.email };
  return { user, db, accessToken: token };
}
