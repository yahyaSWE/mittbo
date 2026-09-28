import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin, serverError, unauthorized } from "@/lib/api";
import { getCurrentUser, sameOrigin } from "@/lib/auth";
import { attachment, dbError, getTicketWithAccess, uuidPattern } from "@/lib/repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const bucket = "ticket-attachments";

function validImage(bytes: Buffer, type: string) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    const { id } = await context.params;
    const ticket = await getTicketWithAccess(identity.db, id);
    if (!ticket) return NextResponse.json({ error: "Ärendet hittades inte." }, { status: 404 });
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json().catch(() => null);
      const uploadId = body?.uploadId;
      const type = body?.contentType;
      const size = body?.size;
      const types: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (typeof uploadId !== "string" || !uuidPattern.test(uploadId) || !Object.hasOwn(types, type)
        || !Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "Ogiltiga bilduppgifter." }, { status: 400 });
      }
      const path = `${identity.user.organizationId}/${id}/${uploadId}.${types[type]}`;
      const download = await identity.db.storage.from(bucket).download(path);
      if (download.error || !download.data) return NextResponse.json({ error: "Bilden har inte laddats upp eller kunde inte verifieras." }, { status: 400 });
      const bytes = Buffer.from(await download.data.arrayBuffer());
      if (bytes.length !== size || bytes.length > 5 * 1024 * 1024 || !validImage(bytes, type)) {
        return NextResponse.json({ error: "Bildens format eller storlek stämmer inte." }, { status: 400 });
      }
      const result = await identity.db.from("ticket_attachments").insert({ id: uploadId, ticket_id: id, uploaded_by: identity.user.id, storage_path: path, filename: typeof body.filename === "string" ? body.filename.slice(0, 120) || "Bild" : "Bild", mime_type: type, size }).select("*").single();
      dbError(result.error);
      if (!result.data) throw new Error("Bilduppgifter kunde inte sparas.");
      const event = await identity.db.from("ticket_events").insert({ ticket_id: id, actor_id: identity.user.id, kind: "message", body: "En bild bifogades.", visibility: "public" });
      if (event.error) console.error("Attachment event could not be saved", event.error);
      return NextResponse.json(attachment(result.data), { status: 201 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "Välj en bild." }, { status: 400 });
    if (file.size < 1 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Bilden får vara högst 5 MB." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) return NextResponse.json({ error: "Välj en JPEG-, PNG- eller WebP-bild." }, { status: 400 });
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const imageId = randomUUID();
    const path = `${identity.user.organizationId}/${id}/${imageId}.${extension}`;
    const upload = await identity.db.storage.from(bucket).upload(path, bytes, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;
    try {
      const result = await identity.db.from("ticket_attachments").insert({ id: imageId, ticket_id: id, uploaded_by: identity.user.id, storage_path: path, filename: file.name.slice(0, 120) || "Bild", mime_type: file.type, size: file.size }).select("*").single();
      dbError(result.error);
      if (!result.data) throw new Error("Bilduppgifter kunde inte sparas.");
      const event = await identity.db.from("ticket_events").insert({ ticket_id: id, actor_id: identity.user.id, kind: "message", body: "En bild bifogades.", visibility: "public" });
      if (event.error) console.error("Attachment event could not be saved", event.error);
      return NextResponse.json(attachment(result.data), { status: 201 });
    } catch (error) {
      await identity.db.storage.from(bucket).remove([path]);
      throw error;
    }
  } catch (error) { return serverError(error); }
}
