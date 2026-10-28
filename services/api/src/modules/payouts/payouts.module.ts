import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { CommonModule } from "../../common/common.module.js";
import { PayoutsController } from "./payouts.controller.js";
import { PayoutsService } from "./payouts.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, LedgerModule, CommonModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService]
})
export class PayoutsModule {}
