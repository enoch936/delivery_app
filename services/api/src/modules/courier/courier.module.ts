import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { SupportModule } from "../support/support.module.js";
import { CourierController } from "./courier.controller.js";
import { CourierService } from "./courier.service.js";

@Module({
  imports: [AuthModule, OrdersModule, SupportModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService]
})
export class CourierModule {}
