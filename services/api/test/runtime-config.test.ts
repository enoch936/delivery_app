import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeConfig } from "../src/config/runtime-config.js";

test("reads a configurable Ethiopian launch profile", () => {
  const config = readRuntimeConfig({ NODE_ENV: "test", API_PORT: "3333", LAUNCH_COUNTRY_CODE: "ET", LAUNCH_CITY_SLUG: "adama", DEFAULT_CURRENCY: "ETB" });
  assert.equal(config.port, 3333);
  assert.equal(config.launchCitySlug, "adama");
  assert.equal(config.defaultCurrency, "ETB");
});

test("rejects invalid public configuration", () => {
  assert.throws(() => readRuntimeConfig({ NODE_ENV: "production", API_PORT: "0" }));
  assert.throws(() => readRuntimeConfig({ NODE_ENV: "development", DEFAULT_CURRENCY: "etb" }));
});

test("requires Stripe credentials when Stripe is enabled", () => {
  assert.throws(() => readRuntimeConfig({ NODE_ENV: "development", PAYMENTS_PROVIDER: "stripe" }));
  const config = readRuntimeConfig({
    NODE_ENV: "development",
    PAYMENTS_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "rk_test_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example"
  });
  assert.equal(config.paymentsProvider, "stripe");
  assert.equal(config.stripeSecretKey, "rk_test_example");
});

test("requires Telebirr credentials and derives the notification URL", () => {
  assert.throws(() => readRuntimeConfig({ NODE_ENV: "development", PAYMENTS_PROVIDER: "telebirr" }));
  const config = readRuntimeConfig({
    NODE_ENV: "development",
    PAYMENTS_PROVIDER: "telebirr",
    PUBLIC_API_BASE_URL: "https://api.example.test",
    TELEBIRR_ENVIRONMENT: "test",
    TELEBIRR_FABRIC_APP_ID: "fabric-id",
    TELEBIRR_APP_SECRET: "app-secret",
    TELEBIRR_MERCHANT_APP_ID: "merchant-app-id",
    TELEBIRR_MERCHANT_CODE: "123456",
    TELEBIRR_PRIVATE_KEY: "private-key",
    TELEBIRR_PUBLIC_KEY: "public-key"
  });
  assert.equal(config.paymentsProvider, "telebirr");
  assert.equal(config.telebirrEnvironment, "test");
  assert.equal(config.telebirrNotifyUrl, "https://api.example.test/api/v1/payments/webhooks/telebirr");
  assert.equal(config.telebirrBaseUrl, "https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway");
});

test("rejects the Telebirr test gateway outside development and test", () => {
  assert.throws(() => readRuntimeConfig({
    NODE_ENV: "production",
    PAYMENTS_PROVIDER: "telebirr",
    AUTH_TOKEN_SECRET: "a-production-secret-that-is-longer-than-thirty-two-characters",
    TELEBIRR_ENVIRONMENT: "test",
    TELEBIRR_FABRIC_APP_ID: "fabric-id",
    TELEBIRR_APP_SECRET: "app-secret",
    TELEBIRR_MERCHANT_APP_ID: "merchant-app-id",
    TELEBIRR_MERCHANT_CODE: "123456",
    TELEBIRR_PRIVATE_KEY: "private-key",
    TELEBIRR_PUBLIC_KEY: "public-key"
  }));
});
