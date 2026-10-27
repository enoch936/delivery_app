import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LedgerController } from "./ledger.controller.js";
import { LedgerService } from "./ledger.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService]
})
export class LedgerModule {}

