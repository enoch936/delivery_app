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
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  quoteValiditySeconds: number;
  accessTokenLifetimeSeconds: number;
  refreshTokenLifetimeSeconds: number;
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
  return Object.freeze({
    nodeEnv: nodeEnv as RuntimeConfig["nodeEnv"],
    port: positivePort(environment.API_PORT),
    corsOrigins: (environment.API_CORS_ORIGINS ?? "http://localhost:3001,http://localhost:3002").split(",").map((origin) => origin.trim()).filter(Boolean),
    launchCountryCode,
    launchCitySlug,
    defaultCurrency,
    databaseUrl: environment.DATABASE_URL,
    authTokenSecret,
    otpProvider,
    otpDevelopmentCode,
    deliveryFeeMinor,
    serviceFeeMinor,
    quoteValiditySeconds,
    accessTokenLifetimeSeconds,
    refreshTokenLifetimeSeconds
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
