import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RedeemReferralDto } from "./referral.dto.js";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { LoyaltyService } from "./loyalty.service.js";

@ApiTags("referrals")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/referrals")
export class ReferralController {
  constructor(private readonly service: LoyaltyService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  issue(@Req() request: AuthenticatedRequest) {
    return this.service.issueReferralCode(requireUser(request).id);
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return this.service.listReferrals(requireUser(request).id);
  }

  @Post("redeem")
  @HttpCode(HttpStatus.OK)
  redeem(@Req() request: AuthenticatedRequest, @Body() body: RedeemReferralDto) {
    return this.service.redeemReferral(requireUser(request).id, body.code);
  }
}
