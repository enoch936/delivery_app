import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { PaymentWebhookController, PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [AuthModule, OrdersModule, LedgerModule, NotificationsModule, DatabaseModule],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [PaymentsService],
  exports: [PaymentsService]
})
export class PaymentsModule {}

