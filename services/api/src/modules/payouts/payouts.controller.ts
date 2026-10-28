import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { PayoutsService } from "./payouts.service.js";

class CreatePayoutAccountDto {
  @IsIn(["merchant", "courier", "business"]) ownerType!: "merchant" | "courier" | "business";
  @IsString() ownerId!: string;
  @IsString() @Length(1, 50) provider!: string;
  @IsOptional() @IsString() @Length(1, 50) bankSlug?: string;
  @IsString() @Length(1, 200) accountName!: string;
  @IsOptional() @IsString() @Length(4, 4) accountNumberLast4?: string;
  @IsOptional() @IsString() providerAccountReference?: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class CreatePayoutBatchDto {
  @IsString() @Length(1, 50) provider!: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsArray() @ValidateNested({ each: true }) items!: Array<{ settlementKind: "merchant" | "courier"; settlementId: string; payoutAccountId: string }>;
}

class CompleteBatchItemDto {
  @IsIn(["succeeded", "failed"]) status!: "succeeded" | "failed";
  @IsOptional() @IsString() providerReference?: string;
  @IsOptional() @IsString() failureReason?: string;
}

class BatchListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("payouts")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1/admin/payouts")
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post("accounts")
  @Roles("admin", "finance")
  createAccount(@Req() request: AuthenticatedRequest, @Body() body: CreatePayoutAccountDto) {
    return this.service.createAccount({ ...body, createdBy: requireUser(request).id });
  }

  @Get("accounts")
  @Roles("admin", "finance")
  listAccounts(@Query("ownerType") ownerType: string, @Query("ownerId") ownerId: string) {
    return this.service.listAccounts(ownerType, ownerId);
  }

  @Post("accounts/:accountId/verify")
  @Roles("admin", "finance")
  verifyAccount(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.verifyAccount(accountId, requireUser(request).id, requestId(request));
  }

  @Post("batches")
  @Roles("admin", "finance")
  createBatch(@Req() request: AuthenticatedRequest, @Body() body: CreatePayoutBatchDto) {
    return this.service.createBatch({ ...body, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }

  @Get("batches")
  @Roles("admin", "finance")
  listBatches(@Query() query: BatchListQuery) {
    return this.service.listBatches(query.limit ?? 50, query.offset ?? 0);
  }

  @Get("batches/:batchId")
  @Roles("admin", "finance")
  getBatch(@Param("batchId", ParseUUIDPipe) batchId: string) {
    return this.service.getBatch(batchId);
  }

  @Post("batches/:batchId/submit")
  @Roles("admin", "finance")
  submitBatch(@Req() request: AuthenticatedRequest, @Param("batchId", ParseUUIDPipe) batchId: string) {
    return this.service.submitBatch(batchId, requireUser(request).id, requestId(request));
  }

  @Post("batches/:batchId/items/:itemId/complete")
  @Roles("admin", "finance")
  completeItem(
    @Req() request: AuthenticatedRequest,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() body: CompleteBatchItemDto
  ) {
    return this.service.completeBatchItem({ batchId, itemId, ...body, actorUserId: requireUser(request).id, requestId: requestId(request) });
  }
}
