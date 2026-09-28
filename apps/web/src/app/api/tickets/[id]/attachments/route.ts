import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { TicketAttachment } from "@mittbo/shared";
import { sessionIdentity } from "@/lib/auth";
import { dataDir, withStore } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function validImage(bytes: Buffer, type: string) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function POST(request: NextRequest, context: Context) {
  const userId = await sessionIdentity(request);
  if (!userId) return NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
  const { id } = await context.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "Välj en bild." }, { status: 400 });
  if (file.size < 1 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Bilden får vara högst 5 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validImage(bytes, file.type)) return NextResponse.json({ error: "Välj en JPEG-, PNG- eller WebP-bild." }, { status: 400 });
  const result = await withStore(async (store) => {
    const user = store.users.find((item) => item.id === userId);
    const ticket = store.tickets.find((item) => item.id === id);
    if (!user || !ticket || ticket.organizationId !== user.organizationId || user.role === "tenant" && ticket.tenantId !== user.id || user.role === "worker" && ticket.assigneeId !== user.id) return null;
    const attachment: TicketAttachment = { id: randomUUID(), ticketId: id, filename: file.name.slice(0, 120) || "Bild", contentType: file.type, size: file.size, uploadedBy: user.id, createdAt: new Date().toISOString() };
    await mkdir(path.join(dataDir, "uploads"), { recursive: true });
    await writeFile(path.join(dataDir, "uploads", attachment.id), bytes, { flag: "wx" });
    ticket.attachments ??= [];
    ticket.attachments.push(attachment);
    ticket.updatedAt = attachment.createdAt;
    ticket.events.push({ id: randomUUID(), ticketId: id, actorId: user.id, kind: "message", body: "En bild bifogades.", visibility: "public", createdAt: attachment.createdAt });
    return attachment;
  }, true);
  return result ? NextResponse.json(result, { status: 201 }) : NextResponse.json({ error: "Ärendet hittades inte." }, { status: 404 });
}
