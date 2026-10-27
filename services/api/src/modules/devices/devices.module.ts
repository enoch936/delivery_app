import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DevicesController } from "./devices.controller.js";
import { DevicesService } from "./devices.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService]
})
export class DevicesModule {}
