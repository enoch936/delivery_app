import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { ChatService } from "./chat.service.js";

class MessageDto {
  @IsString() @Length(1, 4000) body!: string;
}

class AttachmentDto {
  @IsString() @Length(3, 500) storageKey!: string;
  @IsString() @Length(3, 120) contentType!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_485_760) sizeBytes!: number;
}

class MessageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() before?: string;
}

@ApiTags("chat")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/conversations")
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(requireUser(request).id);
  }

  @Post("orders/:orderId")
  orderConversation(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.ensureOrderConversation(requireUser(request).id, orderId);
  }

  @Get(":conversationId/messages")
  messages(@Req() request: AuthenticatedRequest, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Query() query: MessageQuery) {
    return this.service.messages(conversationId, requireUser(request).id, query.limit ?? 50, query.before);
  }

  @Post(":conversationId/messages")
  send(@Req() request: AuthenticatedRequest, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() body: MessageDto) {
    return this.service.send(conversationId, requireUser(request).id, body.body);
  }

  @Post(":conversationId/read")
  read(@Req() request: AuthenticatedRequest, @Param("conversationId", ParseUUIDPipe) conversationId: string) {
    return this.service.markRead(conversationId, requireUser(request).id);
  }

  @Post(":conversationId/messages/:messageId/attachments")
  attachment(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
    @Body() body: AttachmentDto
  ) {
    return this.service.addAttachment(conversationId, messageId, requireUser(request).id, body);
  }
}
