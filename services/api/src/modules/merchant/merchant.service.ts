import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./merchant.types.js";

@Injectable()
export class MerchantService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  listOrders() { return [{ id: "m-order-1", status: "PENDING_CONFIRMATION" }]; }
}