import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { MerchantController } from "./merchant.controller.js";
import { MerchantService } from "./merchant.service.js";
import { RUNTIME_CONFIG } from "./merchant.types.js";

@Module({
  controllers: [MerchantController],
  providers: [MerchantService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [MerchantService]
})
export class MerchantModule {}