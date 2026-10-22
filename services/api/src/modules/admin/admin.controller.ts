import { Controller, Get } from "@nestjs/common";
import { AdminService } from "./admin.service.js";

@Controller("api/v1/admin")
export class AdminController {
  constructor(private readonly service: AdminService) {}
  @Get("dashboard")
  dashboard() { return this.service.dashboard(); }
}