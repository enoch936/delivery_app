import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { hashIp, requireUser, requestId } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { OrdersService } from "./orders.service.js";

class CreateOrderDto {
  @IsUUID() quoteId!: string;
}

class ListOrdersQuery {
  @IsOptional() @IsIn(["PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED", "ACCEPTED_BY_MERCHANT", "PREPARING", "READY_FOR_PICKUP", "COURIER_ASSIGNED", "COURIER_ARRIVING_PICKUP", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "FAILED", "REFUND_PENDING", "REFUNDED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class CancelOrderDto {
  @IsString() @Length(3, 300) reason!: string;
}

@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/orders")
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ description: "A persisted order created from an unexpired quote." })
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateOrderDto, @Headers("idempotency-key") idempotencyKey: string | undefined) {
    const user = requireUser(request);
    return this.service.create({
      userId: user.id, quoteId: body.quoteId, idempotencyKey: idempotencyKey ?? "",
      requestId: requestId(request), ipHash: hashIp(request.ip)
    });
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: ListOrdersQuery) {
    return this.service.list({ userId: requireUser(request).id, status: query.status, limit: query.limit ?? 20, offset: query.offset ?? 0 });
  }

  @Get(":orderId")
  detail(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.detail(orderId, { userId: user.id, roles: user.roles });
  }

  @Post(":orderId/cancel")
  cancel(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: CancelOrderDto) {
    const user = requireUser(request);
    return this.service.cancel({ orderId, userId: user.id, reason: body.reason, requestId: requestId(request), ipHash: hashIp(request.ip) });
  }
}
