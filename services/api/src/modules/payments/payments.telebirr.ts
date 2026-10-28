import { constants as cryptoConstants, createPublicKey, randomInt, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { TELEBIRR_CA_CERTIFICATE } from "./payments.telebirr-ca.js";
import type { CheckoutSession, PaymentProvider, ProviderPaymentStatus, RefundResult } from "./payments.types.js";

export type TelebirrConfig = Readonly<{
  baseUrl: string;
  webBaseUrl: string;
  fabricAppId: string;
  appSecret: string;
  merchantAppId: string;
  merchantCode: string;
  privateKey: string;
  publicKey: string | undefined;
  notifyUrl: string;
  redirectUrl: string | undefined;
}>;

type TelebirrResponse = Record<string, unknown> & {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  errorMsg?: unknown;
  result?: unknown;
  token?: unknown;
  biz_content?: unknown;
};

const EXCLUDED_FIELDS = new Set(["sign", "sign_type", "header", "refund_info", "openType", "raw_request", "biz_content"]);
const SUCCESS_STATUSES = new Set(["PAY_SUCCESS", "SUCCESS", "PAID", "COMPLETED"]);
const FAILURE_STATUSES = new Set(["PAY_FAILED", "FAILED", "PAY_CANCEL", "CANCEL", "CANCELLED"]);

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function normalizePem(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const normalized = value.trim().replace(/\\n/g, "\n");
  if (normalized.includes("-----BEGIN")) return normalized;
  const body = normalized.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

function canonicalString(fields: Record<string, unknown>): string {
  const fieldMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(fields)) {
    if (!EXCLUDED_FIELDS.has(key)) fieldMap.set(key, value);
  }
  let bizContent = fields["biz_content"];
  if (typeof bizContent === "string") {
    try {
      bizContent = JSON.parse(bizContent) as unknown;
    } catch {
      bizContent = undefined;
    }
  }
  if (bizContent && typeof bizContent === "object" && !Array.isArray(bizContent)) {
    for (const [key, value] of Object.entries(bizContent as Record<string, unknown>)) {
      if (!EXCLUDED_FIELDS.has(key)) fieldMap.set(key, value);
    }
  }
  return [...fieldMap.keys()]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${key}=${String(fieldMap.get(key))}`)
    .join("&");
}

function verificationVariants(payload: Record<string, unknown>): string[] {
  const variants = [canonicalString(payload)];
  const aliased: Record<string, unknown> = { ...payload };
  if ("transId" in aliased && !("trans_id" in aliased)) {
    aliased["trans_id"] = aliased["transId"];
    delete aliased["transId"];
    variants.push(canonicalString(aliased));
  }
  return variants;
}

function unwrapNotification(payload: Record<string, unknown>): Record<string, unknown> {
  const inner = payload["data"];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const record = inner as Record<string, unknown>;
    if ("merch_order_id" in record || "merchOrderId" in record) return record;
  }
  return payload;
}

function decodeSignatures(signature: string): Buffer[] {
  let decoded = signature;
  try {
    decoded = decodeURIComponent(signature);
  } catch {
    decoded = signature;
  }
  const attempts = [signature.replace(/ /g, "+"), signature, decoded.replace(/ /g, "+"), decoded];
  const buffers: Buffer[] = [];
  for (const attempt of attempts) {
    const padded = attempt + "=".repeat((4 - (attempt.length % 4)) % 4);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) continue;
    const buffer = Buffer.from(padded, "base64");
    if (buffer.length > 0 && !buffers.some((candidate) => candidate.equals(buffer))) buffers.push(buffer);
  }
  return buffers;
}

function buildSignature(fields: Record<string, unknown>, privateKey: string): string {
  return cryptoSign("sha256", Buffer.from(canonicalString(fields), "utf8"), {
    key: privateKey,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32
  }).toString("base64");
}

function nonce(): string {
  const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let value = "";
  for (let index = 0; index < 32; index++) value += characters[randomInt(0, characters.length)];
  return value;
}

function timestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function formatAmount(amountMinor: number): string {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new Error("Telebirr payments require a positive amount.");
  return (amountMinor / 100).toFixed(2);
}

function normalizePayerPhone(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (/^0[79]\d{8}$/.test(digits)) return `251${digits.slice(1)}`;
  if (/^[79]\d{8}$/.test(digits)) return `251${digits}`;
  if (/^251[79]\d{8}$/.test(digits)) return digits;
  return null;
}

function sanitizeTitle(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return (sanitized || "Delivery order").slice(0, 200);
}

function parseExpiry(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== "string" || value.trim() === "") return null;
  if (/^\d+$/.test(value.trim())) {
    const numeric = Number(value.trim());
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function amountMinor(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

function postJson(urlValue: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  const url = new URL(urlValue);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() },
      ca: [...rootCertificates, TELEBIRR_CA_CERTIFICATE],
      timeout: 20_000
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy(new Error("Telebirr request timed out.")));
    request.on("error", reject);
    request.end(payload);
  });
}

export class TelebirrPaymentProvider implements PaymentProvider {
  readonly name = "telebirr" as const;
  private readonly privateKey: string;
  private readonly publicKey: string | undefined;
  private tokenCache: { token: string; expiresAtMs: number } | null = null;

  constructor(private readonly config: TelebirrConfig) {
    this.privateKey = normalizePem(config.privateKey, "PRIVATE KEY");
    this.publicKey = config.publicKey ? normalizePem(config.publicKey, "PUBLIC KEY") : undefined;
  }

  async createCheckout(input: Readonly<{ paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null; customerPhone: string; returnUrl: string; cancelUrl: string }>): Promise<CheckoutSession> {
    if (input.currency.toUpperCase() !== "ETB") throw new Error("Telebirr only supports ETB payments.");
    const merchantOrderId = input.paymentId.replace(/[^A-Za-z0-9]/g, "");
    if (!merchantOrderId) throw new Error("Could not create a valid Telebirr merchant order id.");
    const fabricToken = await this.fabricToken();
    const bizContent: Record<string, unknown> = {
      notify_url: this.config.notifyUrl,
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
      merch_order_id: merchantOrderId,
      trade_type: "Checkout",
      title: sanitizeTitle(`Delivery order ${input.orderId.slice(0, 8)}`),
      total_amount: formatAmount(input.amountMinor),
      trans_currency: "ETB",
      timeout_express: "30m",
      payee_type: "5000",
      payee_identifier: this.config.merchantCode,
      payee_identifier_type: "04"
    };
    const payerPhone = normalizePayerPhone(input.customerPhone);
    if (payerPhone) {
      bizContent["payer_type"] = "1000";
      bizContent["payer_identifier"] = payerPhone;
      bizContent["payer_identifier_type"] = "01";
    }
    if (this.config.redirectUrl) bizContent["redirect_url"] = this.config.redirectUrl;
    const request: Record<string, unknown> = {
      timestamp: timestamp(),
      nonce_str: nonce(),
      method: "payment.preorder",
      version: "1.0",
      biz_content: bizContent
    };
    request["sign"] = buildSignature(request, this.privateKey);
    request["sign_type"] = "SHA256WithRSA";
    const response = await this.call("/payment/v1/merchant/preOrder", request, fabricToken);
    const result = this.bizContent(response);
    const prepayId = firstString(result["prepay_id"], result["prepayId"]);
    if (!prepayId) throw new Error("Telebirr did not return a prepay id.");
    return {
      providerReference: merchantOrderId,
      checkoutUrl: this.checkoutUrl(prepayId),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
  }

  async refund(input: Readonly<{ providerReference: string; amountMinor: number; currency: string; reason: string }>): Promise<RefundResult> {
    try {
      if (input.currency.toUpperCase() !== "ETB") throw new Error("Telebirr only supports ETB refunds.");
      const fabricToken = await this.fabricToken();
      const refundRequestNo = `RF${Date.now()}${randomInt(100_000, 1_000_000)}`;
      const business: Record<string, unknown> = {
        appid: this.config.merchantAppId,
        merch_code: this.config.merchantCode,
        refund_amount: formatAmount(input.amountMinor),
        refund_request_no: refundRequestNo,
        merch_order_id: input.providerReference,
        refund_reason: input.reason.slice(0, 200)
      };
      const request: Record<string, unknown> = {
        timestamp: timestamp(),
        nonce_str: nonce(),
        method: "payment.refund",
        version: "1.0",
        biz_content: business
      };
      request["sign"] = buildSignature(request, this.privateKey);
      request["sign_type"] = "SHA256WithRSA";
      const response = await this.call("/payment/v1/merchant/refund", request, fabricToken);
      const result = this.bizContent(response);
      const refundStatus = firstString(result["refund_status"], result["refundStatus"], response["result"]).toUpperCase();
      if (refundStatus === "REFUND_SUCCESS" || refundStatus === "SUCCESS") {
        return { providerReference: firstString(result["refund_order_id"], result["refundOrderId"], refundRequestNo), status: "succeeded" };
      }
      if (refundStatus === "REFUNDING" || refundStatus === "PENDING") {
        return { providerReference: refundRequestNo, status: "pending" };
      }
      return {
        providerReference: refundRequestNo,
        status: "failed",
        failureReason: firstString(result["refund_status"], result["refundStatus"], response["msg"], response["message"]) || "Telebirr refund failed."
      };
    } catch (error) {
      return {
        providerReference: input.providerReference,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Telebirr refund failed."
      };
    }
  }

  async fetchStatus(input: Readonly<{ providerReference: string; amountMinor: number; currency: string }>): Promise<ProviderPaymentStatus> {
    try {
      const fabricToken = await this.fabricToken();
      const request: Record<string, unknown> = {
        timestamp: timestamp(),
        nonce_str: nonce(),
        method: "payment.queryorder",
        version: "1.0",
        biz_content: {
          appid: this.config.merchantAppId,
          merch_code: this.config.merchantCode,
          merch_order_id: input.providerReference
        }
      };
      request["sign"] = buildSignature(request, this.privateKey);
      request["sign_type"] = "SHA256WithRSA";
      const response = await this.call("/payment/v1/merchant/queryOrder", request, fabricToken);
      const result = this.bizContent(response);
      const status = firstString(result["trade_status"], result["tradeStatus"], result["order_status"], result["orderStatus"]);
      const reportedAmount = amountMinor(result["total_amount"] ?? result["totalAmount"]);
      return {
        status: SUCCESS_STATUSES.has(status.toUpperCase()) ? "succeeded"
          : FAILURE_STATUSES.has(status.toUpperCase()) ? "failed"
            : status ? "pending" : "unknown",
        ...(reportedAmount !== undefined ? { amountMinor: reportedAmount } : {}),
        ...(FAILURE_STATUSES.has(status.toUpperCase()) ? { failureReason: firstString(result["order_status"], result["trade_status"], response["msg"]) || `Telebirr reported ${status}.` } : {})
      };
    } catch (error) {
      return { status: "unknown", failureReason: error instanceof Error ? error.message : "Telebirr order query failed." };
    }
  }

  verifyWebhook(rawBody: string, _signature: string | undefined, payload?: Record<string, unknown>): boolean {
    if (!this.publicKey) return false;
    let parsed: Record<string, unknown> | undefined = payload;
    if (!parsed) {
      try {
        const body: unknown = JSON.parse(rawBody);
        if (!body || typeof body !== "object" || Array.isArray(body)) return false;
        parsed = body as Record<string, unknown>;
      } catch {
        return false;
      }
    }
    const notification = unwrapNotification(parsed);
    const signature = firstString(notification["sign"]);
    const signType = firstString(notification["sign_type"], notification["signType"]).toUpperCase();
    if (!signature || signType !== "SHA256WITHRSA") return false;
    const candidates = decodeSignatures(signature);
    if (candidates.length === 0) return false;
    try {
      const publicKey = createPublicKey(this.publicKey);
      return verificationVariants(notification).some((canonical) => candidates.some((candidate) => {
        try {
          return cryptoVerify("sha256", Buffer.from(canonical, "utf8"), {
            key: publicKey,
            padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32
          }, candidate);
        } catch {
          return false;
        }
      }));
    } catch {
      return false;
    }
  }

  private async fabricToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAtMs) return this.tokenCache.token;
    const response = await this.call("/payment/v1/token", { appSecret: this.config.appSecret }, null);
    const token = firstString(response["token"]);
    if (!token) throw new Error("Telebirr did not return an access token.");
    const expiresAt = parseExpiry(response["expirationDate"]);
    this.tokenCache = { token, expiresAtMs: expiresAt ? expiresAt - 60_000 : Date.now() + 5 * 60_000 };
    return token;
  }

  private async call(path: string, body: Record<string, unknown>, token: string | null): Promise<TelebirrResponse> {
    const headers: Record<string, string> = { "X-APP-Key": this.config.fabricAppId };
    if (token) headers["Authorization"] = token;
    const response = await postJson(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, body, headers);
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new Error(`Telebirr returned a non-JSON response with HTTP ${response.statusCode}.`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Telebirr returned an invalid response with HTTP ${response.statusCode}.`);
    }
    const result = parsed as TelebirrResponse;
    const code = firstString(result.code);
    const failedResult = firstString(result.result).toUpperCase() === "FAIL";
    if (response.statusCode < 200 || response.statusCode >= 300 || (code !== "" && code !== "0" && code !== "00000") || failedResult) {
      const message = firstString(result.msg, result.message, result.errorMsg) || response.body.slice(0, 500);
      throw new Error(`Telebirr request failed with HTTP ${response.statusCode}${code ? ` and code ${code}` : ""}: ${message}`);
    }
    return result;
  }

  private bizContent(response: TelebirrResponse): Record<string, unknown> {
    const value = response.biz_content;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private checkoutUrl(prepayId: string): string {
    const request: Record<string, string> = {
      appid: this.config.merchantAppId,
      merch_code: this.config.merchantCode,
      nonce_str: nonce(),
      prepay_id: prepayId,
      timestamp: timestamp()
    };
    request["sign"] = buildSignature(request, this.privateKey);
    const query = [
      `appid=${request["appid"]}`,
      `merch_code=${request["merch_code"]}`,
      `nonce_str=${request["nonce_str"]}`,
      `prepay_id=${request["prepay_id"]}`,
      `timestamp=${request["timestamp"]}`,
      `sign=${request["sign"]}`,
      "sign_type=SHA256WithRSA"
    ].join("&");
    const base = this.config.webBaseUrl.endsWith("?") ? this.config.webBaseUrl : `${this.config.webBaseUrl}?`;
    return `${base}${query}&version=1.0&trade_type=Checkout`;
  }
}
