import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./tracking.types.js";

@Injectable()
export class TrackingService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  getTracking(orderId: string) { return { orderId, status: "PENDING_CONFIRMATION", courier: null, lastUpdated: new Date().toISOString() }; }
}