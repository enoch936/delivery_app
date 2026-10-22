import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { PromotionsController } from "./promotions.controller.js";
import { PromotionsService } from "./promotions.service.js";
import { RUNTIME_CONFIG } from "./promotions.types.js";

@Module({
  controllers: [PromotionsController],
  providers: [PromotionsService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [PromotionsService]
})
export class PromotionsModule {}