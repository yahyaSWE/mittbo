import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Ange NEXT_PUBLIC_SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY innan seed.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const password = process.env.MITTBO_DEMO_PASSWORD || "MittBo2026!";
const ids = {
  solen: "11111111-1111-4111-8111-111111111111",
  bjorken: "22222222-2222-4222-8222-222222222222",
  buildingSolen: "11111111-1111-4111-8111-111111111112",
  buildingBjorken: "22222222-2222-4222-8222-222222222223",
  unitEmma: "11111111-1111-4111-8111-111111111113",
  unitLina: "22222222-2222-4222-8222-222222222224",
  ticket: "11111111-1111-4111-8111-111111111114",
  noticeSolen: "11111111-1111-4111-8111-111111111115",
  noticeBjorken: "22222222-2222-4222-8222-222222222225",
};

function checked({ error }, label) { if (error) throw new Error(`${label}: ${error.message}`); }

checked(await db.from("organizations").upsert([
  { id: ids.solen, name: "Kvarteret Solen" }, { id: ids.bjorken, name: "Björken" },
]), "organizations");
checked(await db.from("buildings").upsert([
  { id: ids.buildingSolen, organization_id: ids.solen, name: "Kvarteret Solen", address: "Storgatan 12, Stockholm" },
  { id: ids.buildingBjorken, organization_id: ids.bjorken, name: "Björken", address: "Parkvägen 20, Uppsala" },
]), "buildings");
checked(await db.from("units").upsert([
  { id: ids.unitEmma, building_id: ids.buildingSolen, label: "Lägenhet 3-1202" },
  { id: ids.unitLina, building_id: ids.buildingBjorken, label: "Lägenhet 2-01" },
]), "units");

const people = [
  { email: "emma@demo.mittbo.se", name: "Emma Andersson", role: "tenant", organization_id: ids.solen, unit_id: ids.unitEmma },
  { email: "admin@demo.mittbo.se", name: "Johan Karlsson", role: "admin", organization_id: ids.solen, unit_id: null },
  { email: "arbetare@demo.mittbo.se", name: "Alex Nilsson", role: "worker", organization_id: ids.solen, unit_id: null },
  { email: "lina@demo.mittbo.se", name: "Lina Berg", role: "tenant", organization_id: ids.bjorken, unit_id: ids.unitLina },
  { email: "sara@demo.mittbo.se", name: "Sara Holm", role: "admin", organization_id: ids.bjorken, unit_id: null },
];
const authUsers = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  for (const user of data.users) authUsers.set(user.email?.toLowerCase(), user.id);
  if (data.users.length < 1000) break;
}
const userIds = new Map();
for (const person of people) {
  let id = authUsers.get(person.email);
  if (id) {
    const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (error) throw error;
  } else {
    const { data, error } = await db.auth.admin.createUser({ email: person.email, password, email_confirm: true });
    if (error || !data.user) throw error || new Error(`Kunde inte skapa ${person.email}`);
    id = data.user.id;
  }
  userIds.set(person.email, id);
  checked(await db.from("profiles").upsert({ id, ...person }), `profile ${person.email}`);
  console.log(`Klar: ${person.email}`);
}

checked(await db.from("tickets").upsert({
  id: ids.ticket, organization_id: ids.solen, unit_id: ids.unitEmma,
  tenant_id: userIds.get("emma@demo.mittbo.se"), assignee_id: userIds.get("arbetare@demo.mittbo.se"),
  title: "Kökskran läcker", category: "VVS", description: "Kranen droppar även när den är avstängd.",
  priority: "normal", status: "assigned",
}, { onConflict: "id", ignoreDuplicates: true }), "demo ticket");
const assignedEvent = await db.from("ticket_events").select("id").eq("ticket_id", ids.ticket).eq("kind", "assigned").limit(1);
checked(assignedEvent, "demo assignment lookup");
if (!assignedEvent.data?.length) checked(await db.from("ticket_events").insert({
  ticket_id: ids.ticket, actor_id: userIds.get("admin@demo.mittbo.se"), kind: "assigned",
  body: "Tilldelat Alex Nilsson", visibility: "public",
}), "demo assignment");
checked(await db.from("notices").upsert([
  { id: ids.noticeSolen, organization_id: ids.solen, building_id: ids.buildingSolen, title: "Planerat arbete i fastigheten", body: "Stamspolning sker nästa vecka kl. 08.00–16.00. Tack för att du håller utrymmet under diskbänken fritt." },
  { id: ids.noticeBjorken, organization_id: ids.bjorken, building_id: ids.buildingBjorken, title: "Gårdsarbete", body: "Vi ser över planteringar nästa vecka." },
]), "notices");
console.log("Demodata skapad. Använd endast dessa lösenord i en testmiljö.");
