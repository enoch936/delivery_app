import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { PaymentsService } from "./payments.service.js";
import type { PaymentMethod } from "./payments.types.js";

class InitiatePaymentDto {
  @IsIn(["cash", "chapa", "sandbox", "stripe"]) method!: PaymentMethod;
}

class SandboxCompleteDto {
  @IsIn(["succeeded", "failed"]) outcome!: "succeeded" | "failed";
}

class ReviewRefundDto {
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class RefundListQuery {
  @IsOptional() @IsIn(["PENDING", "APPROVED", "REJECTED", "PROCESSING", "SUCCEEDED", "FAILED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class WebhookEventListQuery {
  @IsOptional() @IsIn(["failed", "invalid", "unprocessed"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class RunReconciliationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() paymentId?: string;
}

@ApiTags("payments")
@ApiBearerAuth()
@Controller("v1")
@UseGuards(SessionGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post("payments/orders/:orderId/initiate")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  initiate(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: InitiatePaymentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined
  ) {
    const user = requireUser(request);
    return this.service.initiate({ userId: user.id, orderId, method: body.method, idempotencyKey: idempotencyKey ?? null, requestId: requestId(request) });
  }

  @Get("payments/orders/:orderId")
  listForOrder(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.listForOrder(requireUser(request).id, orderId);
  }

  @Get("payments/:paymentId")
  get(@Req() request: AuthenticatedRequest, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.service.get(requireUser(request).id, paymentId);
  }

  @Post("payments/sandbox/:paymentId/complete")
  sandboxComplete(@Req() request: AuthenticatedRequest, @Param("paymentId", ParseUUIDPipe) paymentId: string, @Body() body: SandboxCompleteDto) {
    const user = requireUser(request);
    return this.service.sandboxComplete(user.id, paymentId, body.outcome, requestId(request)).then(() => ({ completed: true }));
  }

  @Get("admin/refunds")
  @Roles("admin", "finance", "support")
  refunds(@Query() query: RefundListQuery) {
    return this.service.listRefunds(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Post("admin/refunds/:refundId/review")
  @Roles("admin", "finance")
  review(@Req() request: AuthenticatedRequest, @Param("refundId", ParseUUIDPipe) refundId: string, @Body() body: ReviewRefundDto) {
    const user = requireUser(request);
    return this.service.reviewRefund({ refundId, actorUserId: user.id, decision: body.decision, note: body.note ?? undefined, requestId: requestId(request) });
  }

  @Get("admin/reconciliation/summary")
  @Roles("admin", "finance")
  reconciliationSummary() {
    return this.service.reconciliationSummary();
  }

  @Get("admin/reconciliation/webhooks")
  @Roles("admin", "finance")
  webhookEvents(@Query() query: WebhookEventListQuery) {
    return this.service.listWebhookEvents(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Post("admin/reconciliation/webhooks/:eventId/replay")
  @Roles("admin", "finance")
  replayWebhook(@Req() request: AuthenticatedRequest, @Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.service.replayWebhookEvent({ eventId, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }

  @Post("admin/reconciliation/payments/run")
  @Roles("admin", "finance")
  reconcilePayments(@Req() request: AuthenticatedRequest, @Body() body: RunReconciliationDto) {
    return this.service.reconcilePayments({
      actorUserId: requireUser(request).id, requestId: requestId(request),
      paymentId: body.paymentId, limit: body.limit ?? 25
    });
  }
}

@ApiTags("payments")
@Controller("v1/payments/webhooks")
export class PaymentWebhookController {
  constructor(private readonly service: PaymentsService) {}

  @Post(":provider")
  async webhook(
    @Param("provider") provider: string,
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers("x-chapa-signature") chapaSignature: string | undefined,
    @Headers("x-webhook-signature") genericSignature: string | undefined,
    @Headers("stripe-signature") stripeSignature: string | undefined
  ) {
    if (!["chapa", "sandbox", "stripe"].includes(provider)) throw new BadRequestException("Unsupported payment provider.");
    const raw = request.rawBody?.toString("utf8") ?? JSON.stringify(request.body ?? {});
    const signature = provider === "chapa" ? chapaSignature : provider === "stripe" ? stripeSignature : genericSignature;
    return this.service.handleWebhook(provider, raw, signature, (request.body ?? {}) as Record<string, unknown>);
  }
}

