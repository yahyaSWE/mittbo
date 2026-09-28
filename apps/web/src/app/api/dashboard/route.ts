import { NextRequest, NextResponse } from "next/server";
import { publicUser, sessionIdentity } from "@/lib/auth";
import { withStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await sessionIdentity(request);
  if (!userId) return NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
  const data = await withStore((store) => {
    const user = store.users.find((item) => item.id === userId);
    if (!user) return null;
    const buildings = store.buildings.filter((item) => item.organizationId === user.organizationId);
    const allowedUnitIds = new Set(store.units.filter((item) => buildings.some((building) => building.id === item.buildingId)).map((item) => item.id));
    const tickets = store.tickets.filter((item) => item.organizationId === user.organizationId && allowedUnitIds.has(item.unitId) && (user.role === "admin" || user.role === "tenant" && item.tenantId === user.id || user.role === "worker" && item.assigneeId === user.id));
    const visibleUserIds = new Set([user.id, ...tickets.flatMap((ticket) => [ticket.tenantId, ticket.assigneeId, ...ticket.events.filter((event) => user.role !== "tenant" || event.visibility === "public").map((event) => event.actorId)]).filter((id): id is string => !!id)]);
    return {
      user: publicUser(user),
      users: store.users.filter((item) => item.organizationId === user.organizationId && (user.role === "admin" || visibleUserIds.has(item.id) || user.role === "tenant" && item.role === "worker" || user.role === "worker" && item.role === "worker")).map(publicUser),
      buildings,
      units: store.units.filter((item) => allowedUnitIds.has(item.id)),
      tickets: tickets.map((ticket) => ({ ...ticket, events: ticket.events.filter((event) => user.role !== "tenant" || event.visibility === "public") })),
      notices: store.notices.filter((item) => item.organizationId === user.organizationId && (user.role !== "tenant" || buildings.some((building) => building.id === item.buildingId && store.units.some((unit) => unit.id === user.unitId && unit.buildingId === building.id)))),
    };
  });
  return data ? NextResponse.json(data) : NextResponse.json({ error: "Kontot hittades inte." }, { status: 401 });
}
