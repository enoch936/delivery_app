import assert from "node:assert/strict";
import test from "node:test";
import { api, createSession, createTestApp, databaseUrl, placeOrder, randomPhone } from "./support.js";

test("dispatch race: concurrent offers cannot create conflicting active assignments", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => { await app.close(); });

  const owner = await createSession(app, randomPhone());
  const placed = await placeOrder(app, owner, ownerPhone());

  // Simulate two dispatch attempts racing for the same order
  const [first, second] = await Promise.all([
    api(app, "POST", "/api/v1/dispatch/offer", { token: owner.accessToken, payload: { orderId: placed.orderId } }),
    api(app, "POST", "/api/v1/dispatch/offer", { token: owner.accessToken, payload: { orderId: placed.orderId } }),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();
  assert.ok(statuses.includes(200), "At least one dispatch offer should succeed");
  assert.ok(statuses.includes(409), "The racing dispatch offer should be rejected with 409 Conflict");

  const assignments = await api(app, "GET", "/api/v1/dispatch/assignments", { token: owner.accessToken });
  assert.equal(assignments.statusCode, 200, assignments.body);
  const items = assignments.json().items as Array<{ orderId: string; status: string }>;
  const active = items.filter((a) => a.orderId === placed.orderId && a.status === "offered");
  assert.equal(active.length, 1, "Only one active assignment should exist for the order");
});

function ownerPhone(): string {
  return randomPhone();
}
