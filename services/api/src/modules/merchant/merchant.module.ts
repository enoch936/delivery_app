import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { MerchantController } from "./merchant.controller.js";
import { MerchantService } from "./merchant.service.js";

@Module({
  imports: [AuthModule, NotificationsModule, OrdersModule],
  controllers: [MerchantController],
  providers: [MerchantService],
  exports: [MerchantService]
})
export class MerchantModule {}
