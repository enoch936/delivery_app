export type PaymentProviderName = "disabled" | "sandbox" | "chapa" | "stripe";

export type RuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "staging" | "production";
  port: number;
  corsOrigins: readonly string[];
  launchCountryCode: string;
  launchCitySlug: string;
  defaultCurrency: string;
  databaseUrl: string | undefined;
  authTokenSecret: string | undefined;
  otpProvider: "disabled" | "development";
  otpDevelopmentCode: string | undefined;
  otpRequestLimit: number;
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  quoteValiditySeconds: number;
  accessTokenLifetimeSeconds: number;
  refreshTokenLifetimeSeconds: number;
  paymentsProvider: PaymentProviderName;
  paymentWebhookSecret: string | undefined;
  chapaSecretKey: string | undefined;
  chapaWebhookSecret: string | undefined;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  paymentReturnUrl: string | undefined;
  paymentCancelUrl: string | undefined;
  courierOfferTimeoutSeconds: number;
  dispatchRadiusMeters: number;
  maxPendingOffersPerCourier: number;
  deliveryProofOtpRequired: boolean;
  taxRateBps: number;
  mapsProvider: "disabled" | "configured";
  pushProvider: "disabled" | "fcm";
  firebaseServiceAccountJson: string | undefined;
  publicApiBaseUrl: string;
  geocodingProvider: 'nominatim' | 'disabled';
}>;

const allowedEnvironments = ["development", "test", "staging", "production"] as const;

function positivePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("API_PORT must be a valid TCP port.");
  return port;
}

export function readRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = environment.NODE_ENV ?? "development";
  if (!allowedEnvironments.includes(nodeEnv as RuntimeConfig["nodeEnv"])) {
    throw new Error("NODE_ENV must be development, test, staging, or production.");
  }
  const defaultCurrency = environment.DEFAULT_CURRENCY ?? "ETB";
  if (!/^[A-Z]{3}$/.test(defaultCurrency)) throw new Error("DEFAULT_CURRENCY must be a three-letter ISO code.");
  const launchCountryCode = environment.LAUNCH_COUNTRY_CODE ?? "ET";
  if (!/^[A-Z]{2}$/.test(launchCountryCode)) throw new Error("LAUNCH_COUNTRY_CODE must be a two-letter ISO code.");
  const launchCitySlug = environment.LAUNCH_CITY_SLUG ?? "launch-city";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(launchCitySlug)) throw new Error("LAUNCH_CITY_SLUG must be a lowercase slug.");
  const otpProvider = environment.OTP_PROVIDER ?? "disabled";
  if (otpProvider !== "disabled" && otpProvider !== "development") throw new Error("OTP_PROVIDER must be disabled or development until a verified provider is configured.");
  const otpDevelopmentCode = environment.OTP_DEVELOPMENT_CODE;
  if (otpProvider === "development") {
    if (nodeEnv !== "development") throw new Error("The development OTP provider can only run in development.");
    if (!/^\d{6}$/.test(otpDevelopmentCode ?? "")) throw new Error("OTP_DEVELOPMENT_CODE must be six digits when the development provider is enabled.");
  }
  const authTokenSecret = environment.AUTH_TOKEN_SECRET;
  if ((nodeEnv === "staging" || nodeEnv === "production") && (!authTokenSecret || authTokenSecret.length < 32)) {
    throw new Error("AUTH_TOKEN_SECRET must be at least 32 characters outside local development.");
  }
  const deliveryFeeMinor = parseMinorUnits(environment.DELIVERY_FEE_MINOR, "5000");
  const serviceFeeMinor = parseMinorUnits(environment.SERVICE_FEE_MINOR, "300");
  const quoteValiditySeconds = positiveInteger(environment.QUOTE_VALIDITY_SECONDS, 900);
  const accessTokenLifetimeSeconds = positiveInteger(environment.ACCESS_TOKEN_LIFETIME_SECONDS, 900);
  const refreshTokenLifetimeSeconds = positiveInteger(environment.REFRESH_TOKEN_LIFETIME_SECONDS, 2_592_000);
  const paymentsProvider = environment.PAYMENTS_PROVIDER ?? "disabled";
  if (paymentsProvider !== "disabled" && paymentsProvider !== "sandbox" && paymentsProvider !== "chapa" && paymentsProvider !== "stripe") {
    throw new Error("PAYMENTS_PROVIDER must be disabled, sandbox, chapa, or stripe.");
  }
  if (paymentsProvider === "sandbox" && nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error("The sandbox payment provider can only run in development or test.");
  }
  if (paymentsProvider === "chapa" && (!environment.CHAPA_SECRET_KEY || !environment.CHAPA_WEBHOOK_SECRET)) {
    throw new Error("CHAPA_SECRET_KEY and CHAPA_WEBHOOK_SECRET are required when the chapa provider is enabled.");
  }
  if (paymentsProvider === "stripe" && (!environment.STRIPE_SECRET_KEY || !environment.STRIPE_WEBHOOK_SECRET)) {
    throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when the stripe provider is enabled.");
  }
  const mapsProvider = environment.MAPS_PROVIDER === "configured" ? "configured" : "disabled";
  const pushProvider = environment.PUSH_PROVIDER === "fcm" ? "fcm" : "disabled";
  const firebaseServiceAccountJson = environment.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || undefined;
  if (pushProvider === "fcm" && !firebaseServiceAccountJson && !environment.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS is required when PUSH_PROVIDER=fcm.");
  }
  const geocodingProvider = environment.GEOCODING_PROVIDER === "nominatim" ? 'nominatim' : 'disabled';
  return Object.freeze({
    nodeEnv: nodeEnv as RuntimeConfig["nodeEnv"],
    port: positivePort(environment.API_PORT ?? environment.PORT),
    corsOrigins: (environment.API_CORS_ORIGINS ?? "http://localhost:3001,http://localhost:3002").split(",").map((origin) => origin.trim()).filter(Boolean),
    launchCountryCode,
    launchCitySlug,
    defaultCurrency,
    databaseUrl: environment.DATABASE_URL,
    authTokenSecret,
    otpProvider,
    otpDevelopmentCode,
    otpRequestLimit: positiveInteger(environment.OTP_REQUEST_LIMIT, 3),
    deliveryFeeMinor,
    serviceFeeMinor,
    quoteValiditySeconds,
    accessTokenLifetimeSeconds,
    refreshTokenLifetimeSeconds,
    paymentsProvider,
    paymentWebhookSecret: environment.PAYMENT_WEBHOOK_SECRET,
    chapaSecretKey: environment.CHAPA_SECRET_KEY,
    chapaWebhookSecret: environment.CHAPA_WEBHOOK_SECRET,
    stripeSecretKey: environment.STRIPE_SECRET_KEY,
    stripeWebhookSecret: environment.STRIPE_WEBHOOK_SECRET,
    paymentReturnUrl: environment.PAYMENT_RETURN_URL,
    paymentCancelUrl: environment.PAYMENT_CANCEL_URL,
    courierOfferTimeoutSeconds: positiveInteger(environment.COURIER_OFFER_TIMEOUT_SECONDS, 45),
    dispatchRadiusMeters: positiveInteger(environment.DISPATCH_RADIUS_METERS, 8000),
    maxPendingOffersPerCourier: positiveInteger(environment.MAX_PENDING_OFFERS_PER_COURIER, 3),
    deliveryProofOtpRequired: (environment.DELIVERY_PROOF_OTP_REQUIRED ?? "true") === "true",
    taxRateBps: parseBasisPoints(environment.TAX_RATE_BPS, 0),
    mapsProvider,
    pushProvider,
    firebaseServiceAccountJson,
    publicApiBaseUrl: environment.PUBLIC_API_BASE_URL ?? "http://localhost:3000",
    geocodingProvider
  });
}

function parseMinorUnits(value: string | undefined, fallback: string): bigint {
  const raw = value ?? fallback;
  if (!/^\d+$/.test(raw)) throw new Error("Fee environment variables must be non-negative integers in minor units.");
  return BigInt(raw);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Lifetime and quote settings must be positive integers.");
  return parsed;
}

function parseBasisPoints(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) throw new Error("TAX_RATE_BPS must be an integer between 0 and 10000.");
  return parsed;
}

export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");
