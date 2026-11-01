import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { hashIp, requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { OrdersService } from "./orders.service.js";

const ORDER_BUCKETS = ["all", "active", "past", "cancelled", "failed"] as const;
const ISSUE_CATEGORIES = [
  "missing_item",
  "wrong_item",
  "damaged",
  "late_delivery",
  "never_delivered",
  "quality",
  "courier_issue",
  "merchant_issue",
  "refund_request",
  "other"
] as const;
const ISSUE_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"] as const;

class CreateOrderDto {
  @IsUUID() quoteId!: string;
}

class ListOrdersQuery {
  @IsOptional() @IsIn(["PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED", "ACCEPTED_BY_MERCHANT", "PREPARING", "READY_FOR_PICKUP", "COURIER_ASSIGNED", "COURIER_ARRIVING_PICKUP", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "FAILED", "REFUND_PENDING", "REFUNDED"]) status?: string;
  @IsOptional() @IsIn(ORDER_BUCKETS) bucket?: (typeof ORDER_BUCKETS)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class CancelOrderDto {
  @IsString() @Length(3, 300) reason!: string;
}

class RefundRequestDto {
  @IsString() @Length(3, 500) reason!: string;
}

class CreateIssueDto {
  @IsIn(ISSUE_CATEGORIES) category!: (typeof ISSUE_CATEGORIES)[number];
  @IsString() @Length(3, 2000) description!: string;
  @IsOptional() @IsIn(["LOW", "NORMAL", "HIGH", "URGENT"]) priority?: string;
}

class AdminIssueQuery {
  @IsOptional() @IsIn(ISSUE_STATUSES) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class UpdateIssueDto {
  @IsIn(ISSUE_STATUSES) status!: (typeof ISSUE_STATUSES)[number];
  @IsOptional() @IsString() @Length(1, 1000) resolution?: string;
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
    return this.service.list({
      userId: requireUser(request).id,
      status: query.status,
      bucket: query.bucket,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0
    });
  }

  @Get("admin/issues")
  @UseGuards(RolesGuard)
  @Roles("admin", "support", "operations")
  adminIssues(@Query() query: AdminIssueQuery) {
    return this.service.adminListIssues({ status: query.status, limit: query.limit ?? 50, offset: query.offset ?? 0 });
  }

  @Patch("admin/issues/:issueId")
  @UseGuards(RolesGuard)
  @Roles("admin", "support", "operations")
  updateIssue(
    @Req() request: AuthenticatedRequest,
    @Param("issueId", ParseUUIDPipe) issueId: string,
    @Body() body: UpdateIssueDto
  ) {
    return this.service.resolveIssue({
      issueId,
      actorUserId: requireUser(request).id,
      status: body.status,
      resolution: body.resolution,
      requestId: requestId(request),
      ipHash: hashIp(request.ip)
    });
  }

  @Get(":orderId")
  detail(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.detail(orderId, { userId: user.id, roles: user.roles });
  }

  @Get(":orderId/issues")
  async issues(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return { items: await this.service.listIssues(orderId, { userId: user.id, roles: user.roles }) };
  }

  @Post(":orderId/issues")
  reportIssue(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: CreateIssueDto
  ) {
    return this.service.reportIssue({
      orderId,
      userId: requireUser(request).id,
      category: body.category,
      description: body.description,
      priority: body.priority,
      requestId: requestId(request),
      ipHash: hashIp(request.ip)
    });
  }

  @Post(":orderId/refunds")
  requestRefund(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: RefundRequestDto
  ) {
    return this.service.requestRefund({
      orderId,
      userId: requireUser(request).id,
      reason: body.reason,
      requestId: requestId(request),
      ipHash: hashIp(request.ip)
    });
  }

  @Post(":orderId/cancel")
  cancel(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: CancelOrderDto) {
    const user = requireUser(request);
    return this.service.cancel({ orderId, userId: user.id, reason: body.reason, requestId: requestId(request), ipHash: hashIp(request.ip) });
  }
}
