import assert from "node:assert/strict";

const base = process.env.MITTBO_TEST_URL || "http://localhost:3001";
const password = process.env.MITTBO_TEST_PASSWORD || "MittBo2026!";

async function call(path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path} returned HTTP ${response.status} with non-JSON body: ${raw.slice(0, 150)}`); }
  return { status: response.status, data };
}

async function login(email) {
  const result = await call("/api/login", undefined, { email, password });
  assert.equal(result.status, 200, `Login failed for ${email}: ${JSON.stringify(result.data)}`);
  assert.ok(result.data.token);
  return result.data.token;
}

const tenant = await login("emma@demo.mittbo.se");
const admin = await login("admin@demo.mittbo.se");
const worker = await login("arbetare@demo.mittbo.se");
const otherTenant = await login("lina@demo.mittbo.se");
const otherAdmin = await login("sara@demo.mittbo.se");

const initial = await call("/api/dashboard", tenant);
assert.equal(initial.status, 200);
assert.equal(initial.data.user.email, "emma@demo.mittbo.se");
assert.ok(initial.data.buildings.every((building) => building.organizationId === initial.data.user.organizationId));

const created = await call("/api/tickets", tenant, { title: `Test av läckande kran ${Date.now()}`, category: "VVS", description: "Kranen läcker hela natten." });
assert.equal(created.status, 201, JSON.stringify(created.data));
const id = created.data.id;
assert.ok(id);
assert.equal(created.data.events[0].kind, "created");

const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const started = await call(`/api/tickets/${id}/attachments/init`, tenant, { filename: "test.png", contentType: "image/png", size: imageBytes.length });
assert.equal(started.status, 200, JSON.stringify(started.data));
const form = new FormData();
form.append("cacheControl", "3600");
form.append("", new Blob([imageBytes], { type: "image/png" }), "test.png");
const sent = await fetch(started.data.signedUrl, { method: "PUT", body: form });
assert.ok(sent.ok, `Storage upload failed: ${sent.status} ${await sent.text()}`);
const upload = await call(`/api/tickets/${id}/attachments`, tenant, { uploadId: started.data.uploadId, filename: "test.png", contentType: "image/png", size: imageBytes.length });
assert.equal(upload.status, 201, JSON.stringify(upload.data));
const attachmentId = upload.data.id;
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${tenant}` } })).status, 200);
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${otherTenant}` } })).status, 404);
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${worker}` } })).status, 404);

const adminDashboard = await call("/api/dashboard", admin);
assert.ok(adminDashboard.data.tickets.some((ticket) => ticket.id === id));
const workerId = adminDashboard.data.users.find((user) => user.email === "arbetare@demo.mittbo.se")?.id;
assert.ok(workerId);
const workerBefore = await call("/api/dashboard", worker);
assert.ok(!workerBefore.data.tickets.some((ticket) => ticket.id === id));
const otherDashboard = await call("/api/dashboard", otherTenant);
assert.ok(!otherDashboard.data.tickets.some((ticket) => ticket.id === id));
assert.ok(otherDashboard.data.buildings.every((building) => building.organizationId !== initial.data.user.organizationId));

assert.equal((await call(`/api/tickets/${id}`, tenant, { action: "assign", assigneeId: workerId })).status, 403);
assert.equal((await call(`/api/tickets/${id}`, otherAdmin, { action: "assign", assigneeId: workerId })).status, 404);
assert.equal((await call(`/api/tickets/${id}`, admin, { action: "assign", assigneeId: workerId })).status, 200);

const workerAfter = await call("/api/dashboard", worker);
assert.ok(workerAfter.data.tickets.some((ticket) => ticket.id === id));
assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${worker}` } })).status, 200);
assert.equal((await call(`/api/tickets/${id}`, worker, { action: "message", text: "Reservdel behövs.", visibility: "internal" })).status, 200);
const tenantAfter = await call("/api/dashboard", tenant);
assert.ok(!tenantAfter.data.tickets.find((ticket) => ticket.id === id).events.some((event) => event.body === "Reservdel behövs."));
assert.ok((await call("/api/dashboard", admin)).data.tickets.find((ticket) => ticket.id === id).events.some((event) => event.body === "Reservdel behövs."));
assert.equal((await call(`/api/tickets/${id}`, tenant, { action: "message", text: "Hemlig anteckning", visibility: "internal" })).status, 403);

assert.equal((await call(`/api/tickets/${id}`, worker, { action: "status", status: "in_progress" })).status, 200);
assert.equal((await call(`/api/tickets/${id}`, worker, { action: "status", status: "resolved" })).status, 200);
assert.equal((await call("/api/dashboard", tenant)).data.tickets.find((ticket) => ticket.id === id).status, "resolved");
assert.equal((await call(`/api/tickets/${id}`, tenant, { action: "status", status: "closed" })).status, 200);
assert.equal((await call("/api/dashboard", tenant)).data.tickets.find((ticket) => ticket.id === id).status, "closed");

const otherCreated = await call("/api/tickets", otherTenant, { title: "Test i andra organisationen", category: "El", description: "Lampan i hallen fungerar inte." });
assert.equal(otherCreated.status, 201);
assert.equal((await call(`/api/tickets/${otherCreated.data.id}`, tenant, { action: "message", text: "Ska inte fungera" })).status, 404);
assert.ok(!(await call("/api/dashboard", admin)).data.tickets.some((ticket) => ticket.id === otherCreated.data.id));

console.log("PASS: Auth, dashboards, ticket lifecycle, role permissions, organization isolation, internal notes, signed image upload and protected retrieval");
