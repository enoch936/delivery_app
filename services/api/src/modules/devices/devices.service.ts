import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

export type DeviceRegistration = Readonly<{
  token: string;
  platform: "android" | "ios" | "web" | "other";
  app: "customer" | "courier";
  appVersion?: string;
}>;

@Injectable()
export class DevicesService {
  constructor(private readonly database: DatabaseService) {}

  async register(userId: string, device: DeviceRegistration): Promise<void> {
    await this.database.query(
      `INSERT INTO device_tokens (user_id, token, platform, app, app_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         app = EXCLUDED.app,
         app_version = EXCLUDED.app_version,
         last_seen_at = now(),
         revoked_at = NULL,
         updated_at = now()`,
      [userId, device.token, device.platform, device.app, device.appVersion ?? null]
    );
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.database.query(
      `UPDATE device_tokens
       SET revoked_at = now(), updated_at = now()
       WHERE user_id = $1 AND token = $2 AND revoked_at IS NULL`,
      [userId, token]
    );
  }
}
