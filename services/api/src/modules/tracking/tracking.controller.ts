import { Controller, Get, Param } from "@nestjs/common";
import { TrackingService } from "./tracking.service.js";

@Controller("api/v1/orders")
export class TrackingController {
  constructor(private readonly service: TrackingService) {}
  @Get(":orderId/tracking")
  get(@Param("orderId") orderId: string) { return this.service.getTracking(orderId); }
}