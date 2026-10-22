import { Controller, Get } from "@nestjs/common";
import { ReviewsService } from "./reviews.service.js";

@Controller("api/v1/reviews")
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}
  @Get()
  list() { return this.service.list(); }
}