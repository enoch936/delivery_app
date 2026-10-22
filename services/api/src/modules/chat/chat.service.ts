import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./chat.types.js";

@Injectable()
export class ChatService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  listMessages(orderId: string) { return []; }
}