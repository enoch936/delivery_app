import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { CommonModule } from "../../common/common.module.js";
import { CodController } from "./cod.controller.js";
import { CodService } from "./cod.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, LedgerModule, CommonModule],
  controllers: [CodController],
  providers: [CodService],
  exports: [CodService]
})
export class CodModule {}
