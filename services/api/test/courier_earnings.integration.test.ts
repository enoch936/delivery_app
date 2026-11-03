import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseService } from "../src/database/database.service.js";
import { api, createSession, createTestApp, databaseUrl, randomPhone } from "./support.js";

test("courier can file an earnings dispute and see it listed", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => { await app.close(); });
  const db = app.get(DatabaseService);

  const courierUser = await createSession(app, randomPhone());
  await db.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1, 'courier') ON CONFLICT DO NOTHING", [courierUser.user.id]);
  await db.query(
    `INSERT INTO courier_profiles (user_id, status, full_name, vehicle_type)
     VALUES ($1, 'approved', 'Dispute Courier', 'motorcycle')
     ON CONFLICT (user_id) DO UPDATE SET status = 'approved'`,
    [courierUser.user.id]
  );

  const create = await api(app, "POST", "/api/v1/courier/earnings/disputes", {
    token: courierUser.accessToken,
    payload: {
      subject: "Missing earning",
      message: "The delivery completed but the earning is not reflected in my payout.",
    },
  });
  assert.equal(create.statusCode, 201, create.body);
  assert.equal(create.json().status, "OPEN");

  const list = await api(app, "GET", "/api/v1/courier/earnings/disputes", {
    token: courierUser.accessToken,
  });
  assert.equal(list.statusCode, 200, list.body);
  const items = list.json().items as Array<{ subject: string; status: string; messageCount: number }>;
  assert.equal(items.length, 1, list.body);
  assert.equal(items[0]?.subject, "Missing earning");
  assert.equal(items[0]?.status, "OPEN");
  assert.equal(items[0]?.messageCount, 1);
});

test("earnings dispute creation rejects unsupported roles and empty messages", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => { await app.close(); });
  const db = app.get(DatabaseService);

  const courierOnly = await createSession(app, randomPhone());
  await db.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1, 'courier') ON CONFLICT DO NOTHING", [courierOnly.user.id]);
  await db.query(
    `INSERT INTO courier_profiles (user_id, status, full_name, vehicle_type)
     VALUES ($1, 'approved', 'Dispute Courier 2', 'motorcycle')
     ON CONFLICT (user_id) DO UPDATE SET status = 'approved'`,
    [courierOnly.user.id]
  );

  const emptyMessage = await api(app, "POST", "/api/v1/courier/earnings/disputes", {
    token: courierOnly.accessToken,
    payload: { subject: "Missing earning", message: "" },
  });
  assert.equal(emptyMessage.statusCode, 400, emptyMessage.body);

  const customer = await createSession(app, randomPhone());
  const forbidden = await api(app, "POST", "/api/v1/courier/earnings/disputes", {
    token: customer.accessToken,
    payload: { subject: "Not my dispute", message: "This should be rejected." },
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
});
