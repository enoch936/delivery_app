import assert from "node:assert/strict";
import test from "node:test";
import { assertOrderTransition, canTransitionOrder } from "../src/order-state.js";

test("permits a merchant's authorized preparation lifecycle", () => {
  assert.equal(canTransitionOrder("MERCHANT_DELIVERY", "CONFIRMED", "ACCEPTED_BY_MERCHANT"), true);
  assert.equal(canTransitionOrder("MERCHANT_DELIVERY", "PREPARING", "READY_FOR_PICKUP"), true);
});

test("rejects impossible and merchant-only parcel transitions", () => {
  assert.equal(canTransitionOrder("PARCEL", "CONFIRMED", "ACCEPTED_BY_MERCHANT"), false);
  assert.throws(() => assertOrderTransition("PARCEL", "IN_TRANSIT", "PREPARING"));
});
