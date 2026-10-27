import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { SupportService } from "./support.service.js";

class CreateTicketDto {
  @IsString() @Length(3, 160) subject!: string;
  @IsOptional() @IsString() @Length(1, 40) category?: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsIn(["LOW", "NORMAL", "HIGH", "URGENT"]) priority?: string;
  @IsString() @Length(1, 4000) message!: string;
}

class ReplyDto {
  @IsString() @Length(1, 4000) body!: string;
  @IsOptional() @IsBoolean() internal?: boolean;
}

class AssignDto {
  @IsOptional() @IsUUID() assignedTo?: string | null;
}

class StatusDto {
  @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) status!: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class AdminTicketQuery extends PageQuery {
  @IsOptional() @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) status?: string;
  @IsOptional() @IsIn(["LOW", "NORMAL", "HIGH", "URGENT"]) priority?: string;
}

@ApiTags("support")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1")
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Post("support/tickets")
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateTicketDto) {
    return this.service.create(requireUser(request).id, {
      subject: body.subject, category: body.category ?? "general", orderId: body.orderId ?? null,
      priority: body.priority ?? "NORMAL", message: body.message
    });
  }

  @Get("support/tickets")
  mine(@Req() request: AuthenticatedRequest, @Query() query: PageQuery) {
    return this.service.mine(requireUser(request).id, query.limit ?? 30, query.offset ?? 0);
  }

  @Get("support/tickets/:ticketId")
  detail(@Req() request: AuthenticatedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string) {
    const user = requireUser(request);
    return this.service.detail(user.id, ticketId, user.roles.some((role) => ["admin", "support", "operations"].includes(role)));
  }

  @Post("support/tickets/:ticketId/messages")
  reply(@Req() request: AuthenticatedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() body: ReplyDto) {
    const user = requireUser(request);
    return this.service.reply(user.id, ticketId, body.body, user.roles.some((role) => ["admin", "support", "operations"].includes(role)), body.internal ?? false);
  }

  @Get("admin/support/tickets")
  @Roles("admin", "support", "operations")
  adminList(@Query() query: AdminTicketQuery) {
    return this.service.adminList(query.status, query.priority, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("admin/support/tickets/:ticketId")
  @Roles("admin", "support", "operations")
  adminDetail(@Req() request: AuthenticatedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string) {
    return this.service.detail(requireUser(request).id, ticketId, true);
  }

  @Post("admin/support/tickets/:ticketId/messages")
  @Roles("admin", "support", "operations")
  adminReply(@Req() request: AuthenticatedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() body: ReplyDto) {
    return this.service.reply(requireUser(request).id, ticketId, body.body, true, body.internal ?? false);
  }

  @Patch("admin/support/tickets/:ticketId/assignment")
  @Roles("admin", "support", "operations")
  assign(@Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() body: AssignDto) {
    return this.service.assign(ticketId, "system", body.assignedTo ?? null);
  }

  @Patch("admin/support/tickets/:ticketId/status")
  @Roles("admin", "support", "operations")
  status(@Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() body: StatusDto) {
    return this.service.setStatus(ticketId, body.status);
  }
}
