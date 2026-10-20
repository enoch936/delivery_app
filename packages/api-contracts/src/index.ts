/** Public API values safe for unauthenticated clients. */
export interface PlatformConfigurationResponse {
  countryCode: string;
  launchCitySlug: string;
  defaultCurrency: string;
  enabledServiceCategories: readonly string[];
}

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}
