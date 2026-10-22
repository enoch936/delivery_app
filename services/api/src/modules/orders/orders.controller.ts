import { Body, Controller, Post } from "@nestjs/common";
import { OrdersService } from "./orders.service.js";

@Controller("api/v1/orders")
export class OrdersController {
  constructor(private readonly service: OrdersService) {}
  @Post()
  create(@Body() body: { userId: string; currency: string; totalMinor: string }) {
    return this.service.createOrder({ userId: body.userId, currency: body.currency, totalMinor: BigInt(body.totalMinor) });
  }
}