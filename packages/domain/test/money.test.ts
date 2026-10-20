import assert from "node:assert/strict";
import test from "node:test";
import { addMoney, money, subtractMoney } from "../src/money.js";

test("adds ETB minor units exactly", () => {
  assert.deepEqual(addMoney(money(12_500n, "ETB"), money(750n, "ETB")), money(13_250n, "ETB"));
});

test("rejects cross-currency balances and negative totals", () => {
  assert.throws(() => addMoney(money(1n, "ETB"), money(1n, "USD")));
  assert.throws(() => subtractMoney(money(10n, "ETB"), money(11n, "ETB")));
});
