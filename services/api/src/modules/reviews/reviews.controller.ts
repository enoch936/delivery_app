import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { ReviewsService } from "./reviews.service.js";

class CreateReviewDto {
  @IsUUID() orderId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) merchantRating!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) courierRating?: number;
  @IsOptional() @IsString() @Length(0, 1000) comment?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("reviews")
@Controller("v1/reviews")
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateReviewDto) {
    return this.service.create(requireUser(request).id, {
      orderId: body.orderId, merchantRating: body.merchantRating,
      courierRating: body.courierRating ?? null, comment: body.comment ?? null
    });
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.service.mine(requireUser(request).id);
  }

  @Get("merchant/:merchantId")
  forMerchant(@Param("merchantId", ParseUUIDPipe) merchantId: string, @Query() query: PageQuery) {
    return this.service.forMerchant(merchantId, query.limit ?? 20, query.offset ?? 0);
  }

  @Delete(":reviewId")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  remove(@Req() request: AuthenticatedRequest, @Param("reviewId", ParseUUIDPipe) reviewId: string) {
    return this.service.remove(requireUser(request).id, reviewId);
  }
}
