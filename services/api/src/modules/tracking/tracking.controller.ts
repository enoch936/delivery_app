import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { TrackingService } from "./tracking.service.js";

@ApiTags("tracking")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/tracking")
export class TrackingController {
  constructor(private readonly service: TrackingService) {}

  @Get("participants")
  participants(@Req() request: AuthenticatedRequest) {
    const user = requireUser(request);
    return this.service.participants({ userId: user.id, roles: user.roles });
  }

  @Get(":orderId")
  track(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.track(orderId, { userId: user.id, roles: user.roles });
  }
}

@ApiTags("deliveries")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/deliveries")
export class DeliveryTrackingController {
  constructor(private readonly service: TrackingService) {}

  @Get(":orderId/tracking")
  track(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.track(orderId, { userId: user.id, roles: user.roles });
  }
}
