import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { SettlementsService, type SettlementDecision, type SettlementKind } from "./settlements.service.js";

class SettlementPageQuery {
  @IsOptional() @IsIn(["PENDING", "APPROVED", "PAID", "FAILED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class SettlementPreviewQuery {
  @IsIn(["merchant", "courier"]) kind!: SettlementKind;
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}

class GenerateSettlementsDto {
  @IsIn(["merchant", "courier"]) kind!: SettlementKind;
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}

class TransitionSettlementDto {
  @IsIn(["approve", "fail", "pay"]) decision!: SettlementDecision;
  @IsOptional() @IsString() @Length(0, 200) paymentReference?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

@ApiTags("settlements")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin", "finance")
@Controller("v1/admin/settlements")
export class SettlementsController {
  constructor(private readonly service: SettlementsService) {}

  @Get("preview")
  preview(@Query() query: SettlementPreviewQuery) {
    return this.service.preview(query.kind, new Date(query.from), new Date(query.to));
  }

  @Post("generate")
  generate(@Req() request: AuthenticatedRequest, @Body() body: GenerateSettlementsDto) {
    return this.service.generate({
      kind: body.kind, from: new Date(body.from), to: new Date(body.to),
      actorUserId: requireUser(request).id, requestId: requestId(request)
    });
  }

  @Get("merchants")
  merchants(@Query() query: SettlementPageQuery) {
    return this.service.listMerchants(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("merchants/:settlementId")
  merchant(@Param("settlementId", ParseUUIDPipe) settlementId: string) {
    return this.service.merchantDetail(settlementId);
  }

  @Post("merchants/:settlementId/transition")
  transitionMerchant(
    @Req() request: AuthenticatedRequest,
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Body() body: TransitionSettlementDto
  ) {
    return this.service.transitionMerchant({
      settlementId, decision: body.decision, actorUserId: requireUser(request).id, requestId: requestId(request),
      paymentReference: body.paymentReference, notes: body.notes
    });
  }

  @Get("couriers")
  couriers(@Query() query: SettlementPageQuery) {
    return this.service.listCouriers(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("couriers/:payoutId")
  courier(@Param("payoutId", ParseUUIDPipe) payoutId: string) {
    return this.service.courierDetail(payoutId);
  }

  @Post("couriers/:payoutId/transition")
  transitionCourier(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() body: TransitionSettlementDto
  ) {
    return this.service.transitionCourier({
      payoutId, decision: body.decision, actorUserId: requireUser(request).id, requestId: requestId(request),
      paymentReference: body.paymentReference, notes: body.notes
    });
  }
}
