import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { categories, type Category, type Ticket } from "@mittbo/shared";
import { sessionIdentity } from "@/lib/auth";
import { withStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const userId = await sessionIdentity(request);
  if (!userId) return NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const category: Category = body?.category;
  if (title.length < 4 || title.length > 100 || description.length < 8 || description.length > 2000 || !categories.includes(category)) {
    return NextResponse.json({ error: "Ange rubrik, kategori och en beskrivning på minst åtta tecken." }, { status: 400 });
  }
  const result = await withStore((store) => {
    const user = store.users.find((item) => item.id === userId);
    if (!user || user.role !== "tenant" || !user.unitId) return null;
    const unit = store.units.find((item) => item.id === user.unitId);
    const building = store.buildings.find((item) => item.id === unit?.buildingId);
    if (!building || building.organizationId !== user.organizationId) return null;
    const now = new Date().toISOString();
    const id = randomUUID();
    const ticket: Ticket = {
      id, organizationId: user.organizationId, unitId: user.unitId, tenantId: user.id, assigneeId: null,
      title, category, description, priority: "normal", status: "received", visitAt: null, createdAt: now, updatedAt: now,
      events: [{ id: randomUUID(), ticketId: id, actorId: user.id, kind: "created", body: description, visibility: "public", createdAt: now }], attachments: [],
    };
    store.tickets.unshift(ticket);
    return ticket;
  }, true);
  return result ? NextResponse.json(result, { status: 201 }) : NextResponse.json({ error: "Bara boende kan skapa ärenden." }, { status: 403 });
}
