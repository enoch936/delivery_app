import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min, IsUUID } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { LoyaltyService } from "./loyalty.service.js";

class RedeemLoyaltyDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  points!: number;
}

class RedeemRewardDto {
  @IsUUID()
  rewardId!: string;
}

@ApiTags("loyalty")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/loyalty")
export class LoyaltyController {
  constructor(private readonly service: LoyaltyService) {}

  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return this.service.getLoyalty(requireUser(request).id);
  }

  @Get("rewards")
  @ApiOkResponse({ description: "Redeemable loyalty rewards with their point cost and stock." })
  rewards() {
    return this.service.listRewards();
  }

  @Post("redeem")
  @HttpCode(HttpStatus.OK)
  redeem(@Req() request: AuthenticatedRequest, @Body() body: RedeemLoyaltyDto) {
    return this.service.redeem(requireUser(request).id, { points: body.points });
  }

  @Post("rewards/redeem")
  @HttpCode(HttpStatus.OK)
  redeemReward(@Req() request: AuthenticatedRequest, @Body() body: RedeemRewardDto) {
    return this.service.redeemReward(requireUser(request).id, { rewardId: body.rewardId });
  }
}
