import type { RuntimeConfig } from "../../config/runtime-config.js";
export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");
export const ORDERS_REPOSITORY = Symbol("ORDERS_REPOSITORY");
export type OrderRecord = Readonly<{ id: string; status: string; totalMinor: bigint; currency: string }>;
export interface OrdersRepository {
  create(order: Readonly<{ userId: string; currency: string; totalMinor: bigint; status: string }>): Promise<OrderRecord>;
}