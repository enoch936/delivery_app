import assert from "node:assert/strict";
import test from "node:test";
import { api, createSession, createTestApp, databaseUrl, openTracking, placeOrder, randomPhone, trackingUpgradeStatus } from "./support.js";

test("authorization isolation: customers cannot read, cancel, track, or modify another customer's order", { skip: !databaseUrl }, async (t) => {
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const ownerPhone = randomPhone();
  const owner = await createSession(app, ownerPhone);
  const placed = await placeOrder(app, owner, ownerPhone);

  const intruderSession = await createSession(app, randomPhone());
  assert.notEqual(intruderSession.user.id, owner.user.id);

  const ownerTracking = await api(app, "GET", `/api/v1/tracking/${placed.orderId}`, { token: owner.accessToken });
  assert.equal(ownerTracking.statusCode, 200, ownerTracking.body);

  const ownerDetail = await api(app, "GET", `/api/v1/orders/${placed.orderId}`, { token: owner.accessToken });
  assert.equal(ownerDetail.statusCode, 200, ownerDetail.body);
  assert.equal(ownerDetail.json().capabilities.isOwner, true);

  const intruderDetail = await api(app, "GET", `/api/v1/orders/${placed.orderId}`, { token: intruderSession.accessToken });
  assert.equal(intruderDetail.statusCode, 404, intruderDetail.body);

  const intruderTracking = await api(app, "GET", `/api/v1/tracking/${placed.orderId}`, { token: intruderSession.accessToken });
  assert.equal(intruderTracking.statusCode, 403, intruderTracking.body);

  const intruderCancel = await api(app, "POST", `/api/v1/orders/${placed.orderId}/cancel`, {
    token: intruderSession.accessToken,
    payload: { reason: "Attempting cross-customer cancellation" }
  });
  assert.equal(intruderCancel.statusCode, 404, intruderCancel.body);

  const intruderAddressUpdate = await api(app, "PATCH", `/api/v1/addresses/${placed.addressId}`, {
    token: intruderSession.accessToken,
    payload: { label: "Hijacked address" }
  });
  assert.equal(intruderAddressUpdate.statusCode, 404, intruderAddressUpdate.body);

  const intruderAddresses = await api(app, "GET", "/api/v1/addresses", { token: intruderSession.accessToken });
  assert.equal(intruderAddresses.statusCode, 200, intruderAddresses.body);
  assert.deepEqual(intruderAddresses.json().items, []);

  const anonymousTracking = await api(app, "GET", `/api/v1/tracking/${placed.orderId}`);
  assert.equal(anonymousTracking.statusCode, 401, anonymousTracking.body);

  const anonymousDetail = await api(app, "GET", `/api/v1/orders/${placed.orderId}`);
  assert.equal(anonymousDetail.statusCode, 401, anonymousDetail.body);

  assert.equal(await trackingUpgradeStatus(baseUrl, placed.orderId), 401);
  assert.equal(await trackingUpgradeStatus(baseUrl, placed.orderId, intruderSession.accessToken), 403);
  assert.equal(await trackingUpgradeStatus(baseUrl, placed.orderId, owner.accessToken), 101);

  const { socket, message } = await openTracking(baseUrl, placed.orderId, owner.accessToken);
  socket.terminate();
  assert.equal((message.data as { orderId: string }).orderId, placed.orderId);
});

test("authorization isolation: customer sessions cannot use courier or admin operations", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const customer = await createSession(app, randomPhone());

  const courierLocation = await api(app, "POST", "/api/v1/courier/location", {
    token: customer.accessToken,
    payload: { latitude: 9.03, longitude: 38.74, accuracyMeters: 10 }
  });
  assert.equal(courierLocation.statusCode, 403, courierLocation.body);

  const courierProfile = await api(app, "GET", "/api/v1/courier/me", { token: customer.accessToken });
  assert.equal(courierProfile.statusCode, 403, courierProfile.body);

  const adminDashboard = await api(app, "GET", "/api/v1/admin/dashboard", { token: customer.accessToken });
  assert.equal(adminDashboard.statusCode, 403, adminDashboard.body);

  const merchantProfile = await api(app, "GET", "/api/v1/merchant/me", { token: customer.accessToken });
  assert.equal(merchantProfile.statusCode, 403, merchantProfile.body);

  const settlements = await api(app, "GET", "/api/v1/admin/settlements/merchants", { token: customer.accessToken });
  assert.equal(settlements.statusCode, 403, settlements.body);

  const reconciliation = await api(app, "GET", "/api/v1/admin/reconciliation/summary", { token: customer.accessToken });
  assert.equal(reconciliation.statusCode, 403, reconciliation.body);

  const reconciliationRun = await api(app, "POST", "/api/v1/admin/reconciliation/payments/run", {
    token: customer.accessToken, payload: { limit: 5 }
  });
  assert.equal(reconciliationRun.statusCode, 403, reconciliationRun.body);
});
