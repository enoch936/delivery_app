import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { RUNTIME_CONFIG } from "./admin.types.js";

@Module({
  controllers: [AdminController],
  providers: [AdminService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [AdminService]
})
export class AdminModule {}