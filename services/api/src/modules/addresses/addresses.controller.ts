import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AddressesService } from "./addresses.service.js";

@Controller("api/v1/addresses")
export class AddressesController {
  constructor(private readonly service: AddressesService) {}
  @Get()
  list() { return this.service.list("me"); }
  @Post()
  create(@Body() body: any) { return this.service.create("me", body); }
}