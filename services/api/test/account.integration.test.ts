import assert from "node:assert/strict";
import test from "node:test";
import { api, createSession, createTestApp, databaseUrl, randomPhone } from "./support.js";

test("customer account: profile, preferences, addresses, sessions, export and deletion grace period", { skip: !databaseUrl }, async (t) => {
  const { app } = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const phoneE164 = randomPhone();
  const session = await createSession(app, phoneE164);

  const initial = await api(app, "GET", "/api/v1/users/me", { token: session.accessToken });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().preferredLocale, "en");
  assert.equal(initial.json().deletion, null);
  assert.equal(initial.json().accessibility.textScale, 1);
  assert.equal(initial.json().accessibility.screenReaderHints, true);

  const invalidLocale = await api(app, "PATCH", "/api/v1/users/me", {
    token: session.accessToken,
    payload: { preferredLocale: "fr" }
  });
  assert.equal(invalidLocale.statusCode, 400, invalidLocale.body);

  const updated = await api(app, "PATCH", "/api/v1/users/me", {
    token: session.accessToken,
    payload: {
      displayName: "Account Test",
      preferredLocale: "am",
      marketingConsent: true,
      acceptTerms: true,
      textScale: 1.3,
      reduceMotion: true,
      highContrast: true
    }
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().displayName, "Account Test");
  assert.equal(updated.json().preferredLocale, "am");
  assert.equal(updated.json().marketingConsent, true);
  assert.ok(updated.json().termsAcceptedAt);
  assert.equal(updated.json().accessibility.textScale, 1.3);
  assert.equal(updated.json().accessibility.reduceMotion, true);
  assert.equal(updated.json().accessibility.highContrast, true);

  const createdAddress = await api(app, "POST", "/api/v1/addresses", {
    token: session.accessToken,
    payload: {
      label: "Account Home",
      recipientName: "Account Test",
      phoneE164,
      addressLine: "Account integration address, launch city",
      deliveryInstructions: "Call on arrival"
    }
  });
  assert.equal(createdAddress.statusCode, 201, createdAddress.body);
  assert.equal(createdAddress.json().isDefault, true);
  const addressId = createdAddress.json().id as string;

  const addresses = await api(app, "GET", "/api/v1/addresses", { token: session.accessToken });
  assert.equal(addresses.statusCode, 200, addresses.body);
  assert.ok((addresses.json().items as Array<{ id: string }>).some((item) => item.id === addressId));

  const sessions = await api(app, "GET", "/api/v1/users/me/sessions", { token: session.accessToken });
  assert.equal(sessions.statusCode, 200, sessions.body);
  assert.equal((sessions.json().items as unknown[]).length, 1);
  assert.ok(sessions.json().currentSessionId);

  const revokeOthers = await api(app, "POST", "/api/v1/users/me/sessions/revoke-others", { token: session.accessToken });
  assert.equal(revokeOthers.statusCode, 200, revokeOthers.body);
  assert.equal(revokeOthers.json().revokedCount, 0);

  const preferences = await api(app, "GET", "/api/v1/notifications/preferences", { token: session.accessToken });
  assert.equal(preferences.statusCode, 200, preferences.body);
  const toggled = await api(app, "PATCH", "/api/v1/notifications/preferences", {
    token: session.accessToken,
    payload: { promotions: true, emailEnabled: true }
  });
  assert.equal(toggled.statusCode, 200, toggled.body);
  assert.equal(toggled.json().promotions, true);
  assert.equal(toggled.json().emailEnabled, true);

  const exported = await api(app, "GET", "/api/v1/users/me/export", { token: session.accessToken });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.equal(exported.json().profile.displayName, "Account Test");
  assert.ok((exported.json().addresses as unknown[]).length >= 1);

  const verificationEmail = `account-${Date.now()}@example.com`;
  const emailVerification = await api(app, "POST", "/api/v1/users/me/email/verification/request", {
    token: session.accessToken,
    payload: { email: verificationEmail }
  });
  if (emailVerification.statusCode === 201) {
    const verification = await api(app, "POST", "/api/v1/users/me/email/verification/verify", {
      token: session.accessToken,
      payload: {
        email: verificationEmail,
        challengeId: emailVerification.json().challengeId,
        code: emailVerification.json().developmentCode
      }
    });
    assert.equal(verification.statusCode, 201, verification.body);
    assert.equal(verification.json().emailVerified, true);
  } else {
    assert.equal(emailVerification.statusCode, 503, "Email verification is fail-closed until an email provider is configured.");
  }

  const deletion = await api(app, "POST", "/api/v1/users/me/deletion-request", { token: session.accessToken });
  assert.equal(deletion.statusCode, 201, deletion.body);
  assert.equal(deletion.json().status, "pending");
  assert.equal(deletion.json().retentionDays, 30);
  const scheduledFor = new Date(deletion.json().scheduledFor as string).getTime();
  assert.ok(scheduledFor > Date.now() + 29 * 24 * 60 * 60 * 1000);

  const revoked = await api(app, "GET", "/api/v1/users/me", { token: session.accessToken });
  assert.equal(revoked.statusCode, 401, "Deletion requests must revoke active sessions.");

  const returning = await createSession(app, phoneE164);
  const pending = await api(app, "GET", "/api/v1/users/me", { token: returning.accessToken });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().deletion.status, "pending");

  const cancelled = await api(app, "POST", "/api/v1/users/me/deletion-request/cancel", { token: returning.accessToken });
  assert.equal(cancelled.statusCode, 201, cancelled.body);
  assert.equal(cancelled.json().cancelled, true);

  const restored = await api(app, "GET", "/api/v1/users/me", { token: returning.accessToken });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().deletion, null);
  assert.equal(restored.json().accountStatus, "active");

  const removed = await api(app, "DELETE", `/api/v1/addresses/${addressId}`, { token: returning.accessToken });
  assert.equal(removed.statusCode, 204, removed.body);
});
