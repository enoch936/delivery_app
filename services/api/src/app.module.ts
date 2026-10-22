import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { DiscoveryModule } from "./modules/discovery/discovery.module.js";
import { UsersModule } from "./modules/users/users.module.js";

@Module({ imports: [HealthModule, PlatformModule, AuthModule, DiscoveryModule, UsersModule] })
export class AppModule {}
