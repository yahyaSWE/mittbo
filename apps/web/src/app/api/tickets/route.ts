import { NextRequest, NextResponse } from "next/server";
import { categories, type Category } from "@mittbo/shared";
import { forbiddenOrigin, serverError, unauthorized } from "@/lib/api";
import { getCurrentUser, sameOrigin } from "@/lib/auth";
import { dbError, getTicketWithAccess } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    const { user, db } = identity;
    if (user.role !== "tenant" || !user.unitId) return NextResponse.json({ error: "Bara boende kan skapa ärenden." }, { status: 403 });
    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const category: Category = body?.category;
    if (title.length < 4 || title.length > 100 || description.length < 8 || description.length > 2000 || !categories.includes(category)) {
      return NextResponse.json({ error: "Ange rubrik, kategori och en beskrivning på minst åtta tecken." }, { status: 400 });
    }
    const { data, error } = await db.from("tickets").insert({ organization_id: user.organizationId, unit_id: user.unitId, tenant_id: user.id, title, category, description, priority: "normal", status: "received" }).select("id").single();
    dbError(error);
    if (!data) throw new Error("Ärendet kunde inte sparas.");
    const ticket = await getTicketWithAccess(db, data.id);
    if (!ticket) throw new Error("Ärendet kunde inte läsas efter skapande.");
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) { return serverError(error); }
}
