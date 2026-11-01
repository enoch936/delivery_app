import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LoyaltyController } from "./loyalty.controller.js";
import { LoyaltyService } from "./loyalty.service.js";
import { ReferralController } from "./referral.controller.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [LoyaltyController, ReferralController],
  providers: [LoyaltyService],
  exports: [LoyaltyService]
})
export class LoyaltyModule {}
