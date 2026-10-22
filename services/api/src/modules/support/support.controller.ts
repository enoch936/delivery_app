import { Controller, Get } from "@nestjs/common";
import { SupportService } from "./support.service.js";

@Controller("api/v1/support")
export class SupportController {
  constructor(private readonly service: SupportService) {}
  @Get("tickets")
  list() { return this.service.listTickets(); }
}