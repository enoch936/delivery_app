import { Controller, Post } from "@nestjs/common";
import { PaymentsService } from "./payments.service.js";

@Controller("api/v1/payments")
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Post("initiate")
  initiate() { return this.service.initiate(); }
}