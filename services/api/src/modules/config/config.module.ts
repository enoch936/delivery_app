import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ConfigController } from "./config.controller.js";
import { ConfigService } from "./config.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService]
})
export class ConfigModule {}

