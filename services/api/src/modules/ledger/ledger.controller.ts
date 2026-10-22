import { Controller, Get } from "@nestjs/common";
import { LedgerService } from "./ledger.service.js";

@Controller("api/v1/ledger")
export class LedgerController {
  constructor(private readonly service: LedgerService) {}
  @Get("balance")
  balance() { return this.service.balance(); }
}