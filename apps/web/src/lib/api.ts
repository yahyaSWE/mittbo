import { NextResponse } from "next/server";

export function serverError(error: unknown) {
  console.error("MittBo API error", error);
  return NextResponse.json({ error: "Serverfel. Försök igen senare eller kontrollera Supabase-konfigurationen." }, { status: 500 });
}

export const unauthorized = () => NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
export const forbiddenOrigin = () => NextResponse.json({ error: "Begäran från en annan webbplats är inte tillåten." }, { status: 403 });
