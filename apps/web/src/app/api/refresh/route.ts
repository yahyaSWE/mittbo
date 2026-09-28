import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { authClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.refreshToken !== "string" || !body.refreshToken) return NextResponse.json({ error: "Sessionen kan inte förnyas." }, { status: 400 });
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: body.refreshToken });
    if (error || !data.session) return NextResponse.json({ error: "Sessionen har gått ut. Logga in igen." }, { status: 401 });
    return NextResponse.json({ token: data.session.access_token, refreshToken: data.session.refresh_token });
  } catch (error) { return serverError(error); }
}
