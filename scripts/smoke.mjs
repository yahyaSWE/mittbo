import assert from "node:assert/strict";

const base = process.env.MITTBO_TEST_URL || "http://localhost:3001";
const password = "MittBo2026!";

async function call(path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

async function login(email) {
  const result = await call("/api/login", undefined, { email, password });
  assert.equal(result.status, 200, `Login failed for ${email}`);
  return result.data.token;
}

const tenant = await login("emma@demo.mittbo.se");
const admin = await login("admin@demo.mittbo.se");
const worker = await login("arbetare@demo.mittbo.se");
const otherTenant = await login("lina@demo.mittbo.se");
const otherAdmin = await login("sara@demo.mittbo.se");

const created = await call("/api/tickets", tenant, { title: "Test av läckande kran", category: "VVS", description: "Kranen läcker hela natten." });
assert.equal(created.status, 201);
const id = created.data.id;
assert.ok(id);

const image = new FormData();
image.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "test.png");
const upload = await fetch(`${base}/api/tickets/${id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${tenant}` }, body: image });
assert.equal(upload.status, 201);
const attachmentId = (await upload.json()).id;
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${tenant}` } })).status, 200);
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${otherTenant}` } })).status, 404);
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${worker}` } })).status, 404);

const adminDashboard = await call("/api/dashboard", admin);
assert.ok(adminDashboard.data.tickets.some((ticket) => ticket.id === id));
const workerBefore = await call("/api/dashboard", worker);
assert.ok(!workerBefore.data.tickets.some((ticket) => ticket.id === id));
const otherDashboard = await call("/api/dashboard", otherTenant);
assert.ok(!otherDashboard.data.tickets.some((ticket) => ticket.id === id));

assert.equal((await call(`/api/tickets/${id}`, tenant, { action: "assign", assigneeId: "u-alex" })).status, 403);
assert.equal((await call(`/api/tickets/${id}`, otherAdmin, { action: "assign", assigneeId: "u-alex" })).status, 404);
assert.equal((await call(`/api/tickets/${id}`, admin, { action: "assign", assigneeId: "u-alex" })).status, 200);

const workerAfter = await call("/api/dashboard", worker);
assert.ok(workerAfter.data.tickets.some((ticket) => ticket.id === id));
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${worker}` } })).status, 200);
assert.equal((await call(`/api/tickets/${id}`, worker, { action: "message", text: "Reservdel behövs.", visibility: "internal" })).status, 200);
const tenantAfter = await call("/api/dashboard", tenant);
assert.ok(!tenantAfter.data.tickets.find((ticket) => ticket.id === id).events.some((event) => event.body === "Reservdel behövs."));

assert.equal((await call(`/api/tickets/${id}`, worker, { action: "status", status: "in_progress" })).status, 200);
assert.equal((await call(`/api/tickets/${id}`, worker, { action: "status", status: "resolved" })).status, 200);
assert.equal((await call(`/api/tickets/${id}`, tenant, { action: "status", status: "closed" })).status, 200);
const final = await call("/api/dashboard", tenant);
assert.equal(final.data.tickets.find((ticket) => ticket.id === id).status, "closed");

console.log("PASS: login, ticket lifecycle, role permissions, tenant isolation, internal messages, protected images");
