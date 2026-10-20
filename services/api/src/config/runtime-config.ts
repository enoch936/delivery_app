export type RuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "staging" | "production";
  port: number;
  corsOrigins: readonly string[];
  launchCountryCode: string;
  launchCitySlug: string;
  defaultCurrency: string;
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
  return Object.freeze({
    nodeEnv: nodeEnv as RuntimeConfig["nodeEnv"],
    port: positivePort(environment.API_PORT),
    corsOrigins: (environment.API_CORS_ORIGINS ?? "http://localhost:3001,http://localhost:3002").split(",").map((origin) => origin.trim()).filter(Boolean),
    launchCountryCode,
    launchCitySlug,
    defaultCurrency
  });
}
