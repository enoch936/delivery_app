import { Controller, Get } from "@nestjs/common";
import { MerchantService } from "./merchant.service.js";

@Controller("api/v1/merchant")
export class MerchantController {
  constructor(private readonly service: MerchantService) {}
  @Get("orders")
  list() { return this.service.listOrders(); }
}