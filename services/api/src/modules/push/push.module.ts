import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { PushService } from "./push.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [PushService],
  exports: [PushService]
})
export class PushModule {}
