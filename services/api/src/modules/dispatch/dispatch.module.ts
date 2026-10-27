import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { DispatchController } from "./dispatch.controller.js";
import { DispatchService } from "./dispatch.service.js";

@Module({
  imports: [AuthModule, NotificationsModule, DatabaseModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService]
})
export class DispatchModule {}

