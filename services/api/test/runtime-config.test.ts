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
