import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./admin.types.js";

@Injectable()
export class AdminService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  dashboard() { return { orders: 0, activeCouriers: 0, merchants: 0 }; }
}