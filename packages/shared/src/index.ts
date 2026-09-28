export type Role = "tenant" | "admin" | "worker";
export type TicketStatus = "received" | "assigned" | "in_progress" | "waiting" | "resolved" | "closed";
export type Priority = "low" | "normal" | "high";
export type Category = "VVS" | "El" | "Vitvaror" | "Värme" | "Övrigt";

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  unitId?: string;
}

export interface Building {
  id: string;
  organizationId: string;
  name: string;
  address: string;
}

export interface Unit {
  id: string;
  buildingId: string;
  label: string;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  actorId: string;
  kind: "created" | "assigned" | "status" | "message" | "visit";
  body: string;
  visibility: "public" | "internal";
  createdAt: string;
}

export interface TicketAttachment {
  id: string;
  ticketId: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  organizationId: string;
  unitId: string;
  tenantId: string;
  assigneeId: string | null;
  title: string;
  category: Category;
  description: string;
  priority: Priority;
  status: TicketStatus;
  visitAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: TicketEvent[];
  attachments: TicketAttachment[];
}

export interface Notice {
  id: string;
  organizationId: string;
  buildingId: string | null;
  title: string;
  body: string;
  publishedAt: string;
}

export interface Dashboard {
  user: User;
  users: User[];
  buildings: Building[];
  units: Unit[];
  tickets: Ticket[];
  notices: Notice[];
}

export const statusLabel: Record<TicketStatus, string> = {
  received: "Mottaget",
  assigned: "Tilldelat",
  in_progress: "Pågår",
  waiting: "Väntar på kund",
  resolved: "Åtgärdat",
  closed: "Avslutat",
};

export const roleLabel: Record<Role, string> = {
  tenant: "Boende",
  admin: "Förvaltare",
  worker: "Arbetare",
};

export const categories: Category[] = ["VVS", "El", "Vitvaror", "Värme", "Övrigt"];

export function ticketNumber(id: string) {
  return `#${id.slice(-4).toUpperCase()}`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
