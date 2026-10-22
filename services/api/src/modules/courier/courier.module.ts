import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { CourierController } from "./courier.controller.js";
import { CourierService } from "./courier.service.js";
import { RUNTIME_CONFIG } from "./courier.types.js";

@Module({
  controllers: [CourierController],
  providers: [CourierService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [CourierService]
})
export class CourierModule {}