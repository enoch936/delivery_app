import assert from "node:assert/strict";
import { constants, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";
import { TelebirrPaymentProvider, type TelebirrConfig } from "../src/modules/payments/payments.telebirr.js";

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

function provider(publicKey: string | undefined = keys.publicKey): TelebirrPaymentProvider {
  const config: TelebirrConfig = {
    baseUrl: "https://example.test/apiaccess/payment/gateway",
    webBaseUrl: "https://example.test/payment/web/paygate?",
    fabricAppId: "fabric-id",
    appSecret: "app-secret",
    merchantAppId: "merchant-app-id",
    merchantCode: "123456",
    privateKey: keys.privateKey,
    publicKey,
    notifyUrl: "https://api.example.test/api/v1/payments/webhooks/telebirr",
    redirectUrl: undefined
  };
  return new TelebirrPaymentProvider(config);
}

function notification() {
  const payload: Record<string, unknown> = {
    appid: "merchant-app-id",
    merch_code: "123456",
    merch_order_id: "PAY123",
    total_amount: "12.50",
    trade_status: "Completed",
    trans_currency: "ETB",
    transId: "TX-9",
    sign_type: "SHA256WithRSA"
  };
  const canonical = [
    "appid=merchant-app-id",
    "merch_code=123456",
    "merch_order_id=PAY123",
    "total_amount=12.50",
    "trade_status=Completed",
    "trans_currency=ETB",
    "trans_id=TX-9"
  ].join("&");
  payload["sign"] = cryptoSign("sha256", Buffer.from(canonical, "utf8"), {
    key: keys.privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32
  }).toString("base64");
  return payload;
}

test("verifies Telebirr notifications including signed field aliases and data envelopes", () => {
  const payload = notification();
  const telebirr = provider();
  assert.equal(telebirr.verifyWebhook(JSON.stringify(payload), undefined, payload), true);
  assert.equal(telebirr.verifyWebhook(JSON.stringify({ data: payload }), undefined, { data: payload }), true);
  assert.equal(telebirr.verifyWebhook(JSON.stringify(payload), undefined), true);
});

test("rejects tampered Telebirr notifications and missing public keys", () => {
  const payload = notification();
  assert.equal(provider().verifyWebhook(JSON.stringify({ ...payload, total_amount: "99.00" }), undefined, { ...payload, total_amount: "99.00" }), false);
  assert.equal(provider("").verifyWebhook(JSON.stringify(payload), undefined, payload), false);
  assert.equal(provider().verifyWebhook(JSON.stringify({ ...payload, sign: "" }), undefined, { ...payload, sign: "" }), false);
});
