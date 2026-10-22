import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG, type OrderRecord } from "./orders.types.js";

@Injectable()
export class OrdersService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  async createOrder(input: Readonly<{ userId: string; currency: string; totalMinor: bigint }>): Promise<OrderRecord> {
    return { id: "order-" + Date.now(), status: "PENDING_CONFIRMATION", totalMinor: input.totalMinor, currency: input.currency };
  }
}