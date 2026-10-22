import { Body, Controller, Post } from "@nestjs/common";
import { CourierService } from "./courier.service.js";

@Controller("api/v1/courier")
export class CourierController {
  constructor(private readonly service: CourierService) {}
  @Post("availability")
  set(@Body() body: { online: boolean }) { return this.service.setAvailability(body.online); }
}