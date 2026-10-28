import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { SubscriptionsService } from "./subscriptions.service.js";

class CreatePlanDto {
  @IsString() @Length(1, 50) code!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(["month", "year"]) billingInterval!: "month" | "year";
  @IsInt() @Min(0) priceMinor!: number;
  @IsString() @Length(3, 3) currency!: string;
  @IsOptional() @IsInt() @Min(0) includedDeliveries?: number;
  @IsOptional() @IsInt() @Min(0) discountBps?: number;
}

class SubscribeDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() businessAccountId?: string;
  @IsString() planId!: string;
  @IsString() @Length(1, 50) provider!: string;
  @IsOptional() @IsString() providerReference?: string;
}

@ApiTags("subscriptions")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1")
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get("subscriptions/plans")
  listPlans() {
    return this.service.listPlans();
  }

  @Post("admin/subscriptions/plans")
  @Roles("admin", "finance")
  createPlan(@Req() request: AuthenticatedRequest, @Body() body: CreatePlanDto) {
    return this.service.createPlan({ ...body, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }

  @Post("subscriptions/subscribe")
  subscribe(@Req() request: AuthenticatedRequest, @Body() body: SubscribeDto) {
    return this.service.subscribe({ ...body, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }

  @Get("subscriptions/:subscriptionId")
  getSubscription(@Param("subscriptionId", ParseUUIDPipe) subscriptionId: string) {
    return this.service.getSubscription(subscriptionId);
  }

  @Post("subscriptions/:subscriptionId/cancel")
  cancel(@Req() request: AuthenticatedRequest, @Param("subscriptionId", ParseUUIDPipe) subscriptionId: string) {
    return this.service.cancel(subscriptionId, requireUser(request).id, requestId(request));
  }
}
