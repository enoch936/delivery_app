import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { ZonesController } from "./zones.controller.js";
import { ZonesService } from "./zones.service.js";
import { RUNTIME_CONFIG } from "./zones.types.js";

@Module({
  controllers: [ZonesController],
  providers: [ZonesService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [ZonesService]
})
export class ZonesModule {}