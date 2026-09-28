import { NextRequest, NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { dbError, getTicketWithAccess, uuidPattern } from "@/lib/repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return NextResponse.json({ error: "Bilden hittades inte." }, { status: 404 });
    const result = await identity.db.from("ticket_attachments").select("*").eq("id", id).maybeSingle();
    dbError(result.error);
    if (!result.data) return NextResponse.json({ error: "Bilden hittades inte." }, { status: 404 });
    const ticket = await getTicketWithAccess(identity.db, result.data.ticket_id);
    if (!ticket) return NextResponse.json({ error: "Bilden hittades inte." }, { status: 404 });
    const signed = await identity.db.storage.from("ticket-attachments").createSignedUrl(result.data.storage_path, 60);
    if (signed.error || !signed.data) return NextResponse.json({ error: "Bilden kunde inte läsas." }, { status: 404 });
    return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return serverError(error); }
}
