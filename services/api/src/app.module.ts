import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { DiscoveryModule } from "./modules/discovery/discovery.module.js";
import { CheckoutModule } from "./modules/checkout/checkout.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";

@Module({ imports: [HealthModule, PlatformModule, AuthModule,     DiscoveryModule,
    CheckoutModule,     UsersModule,
    OrdersModule] })
export class AppModule {}
