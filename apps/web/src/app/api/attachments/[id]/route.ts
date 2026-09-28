import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { sessionIdentity } from "@/lib/auth";
import { dataDir, withStore } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const userId = await sessionIdentity(request);
  if (!userId) return NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
  const { id } = await context.params;
  const attachment = await withStore((store) => {
    const user = store.users.find((item) => item.id === userId);
    if (!user) return null;
    const ticket = store.tickets.find((item) => item.attachments?.some((image) => image.id === id));
    if (!ticket || ticket.organizationId !== user.organizationId || user.role === "tenant" && ticket.tenantId !== user.id || user.role === "worker" && ticket.assigneeId !== user.id) return null;
    return ticket.attachments.find((image) => image.id === id) || null;
  });
  if (!attachment) return NextResponse.json({ error: "Bilden hittades inte." }, { status: 404 });
  try {
    const bytes = await readFile(path.join(dataDir, "uploads", attachment.id));
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": attachment.contentType, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Bilden kunde inte läsas." }, { status: 404 }); }
}
