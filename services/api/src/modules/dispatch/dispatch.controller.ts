import { Body, Controller, Post } from "@nestjs/common";
import { DispatchService } from "./dispatch.service.js";

@Controller("api/v1/dispatch")
export class DispatchController {
  constructor(private readonly service: DispatchService) {}
  @Post("assign")
  assign(@Body() body: { orderId: string; courierId: string }) { return this.service.assign(body.orderId, body.courierId); }
}