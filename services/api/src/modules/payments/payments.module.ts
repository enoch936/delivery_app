import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { RUNTIME_CONFIG } from "./payments.types.js";

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [PaymentsService]
})
export class PaymentsModule {}