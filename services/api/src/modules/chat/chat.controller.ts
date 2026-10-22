import { Controller, Get, Param } from "@nestjs/common";
import { ChatService } from "./chat.service.js";

@Controller("api/v1/orders")
export class ChatController {
  constructor(private readonly service: ChatService) {}
  @Get(":orderId/messages")
  list(@Param("orderId") orderId: string) { return this.service.listMessages(orderId); }
}