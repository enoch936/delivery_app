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

  @Get(":orderId")
  track(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.service.track(orderId, { userId: user.id, roles: user.roles });
  }
}
