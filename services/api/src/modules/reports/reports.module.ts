import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { RUNTIME_CONFIG } from "./reports.types.js";

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [ReportsService]
})
export class ReportsModule {}