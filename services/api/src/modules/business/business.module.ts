import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { BusinessController } from "./business.controller.js";
import { BusinessService } from "./business.service.js";
import { RUNTIME_CONFIG } from "./business.types.js";

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [BusinessService]
})
export class BusinessModule {}