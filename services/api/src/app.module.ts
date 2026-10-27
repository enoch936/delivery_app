import { Module } from "@nestjs/common";
import { CommonModule } from "./common/common.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { DiscoveryModule } from "./modules/discovery/discovery.module.js";
import { CheckoutModule } from "./modules/checkout/checkout.module.js";
import { CartModule } from "./modules/cart/cart.module.js";
import { AddressesModule } from "./modules/addresses/addresses.module.js";
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
import { ConfigModule } from "./modules/config/config.module.js";
import { DispatchModule } from "./modules/dispatch/dispatch.module.js";
import { LedgerModule } from "./modules/ledger/ledger.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { PromotionsModule } from "./modules/promotions/promotions.module.js";
import { ReviewsModule } from "./modules/reviews/reviews.module.js";
import { ZonesModule } from "./modules/zones/zones.module.js";
import { GeocodingModule } from "./modules/geocoding/geocoding.module.js";
import { DevicesModule } from "./modules/devices/devices.module.js";

@Module({
  imports: [
    DatabaseModule,
    CommonModule,
    HealthModule,
    PlatformModule,
    AuthModule,
    DiscoveryModule,
    CheckoutModule,
    CartModule,
    AddressesModule,
    UsersModule,
    OrdersModule,
    MerchantModule,
    CourierModule,
    AdminModule,
    BusinessModule,
    NotificationsModule,
    ChatModule,
    PaymentsModule,
    SupportModule,
    TrackingModule,
    ConfigModule,
    DispatchModule,
    LedgerModule,
    ReportsModule,
    PromotionsModule,
    ReviewsModule,
    ZonesModule,
    GeocodingModule,
    DevicesModule
  ]
})
export class AppModule {}
