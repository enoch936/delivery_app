import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { SettlementsController } from "./settlements.controller.js";
import { SettlementsService } from "./settlements.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, LedgerModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService]
})
export class SettlementsModule {}
