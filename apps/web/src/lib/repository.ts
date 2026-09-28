import type { SupabaseClient } from "@supabase/supabase-js";
import type { Building, Dashboard, Notice, Ticket, TicketAttachment, TicketEvent, Unit, User, Role } from "@mittbo/shared";

type Row = Record<string, unknown>;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function dbError(error: { message: string } | null) {
  if (error) throw new Error(`Databasfel: ${error.message}`);
}

function profile(row: Row): User {
  return { id: row.id as string, organizationId: row.organization_id as string, unitId: (row.unit_id as string | null) || undefined, role: row.role as Role, name: row.name as string, email: row.email as string };
}
function building(row: Row): Building { return { id: row.id as string, organizationId: row.organization_id as string, name: row.name as string, address: row.address as string }; }
function unit(row: Row): Unit { return { id: row.id as string, buildingId: row.building_id as string, label: row.label as string }; }
function notice(row: Row): Notice { return { id: row.id as string, organizationId: row.organization_id as string, buildingId: row.building_id as string | null, title: row.title as string, body: row.body as string, publishedAt: row.published_at as string }; }
function event(row: Row): TicketEvent { return { id: row.id as string, ticketId: row.ticket_id as string, actorId: row.actor_id as string, kind: row.kind as TicketEvent["kind"], body: row.body as string, visibility: row.visibility as TicketEvent["visibility"], createdAt: row.created_at as string }; }
export function attachment(row: Row): TicketAttachment { return { id: row.id as string, ticketId: row.ticket_id as string, filename: row.filename as string, contentType: row.mime_type as string, size: Number(row.size), uploadedBy: row.uploaded_by as string, createdAt: row.created_at as string }; }
function ticket(row: Row, events: TicketEvent[], attachments: TicketAttachment[]): Ticket {
  return { id: row.id as string, organizationId: row.organization_id as string, unitId: row.unit_id as string, tenantId: row.tenant_id as string, assigneeId: row.assignee_id as string | null, title: row.title as string, category: row.category as Ticket["category"], description: row.description as string, priority: row.priority as Ticket["priority"], status: row.status as Ticket["status"], visitAt: row.visit_at as string | null, createdAt: row.created_at as string, updatedAt: row.updated_at as string, events, attachments };
}

export async function getTicketWithAccess(db: SupabaseClient, id: string): Promise<Ticket | null> {
  if (!uuidPattern.test(id)) return null;
  const { data, error } = await db.from("tickets").select("*").eq("id", id).maybeSingle();
  dbError(error);
  if (!data) return null;
  const [events, attachments] = await Promise.all([
    db.from("ticket_events").select("*").eq("ticket_id", id).order("created_at"),
    db.from("ticket_attachments").select("*").eq("ticket_id", id).order("created_at"),
  ]);
  dbError(events.error); dbError(attachments.error);
  return ticket(data, (events.data || []).map(event), (attachments.data || []).map(attachment));
}

export async function getDashboardForUser(db: SupabaseClient, user: User): Promise<Dashboard> {
  // RLS is the primary filter; explicit organization filters avoid requesting unrelated rows.
  const [people, buildings, units, tickets, events, attachments, notices] = await Promise.all([
    db.from("profiles").select("*").eq("organization_id", user.organizationId),
    db.from("buildings").select("*").eq("organization_id", user.organizationId),
    db.from("units").select("*, buildings!inner(organization_id)").eq("buildings.organization_id", user.organizationId),
    db.from("tickets").select("*").eq("organization_id", user.organizationId).order("created_at", { ascending: false }),
    db.from("ticket_events").select("*").order("created_at"),
    db.from("ticket_attachments").select("*").order("created_at"),
    db.from("notices").select("*").eq("organization_id", user.organizationId).order("published_at", { ascending: false }),
  ]);
  for (const response of [people, buildings, units, tickets, events, attachments, notices]) dbError(response.error);
  const eventMap = new Map<string, TicketEvent[]>();
  for (const row of events.data || []) { const value = event(row); eventMap.set(value.ticketId, [...(eventMap.get(value.ticketId) || []), value]); }
  const attachmentMap = new Map<string, TicketAttachment[]>();
  for (const row of attachments.data || []) { const value = attachment(row); attachmentMap.set(value.ticketId, [...(attachmentMap.get(value.ticketId) || []), value]); }
  return { user, users: (people.data || []).map(profile), buildings: (buildings.data || []).map(building), units: (units.data || []).map(unit), tickets: (tickets.data || []).map((row) => ticket(row, eventMap.get(row.id) || [], attachmentMap.get(row.id) || [])), notices: (notices.data || []).map(notice) };
}
