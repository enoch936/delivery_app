import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;

test("API serves seeded discovery and a full OTP session lifecycle", { skip: !databaseUrl }, async (t) => {
  process.env.NODE_ENV ??= "development";
  process.env.OTP_PROVIDER ??= "development";
  process.env.OTP_DEVELOPMENT_CODE ??= "123456";
  process.env.AUTH_TOKEN_SECRET ??= "integration-test-secret-value-at-least-32-chars";

  const { createApp } = await import("../src/bootstrap.js");
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  t.after(async () => {
    await app.close();
  });

  const live = await app.inject({ method: "GET", url: "/api/health/live" });
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.json().status, "ok");
  assert.equal(live.headers["x-content-type-options"], "nosniff");

  const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().checks.database, "ok");

  const categories = await app.inject({ method: "GET", url: "/api/v1/service-categories" });
  assert.equal(categories.statusCode, 200, categories.body);
  assert.ok(categories.json().items.some((item: { slug: string }) => item.slug === "restaurant"));

  const merchants = await app.inject({ method: "GET", url: "/api/v1/merchants?limit=10" });
  assert.equal(merchants.statusCode, 200, merchants.body);
  assert.ok(merchants.json().items.some((item: { slug: string }) => item.slug === "harvest-grocery"));

  const search = await app.inject({ method: "GET", url: "/api/v1/search?q=teff" });
  assert.equal(search.statusCode, 200, search.body);
  assert.ok(search.json().items.some((item: { type: string }) => item.type === "product"));

  const phoneE164 = `+2519${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
  const challenge = await app.inject({
    method: "POST",
    url: "/api/v1/auth/otp/request",
    headers: { "content-type": "application/json" },
    payload: { phoneE164 }
  });
  assert.equal(challenge.statusCode, 202, challenge.body);
  const challengeId = challenge.json().challengeId as string;
  assert.match(challengeId, /^[0-9a-f-]{36}$/);

  const verification = await app.inject({
    method: "POST",
    url: "/api/v1/auth/otp/verify",
    headers: { "content-type": "application/json" },
    payload: { phoneE164, challengeId, code: process.env.OTP_DEVELOPMENT_CODE }
  });
  assert.equal(verification.statusCode, 201, verification.body);
  const session = verification.json() as { accessToken: string; refreshToken: string; user: { phoneE164: string; roles: string[] } };
  assert.equal(session.user.phoneE164, phoneE164);
  assert.ok(session.user.roles.includes("customer"));

  const me = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.phoneE164, phoneE164);

  const refreshed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    headers: { "content-type": "application/json" },
    payload: { refreshToken: session.refreshToken }
  });
  assert.equal(refreshed.statusCode, 201, refreshed.body);
  const rotated = refreshed.json() as { accessToken: string; refreshToken: string };
  assert.notEqual(rotated.accessToken, session.accessToken);

  const profile = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { authorization: `Bearer ${rotated.accessToken}` }
  });
  assert.equal(profile.statusCode, 200, profile.body);

  const logout = await app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { authorization: `Bearer ${rotated.accessToken}`, "content-type": "application/json" },
    payload: { refreshToken: rotated.refreshToken }
  });
  assert.equal(logout.statusCode, 204, logout.body);

  const afterLogout = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { authorization: `Bearer ${rotated.accessToken}` }
  });
  assert.equal(afterLogout.statusCode, 401, afterLogout.body);

  const unauthorizedAdmin = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" });
  assert.equal(unauthorizedAdmin.statusCode, 401, unauthorizedAdmin.body);
});
