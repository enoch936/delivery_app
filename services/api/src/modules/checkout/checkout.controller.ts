import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CheckoutService } from "./checkout.service.js";

class CreateQuoteDto {
  @IsOptional() @IsUUID() merchantId?: string;
  @IsOptional() @IsIn(["delivery", "pickup"]) fulfillmentType?: "delivery" | "pickup";
  @IsOptional() @IsUUID() deliveryAddressId?: string;
  @IsOptional() @IsUUID() pickupLocationId?: string;
  @IsOptional() @IsString() @Length(3, 40) @Matches(/^[A-Za-z0-9-]+$/) promotionCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) tipMinor?: number;
  @IsOptional() @IsISO8601() scheduledFor?: string;
}

@ApiTags("checkout")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/checkout")
export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  @Post("quote")
  @ApiCreatedResponse({ description: "A server-calculated, expiring checkout quote for delivery or collection." })
  createQuote(@Req() request: AuthenticatedRequest, @Body() body: CreateQuoteDto) {
    return this.service.createQuote({ ...body, userId: requireUser(request).id });
  }
}
