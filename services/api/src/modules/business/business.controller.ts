import { Controller, Get } from "@nestjs/common";
import { BusinessService } from "./business.service.js";

@Controller("api/v1/business")
export class BusinessController {
  constructor(private readonly service: BusinessService) {}
  @Get("accounts")
  list() { return this.service.listAccounts(); }
}