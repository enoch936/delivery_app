import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";

@ApiTags("users")
@Controller("v1/users")
export class UsersController {
  @Get("me")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.authSession?.user };
  }
}
