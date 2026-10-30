import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseService } from "../src/database/database.service.js";
import { api, createSession, createTestApp, databaseUrl, placeOrder, randomPhone } from "./support.js";

test("dispatch race: concurrent offers cannot create conflicting active assignments", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => { await app.close(); });
  const db = app.get(DatabaseService);

  const adminUser = await createSession(app, randomPhone());
  await db.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [adminUser.user.id]);
  const admin = await createSession(app, adminUser.user.phoneE164);

  const courierUser = await createSession(app, randomPhone());
  await db.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1, 'courier') ON CONFLICT DO NOTHING", [courierUser.user.id]);
  await db.query(
    `INSERT INTO courier_profiles (user_id, status, full_name, vehicle_type)
     VALUES ($1, 'approved', 'Race Courier', 'motorcycle')
     ON CONFLICT (user_id) DO UPDATE SET status = 'approved'`,
    [courierUser.user.id]
  );
  await db.query(
    `INSERT INTO courier_availability (courier_user_id, is_online, accepting_offers, last_location, last_seen_at)
     VALUES ($1, true, true, ST_SetSRID(ST_MakePoint(38.779, 9.021), 4326), now())
     ON CONFLICT (courier_user_id) DO UPDATE
     SET is_online = true, accepting_offers = true, last_location = EXCLUDED.last_location, last_seen_at = now(), active_order_id = NULL`,
    [courierUser.user.id]
  );

  const owner = await createSession(app, randomPhone());
  const placed = await placeOrder(app, owner, owner.user.phoneE164);
  await db.query("UPDATE orders SET status = 'READY_FOR_PICKUP' WHERE id = $1", [placed.orderId]);

  const [first, second] = await Promise.all([
    api(app, "POST", `/api/v1/admin/dispatch/orders/${placed.orderId}/offer`, { token: admin.accessToken }),
    api(app, "POST", `/api/v1/admin/dispatch/orders/${placed.orderId}/offer`, { token: admin.accessToken })
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();
  assert.ok(statuses.includes(201), `At least one dispatch offer should succeed: ${first.body} ${second.body}`);
  assert.ok(statuses.includes(409), `The racing dispatch offer should be rejected with 409 Conflict: ${first.body} ${second.body}`);

  const assignments = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM delivery_assignments WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup','picked_up')",
    [placed.orderId]
  );
  assert.equal(assignments.rows[0]?.count, "1", "Only one active assignment should exist for the order");
});
