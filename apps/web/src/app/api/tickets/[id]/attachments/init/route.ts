import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin, serverError, unauthorized } from "@/lib/api";
import { getCurrentUser, sameOrigin } from "@/lib/auth";
import { getTicketWithAccess } from "@/lib/repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    const { id } = await context.params;
    if (!await getTicketWithAccess(identity.db, id)) return NextResponse.json({ error: "Ärendet hittades inte." }, { status: 404 });
    const body = await request.json().catch(() => null);
    const contentType = body?.contentType;
    const size = body?.size;
    const filename = typeof body?.filename === "string" ? body.filename.slice(0, 120) : "Bild";
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    if (!Object.hasOwn(extensions, contentType) || !Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Välj en JPEG-, PNG- eller WebP-bild på högst 5 MB." }, { status: 400 });
    }
    const uploadId = randomUUID();
    const path = `${identity.user.organizationId}/${id}/${uploadId}.${extensions[contentType]}`;
    const signed = await identity.db.storage.from("ticket-attachments").createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw signed.error || new Error("Uppladdningslänk kunde inte skapas.");
    return NextResponse.json({ uploadId, signedUrl: signed.data.signedUrl, filename, contentType, size });
  } catch (error) { return serverError(error); }
}
