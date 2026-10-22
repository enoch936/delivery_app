import assert from "node:assert/strict";
import test from "node:test";
import { buildCheckoutQuote } from "../src/pricing.js";

const policy = {
  deliveryFeeMinor: 5000n,
  serviceFeeMinor: 300n,
  minDeliveryFeeMinor: 2500n,
  maxDeliveryFeeMinor: 15000n
};

test("builds a transparent checkout breakdown in minor units", () => {
  const quote = buildCheckoutQuote({
    currency: "ETB",
    policy,
    lines: [{ productId: "p1", displayName: "Teff flour 1 kg", quantity: 2, unitPriceMinor: 42000n }]
  });
  assert.equal(quote.itemsSubtotal.amountMinor, 84000n);
  assert.equal(quote.deliveryFee.amountMinor, 5000n);
  assert.equal(quote.total.amountMinor, 89300n);
});

test("rejects negative totals after discounts", () => {
  assert.throws(() =>
    buildCheckoutQuote({
      currency: "ETB",
      policy,
      discountMinor: 100000n,
      lines: [{ productId: "p1", displayName: "Item", quantity: 1, unitPriceMinor: 1000n }]
    })
  );
});
