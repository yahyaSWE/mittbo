import { NextRequest, NextResponse } from "next/server";
import { type Priority, type TicketStatus } from "@mittbo/shared";
import { forbiddenOrigin, serverError, unauthorized } from "@/lib/api";
import { getCurrentUser, sameOrigin } from "@/lib/auth";
import { dbError, getTicketWithAccess } from "@/lib/repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const statuses: TicketStatus[] = ["received", "assigned", "in_progress", "waiting", "resolved", "closed"];
const priorities: Priority[] = ["low", "normal", "high"];

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    const { user, db } = identity;
    const { id } = await context.params;
    const ticket = await getTicketWithAccess(db, id);
    if (!ticket) return NextResponse.json({ error: "Ärendet hittades inte." }, { status: 404 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Ogiltig begäran." }, { status: 400 });
    let patch: Record<string, string | null> | null = null;
    if (body.action === "assign") {
      if (user.role !== "admin") return NextResponse.json({ error: "Bara förvaltare får tilldela ärenden." }, { status: 403 });
      if (typeof body.assigneeId !== "string") return NextResponse.json({ error: "Välj en arbetare." }, { status: 400 });
      const worker = await db.from("profiles").select("id").eq("id", body.assigneeId).eq("organization_id", user.organizationId).eq("role", "worker").maybeSingle();
      dbError(worker.error);
      if (!worker.data) return NextResponse.json({ error: "Välj en arbetare i samma organisation." }, { status: 400 });
      patch = { assignee_id: worker.data.id, status: "assigned" };
    } else if (body.action === "priority") {
      if (user.role !== "admin") return NextResponse.json({ error: "Bara förvaltare får ändra prioritet." }, { status: 403 });
      if (!priorities.includes(body.priority)) return NextResponse.json({ error: "Ogiltig prioritet." }, { status: 400 });
      patch = { priority: body.priority };
    } else if (body.action === "status") {
      if (!statuses.includes(body.status)) return NextResponse.json({ error: "Ogiltig status." }, { status: 400 });
      const next: TicketStatus = body.status;
      const allowed = user.role === "admin" && (next === "assigned" && !!ticket.assigneeId || ["in_progress", "waiting", "resolved", "closed"].includes(next))
        || user.role === "worker" && ticket.status !== "closed" && ["in_progress", "waiting", "resolved"].includes(next)
        || user.role === "tenant" && ticket.status === "resolved" && next === "closed";
      if (!allowed) return NextResponse.json({ error: "Den statusändringen är inte tillåten." }, { status: 403 });
      patch = { status: next };
    } else if (body.action === "message") {
      const message = typeof body.text === "string" ? body.text.trim() : "";
      if (message.length < 1 || message.length > 2000) return NextResponse.json({ error: "Meddelandet måste vara 1–2000 tecken." }, { status: 400 });
      const visibility = body.visibility === "internal" ? "internal" : "public";
      if (visibility === "internal" && user.role === "tenant") return NextResponse.json({ error: "Ingen behörighet." }, { status: 403 });
      const result = await db.from("ticket_events").insert({ ticket_id: id, actor_id: user.id, kind: "message", body: message, visibility });
      dbError(result.error);
    } else if (body.action === "visit") {
      if (user.role === "tenant") return NextResponse.json({ error: "Ingen behörighet." }, { status: 403 });
      if (typeof body.visitAt !== "string" || !body.visitAt || Number.isNaN(Date.parse(body.visitAt))) return NextResponse.json({ error: "Ogiltig besökstid." }, { status: 400 });
      patch = { visit_at: new Date(body.visitAt).toISOString() };
    } else return NextResponse.json({ error: "Okänd åtgärd." }, { status: 400 });
    if (patch) {
      const result = await db.from("tickets").update(patch).eq("id", id).select("id");
      dbError(result.error);
      if (!result.data?.length) return NextResponse.json({ error: "Ärendet kunde inte ändras." }, { status: 409 });
    }
    const updated = await getTicketWithAccess(db, id);
    return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Ärendet hittades inte." }, { status: 404 });
  } catch (error) { return serverError(error); }
}
