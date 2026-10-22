import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";
import { RUNTIME_CONFIG } from "./checkout.types.js";

@Module({
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }
  ],
  exports: [CheckoutService]
})
export class CheckoutModule {}