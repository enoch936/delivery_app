import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { CourierController } from "./courier.controller.js";
import { CourierService } from "./courier.service.js";

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService]
})
export class CourierModule {}
