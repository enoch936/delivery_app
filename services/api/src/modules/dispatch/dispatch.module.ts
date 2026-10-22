import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { DispatchController } from "./dispatch.controller.js";
import { DispatchService } from "./dispatch.service.js";
import { RUNTIME_CONFIG } from "./dispatch.types.js";

@Module({
  controllers: [DispatchController],
  providers: [DispatchService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [DispatchService]
})
export class DispatchModule {}