import { Controller, Get } from "@nestjs/common";
import { ZonesService } from "./zones.service.js";

@Controller("api/v1/zones")
export class ZonesController {
  constructor(private readonly service: ZonesService) {}
  @Get()
  list() { return this.service.list(); }
}