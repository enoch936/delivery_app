import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { DiscoveryModule } from "./modules/discovery/discovery.module.js";
import { CheckoutModule } from "./modules/checkout/checkout.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { MerchantModule } from "./modules/merchant/merchant.module.js";
import { CourierModule } from "./modules/courier/courier.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { BusinessModule } from "./modules/business/business.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { PaymentsModule } from "./modules/payments/payments.module.js";
import { SupportModule } from "./modules/support/support.module.js";
import { TrackingModule } from "./modules/tracking/tracking.module.js";

@Module({ imports: [HealthModule, PlatformModule, AuthModule,     DiscoveryModule,
    CheckoutModule,     UsersModule,
    OrdersModule,
    MerchantModule,
    CourierModule,
    AdminModule,
    BusinessModule,
    NotificationsModule,
    ChatModule,
    PaymentsModule,
    SupportModule,
    TrackingModule] })
export class AppModule {}
