import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CommonModule } from "../../common/common.module.js";
import { SubscriptionsController } from "./subscriptions.controller.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, CommonModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService]
})
export class SubscriptionsModule {}
