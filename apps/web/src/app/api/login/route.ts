import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { setWebSession } from "@/lib/auth";
import { authClient, userClient } from "@/lib/supabase/server";
import type { User } from "@mittbo/shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return NextResponse.json({ error: "Ange e-post och lösenord." }, { status: 400 });
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return NextResponse.json({ error: "Fel e-postadress eller lösenord." }, { status: 401 });
    const db = userClient(data.session.access_token);
    const profile = await db.from("profiles").select("id, organization_id, unit_id, role, name, email").eq("id", data.user.id).single();
    if (profile.error || !profile.data) return NextResponse.json({ error: "Kontot saknar MittBo-profil. Kontakta administratören." }, { status: 403 });
    const user: User = { id: profile.data.id, organizationId: profile.data.organization_id, unitId: profile.data.unit_id || undefined, role: profile.data.role, name: profile.data.name, email: profile.data.email };
    await setWebSession(data.session.access_token, data.session.refresh_token);
    return NextResponse.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, user });
  } catch (error) { return serverError(error); }
}
