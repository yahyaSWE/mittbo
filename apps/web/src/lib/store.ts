import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Building, Notice, Ticket, Unit, User } from "@mittbo/shared";

export interface StoredUser extends User { passwordHash: string }
export interface Store {
  users: StoredUser[];
  buildings: Building[];
  units: Unit[];
  tickets: Ticket[];
  notices: Notice[];
}

export const dataDir = process.env.MITTBO_DATA_DIR ? path.resolve(process.env.MITTBO_DATA_DIR) : path.resolve(process.cwd(), "../../data");
const dataFile = path.join(dataDir, "mittbo.json");
let queue: Promise<unknown> = Promise.resolve();

export function hashPassword(password: string, salt: string) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function checkPassword(password: string, hash: string) {
  const [salt, expected] = hash.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

function seed(): Store {
  const passwordHash = hashPassword("MittBo2026!", "mittbo-local-demo");
  const organizationId = "org-solen";
  const otherOrganizationId = "org-andra";
  const now = new Date().toISOString();
  const users: StoredUser[] = [
    { id: "u-emma", organizationId, unitId: "unit-1202", role: "tenant", name: "Emma Andersson", email: "emma@demo.mittbo.se", passwordHash },
    { id: "u-johan", organizationId, role: "admin", name: "Johan Karlsson", email: "admin@demo.mittbo.se", passwordHash },
    { id: "u-alex", organizationId, role: "worker", name: "Alex Nilsson", email: "arbetare@demo.mittbo.se", passwordHash },
    { id: "u-lina", organizationId: otherOrganizationId, unitId: "unit-201", role: "tenant", name: "Lina Berg", email: "lina@demo.mittbo.se", passwordHash },
    { id: "u-sara", organizationId: otherOrganizationId, role: "admin", name: "Sara Holm", email: "sara@demo.mittbo.se", passwordHash },
  ];
  const buildings: Building[] = [
    { id: "building-12", organizationId, name: "Kvarteret Solen", address: "Storgatan 12, Stockholm" },
    { id: "building-20", organizationId: otherOrganizationId, name: "Björken", address: "Parkvägen 20, Uppsala" },
  ];
  const units: Unit[] = [
    { id: "unit-1202", buildingId: "building-12", label: "Lägenhet 3-1202" },
    { id: "unit-201", buildingId: "building-20", label: "Lägenhet 2-01" },
  ];
  const tickets: Ticket[] = [
    {
      id: "ticket-1842", organizationId, unitId: "unit-1202", tenantId: "u-emma", assigneeId: "u-alex",
      title: "Kökskran läcker", category: "VVS", description: "Kranen droppar även när den är avstängd.",
      priority: "normal", status: "assigned", visitAt: null, createdAt: now, updatedAt: now,
      events: [
        { id: randomUUID(), ticketId: "ticket-1842", actorId: "u-emma", kind: "created", body: "Kranen droppar även när den är avstängd.", visibility: "public", createdAt: now },
        { id: randomUUID(), ticketId: "ticket-1842", actorId: "u-johan", kind: "assigned", body: "Tilldelat Alex Nilsson", visibility: "public", createdAt: now },
      ],
      attachments: [],
    },
  ];
  const notices: Notice[] = [
    { id: "notice-1", organizationId, buildingId: "building-12", title: "Planerat arbete i fastigheten", body: "Stamspolning sker nästa vecka kl. 08.00–16.00. Tack för att du håller utrymmet under diskbänken fritt.", publishedAt: now },
    { id: "notice-2", organizationId: otherOrganizationId, buildingId: "building-20", title: "Gårdsarbete", body: "Vi ser över planteringar nästa vecka.", publishedAt: now },
  ];
  return { users, buildings, units, tickets, notices };
}

async function readStore(): Promise<Store> {
  await mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(dataFile, "utf8")) as Store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const initial = seed();
    await writeFile(dataFile, JSON.stringify(initial, null, 2), { flag: "wx" });
    return initial;
  }
}

export function withStore<T>(operation: (store: Store) => Promise<T> | T, save = false): Promise<T> {
  const result = queue.then(async () => {
    const store = await readStore();
    const value = await operation(store);
    if (save) {
      const temporary = `${dataFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(store, null, 2));
      await rename(temporary, dataFile);
    }
    return value;
  });
  queue = result.then(() => undefined, () => undefined);
  return result;
}
