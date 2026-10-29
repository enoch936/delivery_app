import assert from "node:assert/strict";
import test from "node:test";
import { api, closeTracking, createSession, createTestApp, databaseUrl, openTracking, placeOrder, randomPhone } from "./support.js";

test("customer E2E: catalog, cart, quote, order creation and live tracking", { skip: !databaseUrl }, async (t) => {
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const phoneE164 = randomPhone();
  const session = await createSession(app, phoneE164);
  assert.ok(session.user.roles.includes("customer"));

  const placed = await placeOrder(app, session, phoneE164);
  assert.equal(placed.status, "CONFIRMED");
  assert.match(placed.orderNumber, /^D-\d{6}-[A-Z0-9]{8}$/);

  const list = await api(app, "GET", "/api/v1/orders?limit=20", { token: session.accessToken });
  assert.equal(list.statusCode, 200, list.body);
  assert.ok((list.json().items as Array<{ id: string }>).some((item) => item.id === placed.orderId));

  const detail = await api(app, "GET", `/api/v1/orders/${placed.orderId}`, { token: session.accessToken });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().id, placed.orderId);
  assert.equal(detail.json().status, "CONFIRMED");
  assert.equal(detail.json().merchant.id, placed.merchantId);

  const tracking = await api(app, "GET", `/api/v1/tracking/${placed.orderId}`, { token: session.accessToken });
  assert.equal(tracking.statusCode, 200, tracking.body);
  assert.equal(tracking.json().orderId, placed.orderId);
  assert.equal(tracking.json().orderNumber, placed.orderNumber);
  assert.equal(tracking.json().status, "CONFIRMED");
  assert.ok(Array.isArray(tracking.json().timeline));

  const { socket, message } = await openTracking(baseUrl, placed.orderId, session.accessToken);
  await closeTracking(socket);
  assert.equal(message.type, "snapshot");
  const snapshot = message.data as { orderId: string; status: string };
  assert.equal(snapshot.orderId, placed.orderId);
  assert.equal(snapshot.status, "CONFIRMED");
});
