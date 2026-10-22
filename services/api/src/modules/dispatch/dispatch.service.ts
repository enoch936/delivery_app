import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./dispatch.types.js";

@Injectable()
export class DispatchService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  assign(orderId: string, courierId: string) { return { orderId, courierId, status: "ASSIGNED" }; }
}