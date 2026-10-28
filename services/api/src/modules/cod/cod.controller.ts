import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CodService } from "./cod.service.js";

class RemitCodDto {
  @IsString() remittanceReference!: string;
}

class CodListQuery {
  @IsOptional() @IsIn(["PENDING", "COLLECTED", "REMITTED", "RECONCILED", "FAILED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("cod")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin", "finance", "operations")
@Controller("v1/admin/cod")
export class CodController {
  constructor(private readonly service: CodService) {}

  @Get()
  list(@Query() query: CodListQuery) {
    return this.service.list(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get(":orderId")
  get(@Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.get(orderId);
  }

  @Post(":orderId/ensure")
  ensure(@Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.ensureForOrder(orderId);
  }

  @Post(":orderId/collect")
  collect(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.markCollected(orderId, requireUser(request).id, requestId(request));
  }

  @Post(":orderId/remit")
  remit(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: RemitCodDto) {
    return this.service.remit({ orderId, remittanceReference: body.remittanceReference, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }

  @Post(":orderId/reconcile")
  reconcile(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.reconcile(orderId, requireUser(request).id, requestId(request));
  }
}
