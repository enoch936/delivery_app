import { Controller, Get } from "@nestjs/common";
import { NotificationsService } from "./notifications.service.js";

@Controller("api/v1/notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Get()
  list() { return this.service.list(); }
}