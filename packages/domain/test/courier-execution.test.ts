import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedCourierActions,
  buildQrPayload,
  effectiveProofMode,
  failureReason,
  isActionAllowed,
  isCourierAction,
  parseQrPayload
} from "../src/courier-execution.js";

test("allowed actions walk the pickup and delivery steps in order", () => {
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "accepted", orderStatus: "COURIER_ASSIGNED" }), ["arrived_pickup", "failed"]);
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "arrived_pickup", orderStatus: "COURIER_ARRIVING_PICKUP" }), ["picked_up", "failed"]);
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "picked_up", orderStatus: "PICKED_UP" }), ["in_transit", "failed"]);
  assert.equal(isActionAllowed("delivered", { assignmentStatus: "picked_up", orderStatus: "PICKED_UP" }), false);
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "picked_up", orderStatus: "IN_TRANSIT" }), ["delivered", "failed"]);
});

test("delivery cannot be confirmed before pickup", () => {
  assert.equal(isActionAllowed("delivered", { assignmentStatus: "accepted", orderStatus: "COURIER_ASSIGNED" }), false);
  assert.equal(isActionAllowed("picked_up", { assignmentStatus: "accepted", orderStatus: "COURIER_ASSIGNED" }), false);
  assert.equal(isActionAllowed("arrived_pickup", { assignmentStatus: "picked_up", orderStatus: "IN_TRANSIT" }), false);
});

test("a stale order status blocks pickup confirmation", () => {
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "arrived_pickup", orderStatus: "COURIER_ASSIGNED" }), ["failed"]);
  assert.equal(isActionAllowed("picked_up", { assignmentStatus: "arrived_pickup", orderStatus: "COURIER_ASSIGNED" }), false);
});

test("returns can only be confirmed once the failed delivery requires one", () => {
  const pending = { assignmentStatus: "failed", orderStatus: "FAILED", returnRequired: true, returnStatus: "pending" };
  assert.deepEqual(allowedCourierActions(pending), ["returned"]);
  assert.deepEqual(allowedCourierActions({ ...pending, returnStatus: "completed" }), []);
  assert.deepEqual(allowedCourierActions({ ...pending, returnRequired: false }), []);
});

test("terminal and unassigned states expose no actions", () => {
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "delivered", orderStatus: "DELIVERED" }), []);
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "cancelled", orderStatus: "CANCELLED" }), []);
  assert.deepEqual(allowedCourierActions({ assignmentStatus: "offered", orderStatus: "READY_FOR_PICKUP" }), []);
});

test("proof mode falls back to the legacy boolean", () => {
  assert.equal(effectiveProofMode({ proofMode: null, proofRequired: true }), "otp");
  assert.equal(effectiveProofMode({ proofMode: null, proofRequired: false }), "handoff");
  assert.equal(effectiveProofMode({ proofMode: "signature", proofRequired: false }), "signature");
  assert.equal(effectiveProofMode({ proofMode: "bogus", proofRequired: true }), "otp");
});

test("QR payloads round-trip and reject malformed values", () => {
  const orderId = "8a1b4c2d-0000-4000-8000-000000000001";
  const payload = buildQrPayload(orderId, "123456");
  assert.deepEqual(parseQrPayload(payload), { orderId, code: "123456" });
  assert.deepEqual(parseQrPayload("123456"), { orderId: "", code: "123456" });
  assert.equal(parseQrPayload("DAPP1:only-two-parts"), null);
  assert.equal(parseQrPayload("DAPP1:order:abc"), null);
  assert.equal(parseQrPayload("not-a-code"), null);
});

test("failure reasons declare return and note requirements", () => {
  assert.equal(failureReason("damaged_goods")?.requiresReturn, true);
  assert.equal(failureReason("damaged_goods")?.requiresNotes, true);
  assert.equal(failureReason("order_not_ready")?.requiresReturn, false);
  assert.equal(failureReason("nope"), undefined);
  assert.equal(isCourierAction("returned"), true);
  assert.equal(isCourierAction("teleport"), false);
});
