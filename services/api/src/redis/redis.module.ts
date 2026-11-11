import { Global, Module } from "@nestjs/common";
import { LatestLocationService } from "./latest-location.service.js";
import { RedisService } from "./redis.service.js";

@Global()
@Module({
  providers: [RedisService, LatestLocationService],
  exports: [RedisService, LatestLocationService]
})
export class RedisModule {}
