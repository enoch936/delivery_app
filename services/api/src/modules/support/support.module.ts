import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { SupportController } from "./support.controller.js";
import { SupportService } from "./support.service.js";
import { RUNTIME_CONFIG } from "./support.types.js";

@Module({
  controllers: [SupportController],
  providers: [SupportService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [SupportService]
})
export class SupportModule {}