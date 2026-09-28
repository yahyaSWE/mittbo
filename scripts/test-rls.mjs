import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.MITTBO_TEST_PASSWORD || process.env.MITTBO_DEMO_PASSWORD || "MittBo2026!";
if (!url || !key) throw new Error("Ange NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_ANON_KEY.");

async function client(email) {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return db;
}
async function rows(db, table) {
  const { data, error } = await db.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

const emma = await client("emma@demo.mittbo.se");
const admin = await client("admin@demo.mittbo.se");
const worker = await client("arbetare@demo.mittbo.se");
const lina = await client("lina@demo.mittbo.se");
const emmaProfile = (await rows(emma, "profiles"))[0];
const linaProfile = (await rows(lina, "profiles"))[0];
const workerProfile = (await rows(worker, "profiles")).find((p) => p.email === "arbetare@demo.mittbo.se");
assert.equal((await rows(emma, "profiles")).length, 1, "Tenant must see only own profile");
assert.notEqual(emmaProfile.organization_id, linaProfile.organization_id);
assert.ok((await rows(admin, "profiles")).every((row) => row.organization_id === emmaProfile.organization_id));
assert.ok((await rows(emma, "units")).every((row) => row.id === emmaProfile.unit_id));
assert.ok((await rows(emma, "buildings")).every((row) => row.organization_id === emmaProfile.organization_id));
assert.ok((await rows(emma, "tickets")).every((row) => row.tenant_id === emmaProfile.id));
assert.ok(workerProfile);
assert.ok((await rows(worker, "tickets")).every((row) => row.assignee_id === workerProfile.id));
assert.ok((await rows(lina, "tickets")).every((row) => row.organization_id === linaProfile.organization_id));
assert.ok((await rows(emma, "ticket_events")).every((row) => row.visibility === "public"));
const foreign = await emma.from("tickets").select("id").eq("organization_id", linaProfile.organization_id);
assert.equal(foreign.data?.length, 0);
assert.equal(foreign.error, null);
const forged = await emma.from("tickets").insert({
  organization_id: linaProfile.organization_id, unit_id: linaProfile.unit_id, tenant_id: emmaProfile.id,
  title: "Otillåtet ärende", category: "El", description: "Ska nekas av RLS.",
});
assert.ok(forged.error, "Cross-organization insert must fail");
console.log("PASS: direct Supabase RLS separates organizations, profiles, units, tickets and internal events");
