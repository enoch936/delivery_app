import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { RUNTIME_CONFIG } from "./orders.types.js";

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [OrdersService]
})
export class OrdersModule {}