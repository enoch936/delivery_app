import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./config.types.js";

@Injectable()
export class ConfigService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  featureFlags() { return { paymentsEnabled: true, trackingEnabled: true }; }
}