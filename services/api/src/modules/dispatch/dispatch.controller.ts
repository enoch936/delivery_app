import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length } from "class-validator";
import { hashIp, requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { DispatchService } from "./dispatch.service.js";

class ReassignDto {
  @IsUUID() courierId!: string;
  @IsString() @Length(3, 300) reason!: string;
}

class RejectOfferDto {
  @IsOptional() @IsString() @Length(0, 300) reason?: string;
}

@ApiTags("dispatch")
@ApiBearerAuth()
@Controller("v1")
@UseGuards(SessionGuard, RolesGuard)
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @Get("admin/dispatch/orders/:orderId/candidates")
  @Roles("admin", "operations", "support")
  candidates(@Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.findCandidates(orderId).then((items) => ({ items }));
  }

  @Post("admin/dispatch/orders/:orderId/offer")
  @Roles("admin", "operations")
  async offer(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.offerOrder({ orderId, actorUserId: user.id, requestId: requestId(request) });
  }

  @Post("admin/dispatch/orders/:orderId/reassign")
  @Roles("admin", "operations")
  async reassign(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: ReassignDto) {
    const user = requireUser(request);
    await this.service.reassign({ orderId, courierId: body.courierId, actorUserId: user.id, reason: body.reason, requestId: requestId(request) });
    return { reassigned: true };
  }

  @Get("courier/offers")
  @Roles("courier")
  listOffers(@Req() request: AuthenticatedRequest) {
    return this.service.listOffers(requireUser(request).id);
  }

  @Post("courier/offers/:offerId/accept")
  @Roles("courier")
  accept(@Req() request: AuthenticatedRequest, @Param("offerId", ParseUUIDPipe) offerId: string) {
    const user = requireUser(request);
    return this.service.acceptOffer(user.id, offerId, requestId(request));
  }

  @Post("courier/offers/:offerId/reject")
  @Roles("courier")
  async reject(@Req() request: AuthenticatedRequest, @Param("offerId", ParseUUIDPipe) offerId: string, @Body() body: RejectOfferDto) {
    const user = requireUser(request);
    await this.service.rejectOffer(user.id, offerId, body.reason, requestId(request));
    return { rejected: true };
  }
}
