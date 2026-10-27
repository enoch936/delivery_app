import { Controller, Get, Header, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ReportsService } from "./reports.service.js";

class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

class OrderReportQuery extends RangeQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin", "finance", "operations")
@Controller("v1/admin/reports")
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get("summary")
  summary(@Query() query: RangeQuery) {
    return this.service.summary(...range(query));
  }

  @Get("daily")
  daily(@Query() query: RangeQuery) {
    return this.service.daily(...range(query));
  }

  @Get("orders")
  orders(@Query() query: OrderReportQuery) {
    return this.service.orders(...range(query), query.status, query.limit ?? 100, query.offset ?? 0);
  }

  @Get("merchants")
  merchants(@Query() query: RangeQuery) {
    return this.service.merchants(...range(query));
  }

  @Get("couriers")
  couriers(@Query() query: RangeQuery) {
    return this.service.couriers(...range(query));
  }

  @Get("finance")
  finance(@Query() query: RangeQuery) {
    return this.service.finance(...range(query));
  }

  @Get("orders.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async csv(@Query() query: RangeQuery, @Res() reply: FastifyReply) {
    const csv = await this.service.ordersCsv(...range(query));
    reply.header("Content-Disposition", "attachment; filename=orders.csv").send(csv);
  }
}

function range(query: RangeQuery): [Date, Date] {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return [new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to];
  return [from, to];
}
