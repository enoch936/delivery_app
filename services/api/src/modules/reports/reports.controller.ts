import { Controller, Get } from "@nestjs/common";
import { ReportsService } from "./reports.service.js";

@Controller("api/v1/reports")
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @Get("summary")
  summary() { return this.service.summary(); }
}