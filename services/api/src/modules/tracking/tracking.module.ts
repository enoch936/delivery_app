import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";
import { RUNTIME_CONFIG } from "./tracking.types.js";

@Module({
  controllers: [TrackingController],
  providers: [TrackingService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [TrackingService]
})
export class TrackingModule {}