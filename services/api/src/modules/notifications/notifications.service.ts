import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./notifications.types.js";

@Injectable()
export class NotificationsService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  list() { return []; }
}