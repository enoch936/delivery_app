import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WebSocket } from "ws";
import { startTrackingGateway } from "../src/modules/tracking/tracking.gateway.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export const databaseUrl = process.env.DATABASE_URL;

export type Session = Readonly<{
  accessToken: string;
  refreshToken: string;
  user: { id: string; phoneE164: string; roles: string[] };
}>;

export type TestApp = Readonly<{
  app: NestFastifyApplication;
  baseUrl: string;
}>;

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV ??= "development";
  process.env.OTP_PROVIDER ??= "development";
  process.env.OTP_DEVELOPMENT_CODE ??= "123456";
  process.env.AUTH_TOKEN_SECRET ??= "integration-test-secret-value-at-least-32-chars";
  process.env.PAYMENTS_PROVIDER = "disabled";
  process.env.MAPS_PROVIDER = "disabled";

  const { createApp } = await import("../src/bootstrap.js");
  const app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  startTrackingGateway(app);
  return { app, baseUrl: (await app.getUrl()).replace(/\/$/, "") };
}

export async function api(
  app: NestFastifyApplication,
  method: Method,
  path: string,
  options: Readonly<{ token?: string; payload?: Record<string, unknown>; headers?: Record<string, string> }> = {}
) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.payload !== undefined) headers["content-type"] ??= "application/json";
  return app.inject({ method, url: path, headers, payload: options.payload as never });
}

export function randomPhone(): string {
  return `+2519${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

export async function createSession(app: NestFastifyApplication, phoneE164: string): Promise<Session> {
  const challenge = await api(app, "POST", "/api/v1/auth/otp/request", { payload: { phoneE164 } });
  assert.equal(challenge.statusCode, 202, challenge.body);
  const verification = await api(app, "POST", "/api/v1/auth/otp/verify", {
    payload: { phoneE164, challengeId: challenge.json().challengeId, code: process.env.OTP_DEVELOPMENT_CODE ?? "123456" }
  });
  assert.equal(verification.statusCode, 201, verification.body);
  return verification.json() as Session;
}

export async function placeOrder(app: NestFastifyApplication, session: Session, phoneE164: string) {
  const merchants = await api(app, "GET", "/api/v1/merchants?limit=20");
  assert.equal(merchants.statusCode, 200, merchants.body);
  const merchant = (merchants.json().items as Array<{ id: string; slug: string }>).find((item) => item.slug === "harvest-grocery");
  assert.ok(merchant, "Seeded merchant harvest-grocery is required for integration tests.");

  const products = await api(app, "GET", `/api/v1/merchants/${merchant.id}/products?limit=20`);
  assert.equal(products.statusCode, 200, products.body);
  const product = (products.json().items as Array<{ id: string; sku: string | null }>).find((item) => item.sku === "TEFF-1KG");
  assert.ok(product, "Seeded product TEFF-1KG is required for integration tests.");

  const address = await api(app, "POST", "/api/v1/addresses", {
    token: session.accessToken,
    payload: {
      label: "E2E Home",
      recipientName: "E2E Customer",
      phoneE164,
      addressLine: "Integration test address, launch city",
      latitude: 9.03,
      longitude: 38.74
    }
  });
  assert.equal(address.statusCode, 201, address.body);
  const addressId = address.json().id as string;

  const cart = await api(app, "POST", "/api/v1/cart/items", {
    token: session.accessToken,
    payload: { productId: product.id, quantity: 1 }
  });
  assert.equal(cart.statusCode, 201, cart.body);

  const quote = await api(app, "POST", "/api/v1/checkout/quote", {
    token: session.accessToken,
    payload: { merchantId: merchant.id, deliveryAddressId: addressId, tipMinor: 0 }
  });
  assert.equal(quote.statusCode, 201, quote.body);
  const quoteId = quote.json().quoteId as string;

  const order = await api(app, "POST", "/api/v1/orders", {
    token: session.accessToken,
    headers: { "idempotency-key": `e2e-${randomUUID()}` },
    payload: { quoteId }
  });
  assert.equal(order.statusCode, 201, order.body);
  const body = order.json() as { id: string; orderNumber: string; status: string };
  return { orderId: body.id, orderNumber: body.orderNumber, status: body.status, addressId, merchantId: merchant.id };
}

export async function openTracking(baseUrl: string, orderId: string, token: string): Promise<{ socket: WebSocket; message: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(trackingUrl(baseUrl, orderId), { headers: { authorization: `Bearer ${token}` } });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error("Timed out waiting for the tracking WebSocket snapshot."));
    }, 8_000);
    socket.once("message", (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ socket, message: JSON.parse(data.toString()) as Record<string, unknown> });
    });
    socket.once("unexpected-response", (_request, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.resume();
      socket.terminate();
      reject(new Error(`Tracking WebSocket rejected with HTTP ${response.statusCode}.`));
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function closeTracking(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 1_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close();
  });
}

export async function trackingUpgradeStatus(baseUrl: string, orderId: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(trackingUrl(baseUrl, orderId), token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    let settled = false;
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error("Timed out waiting for the tracking WebSocket upgrade response."));
    }, 8_000);
    socket.once("unexpected-response", (request, response) => {
      request.destroy();
      response.resume();
      finish(response.statusCode ?? 0);
    });
    socket.once("open", () => {
      socket.once("close", () => finish(101));
      socket.close();
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function trackingUrl(baseUrl: string, orderId: string): string {
  return `${baseUrl.replace(/^http/, "ws")}/api/v1/tracking/${orderId}/ws`;
}
