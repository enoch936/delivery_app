import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { RUNTIME_CONFIG } from "./chat.types.js";

@Module({
  controllers: [ChatController],
  providers: [ChatService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [ChatService]
})
export class ChatModule {}