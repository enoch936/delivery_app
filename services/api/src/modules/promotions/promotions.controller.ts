import { Controller, Get } from "@nestjs/common";
import { PromotionsService } from "./promotions.service.js";

@Controller("api/v1/promotions")
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}
  @Get()
  list() { return this.service.list(); }
}