import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length } from "class-validator";
import { requestId, requireUser } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { OperatorService } from "./operator.service.js";

class ManualAssignDto {
  @IsUUID() courierUserId!: string;
}

class ReassignDto {
  @IsUUID() courierUserId!: string;
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

class CancelOrderDto {
  @IsString() @Length(3, 500) reason!: string;
}

@ApiTags("operator")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin", "operations")
@Controller("v1/operator")
export class OperatorController {
  constructor(private readonly service: OperatorService) {}

  @Get("live")
  live() {
    return this.service.liveSnapshot();
  }

  @Post("orders/:orderId/assign")
  assign(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: ManualAssignDto
  ) {
    return this.service.manualAssign(requireUser(request).id, orderId, body.courierUserId, requestId(request));
  }

  @Post("orders/:orderId/reassign")
  reassign(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: ReassignDto
  ) {
    return this.service.reassign(requireUser(request).id, orderId, body.courierUserId, body.reason ?? null, requestId(request));
  }

  @Post("orders/:orderId/cancel")
  cancelOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: CancelOrderDto
  ) {
    return this.service.cancelOrder(requireUser(request).id, orderId, body.reason, requestId(request));
  }

  @Get("orders/:orderId/timeline")
  @Roles("admin", "operations", "support")
  timeline(@Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.deliveryTimeline(orderId);
  }
}
