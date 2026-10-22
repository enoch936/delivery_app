import { ServiceUnavailableException } from "@nestjs/common";
import type { OtpProvider } from "./auth.types.js";

export class DisabledOtpProvider implements OtpProvider {
  readonly name = "disabled";

  async deliver(): Promise<void> {
    throw new ServiceUnavailableException("Phone sign-in is not configured yet.");
  }
}

/** Development-only adapter. It never runs outside NODE_ENV=development. */
export class DevelopmentOtpProvider implements OtpProvider {
  readonly name = "development";

  async deliver(): Promise<void> {
    // The configured local code is deliberately never returned or logged by the API.
  }
}
