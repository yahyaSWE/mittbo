import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { statusLabel, type Priority, type TicketStatus } from "@mittbo/shared";
import { sessionIdentity } from "@/lib/auth";
import { withStore } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const statuses: TicketStatus[] = ["received", "assigned", "in_progress", "waiting", "resolved", "closed"];
const priorities: Priority[] = ["low", "normal", "high"];

export async function POST(request: NextRequest, context: Context) {
  const userId = await sessionIdentity(request);
  if (!userId) return NextResponse.json({ error: "Logga in för att fortsätta." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Ogiltig begäran." }, { status: 400 });
  const result = await withStore((store) => {
    const user = store.users.find((item) => item.id === userId);
    const ticket = store.tickets.find((item) => item.id === id);
    if (!user || !ticket || ticket.organizationId !== user.organizationId) return { status: 404, error: "Ärendet hittades inte." };
    if (user.role === "tenant" && ticket.tenantId !== user.id || user.role === "worker" && ticket.assigneeId !== user.id) return { status: 404, error: "Ärendet hittades inte." };
    const addEvent = (kind: "assigned" | "status" | "message" | "visit", text: string, visibility: "public" | "internal" = "public") => {
      const now = new Date().toISOString();
      ticket.events.push({ id: randomUUID(), ticketId: id, actorId: user.id, kind, body: text, visibility, createdAt: now });
      ticket.updatedAt = now;
    };
    if (body.action === "assign") {
      if (user.role !== "admin") return { status: 403, error: "Bara förvaltare får tilldela ärenden." };
      const worker = store.users.find((item) => item.id === body.assigneeId && item.organizationId === user.organizationId && item.role === "worker");
      if (!worker) return { status: 400, error: "Välj en arbetare i samma organisation." };
      ticket.assigneeId = worker.id;
      ticket.status = "assigned";
      addEvent("assigned", `Tilldelat ${worker.name}`);
    } else if (body.action === "priority") {
      if (user.role !== "admin" || !priorities.includes(body.priority)) return { status: 403, error: "Ogiltig prioritet eller behörighet." };
      ticket.priority = body.priority;
      addEvent("status", `Prioritet ändrad till ${body.priority}`, "internal");
    } else if (body.action === "status") {
      if (!statuses.includes(body.status)) return { status: 400, error: "Ogiltig status." };
      const next: TicketStatus = body.status;
      const allowed = user.role === "admin" && (next === "assigned" && !!ticket.assigneeId || ["in_progress", "waiting", "resolved", "closed"].includes(next))
        || user.role === "worker" && ["in_progress", "waiting", "resolved"].includes(next)
        || user.role === "tenant" && ticket.status === "resolved" && next === "closed";
      if (!allowed) return { status: 403, error: "Den statusändringen är inte tillåten." };
      ticket.status = next;
      addEvent("status", `Status ändrad till ${statusLabel[next]}`);
    } else if (body.action === "message") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 1 || text.length > 2000) return { status: 400, error: "Meddelandet måste vara 1–2000 tecken." };
      const visibility = body.visibility === "internal" ? "internal" : "public";
      if (visibility === "internal" && user.role === "tenant") return { status: 403, error: "Ingen behörighet." };
      addEvent("message", text, visibility);
    } else if (body.action === "visit") {
      if (user.role === "tenant" || !body.visitAt || Number.isNaN(Date.parse(body.visitAt))) return { status: 403, error: "Ogiltig besökstid eller behörighet." };
      ticket.visitAt = new Date(body.visitAt).toISOString();
      addEvent("visit", `Besök planerat ${ticket.visitAt}`);
    } else return { status: 400, error: "Okänd åtgärd." };
    return { status: 200, ticket: { ...ticket, events: ticket.events.filter((event) => user.role !== "tenant" || event.visibility === "public") } };
  }, true);
  return "ticket" in result ? NextResponse.json(result.ticket) : NextResponse.json({ error: result.error }, { status: result.status });
}
