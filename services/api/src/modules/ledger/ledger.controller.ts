import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { LedgerService } from "./ledger.service.js";

class LedgerPageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

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

  @Get("entries")
  entries(@Query() query: LedgerPageQuery) {
    return this.service.entries(query.limit ?? 100, query.offset ?? 0);
  }
}
