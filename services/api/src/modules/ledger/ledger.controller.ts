import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { LedgerService } from "./ledger.service.js";

@ApiTags("ledger")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
@Controller("v1/admin/ledger")
export class LedgerController {
  constructor(private readonly service: LedgerService) {}

  @Get("balances")
  balances() {
    return this.service.balances();
  }
}
