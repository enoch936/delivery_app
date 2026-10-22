import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { RUNTIME_CONFIG } from "./notifications.types.js";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [NotificationsService]
})
export class NotificationsModule {}