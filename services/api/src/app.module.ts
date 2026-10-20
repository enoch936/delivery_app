import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";

@Module({ imports: [HealthModule, PlatformModule] })
export class AppModule {}
