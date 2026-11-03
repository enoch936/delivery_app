import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";

@Injectable()
export class BusinessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async register(userId: string, input: Readonly<{ name: string; billingEmail: string | null; billingPhone: string | null; taxIdentifier: string | null; monthlySpendLimitMinor: number | null; currency: string }>) {
    return this.database.withTransaction(async (client) => {
      const account = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO business_accounts (display_name, billing_email, billing_phone_e164, tax_identifier, monthly_spend_limit_minor, currency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [input.name, input.billingEmail, input.billingPhone, input.taxIdentifier, input.monthlySpendLimitMinor, input.currency, userId]
      );
      const id = account.rows[0]?.id;
      if (!id) throw new Error("Business account creation failed.");
      await client.query("INSERT INTO business_members (business_account_id, user_id, member_role) VALUES ($1,$2,'owner')", [id, userId]);
      return { id, status: "pending", createdAt: account.rows[0]?.created_at.toISOString() };
    });
  }

  async mine(userId: string) {
    const result = await this.database.query(
      `SELECT ba.id, ba.display_name AS name, ba.status, ba.currency, ba.monthly_spend_limit_minor, bm.member_role
       FROM business_accounts ba JOIN business_members bm ON bm.business_account_id = ba.id AND bm.user_id = $1
       ORDER BY ba.created_at DESC`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, name: row.name as string, status: row.status as string, currency: row.currency as string,
        role: row.member_role as string, monthlySpendLimitMinor: (row.monthly_spend_limit_minor as string | null) === null ? null : Number(row.monthly_spend_limit_minor)
      }))
    };
  }

  async detail(userId: string, accountId: string) {
    await this.requireMember(userId, accountId);
    const [account, members, locations, spend] = await Promise.all([
      this.database.query("SELECT id, display_name AS name, status, billing_email, billing_phone_e164, tax_identifier, monthly_spend_limit_minor, currency, created_at FROM business_accounts WHERE id = $1", [accountId]),
      this.database.query("SELECT bm.user_id, bm.member_role, u.display_name, u.phone_e164 FROM business_members bm JOIN users u ON u.id = bm.user_id WHERE bm.business_account_id = $1", [accountId]),
      this.database.query("SELECT id, label, address_line, contact_name, contact_phone_e164, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM business_locations WHERE business_account_id = $1 ORDER BY label", [accountId]),
      this.database.query<{ month_spend: string; total_orders: number }>(
        `SELECT COALESCE(sum(o.total_minor) FILTER (WHERE o.created_at >= date_trunc('month', now()) AND o.status NOT IN ('CANCELLED','FAILED')),0)::text AS month_spend,
                count(*)::int AS total_orders
         FROM business_orders bo JOIN orders o ON o.id = bo.order_id WHERE bo.business_account_id = $1`, [accountId]
      )
    ]);
    const row = account.rows[0];
    if (!row) throw new NotFoundException("Business account not found.");
    return {
      id: row.id, name: row.name, status: row.status, billingEmail: row.billing_email, billingPhone: row.billing_phone_e164,
      taxIdentifier: row.tax_identifier, monthlySpendLimitMinor: row.monthly_spend_limit_minor === null ? null : Number(row.monthly_spend_limit_minor),
      currency: row.currency, createdAt: (row.created_at as Date).toISOString(),
      members: members.rows.map((member) => ({ userId: member.user_id, role: member.member_role, displayName: member.display_name, phoneE164: member.phone_e164 })),
      locations: locations.rows.map((location) => ({
        id: location.id, label: location.label, addressLine: location.address_line, contactName: location.contact_name,
        contactPhoneE164: location.contact_phone_e164, latitude: location.latitude === null ? null : Number(location.latitude),
        longitude: location.longitude === null ? null : Number(location.longitude)
      })),
      spend: { monthSpendMinor: Number(spend.rows[0]?.month_spend ?? 0), totalOrders: spend.rows[0]?.total_orders ?? 0 }
    };
  }

  async addMember(userId: string, accountId: string, phoneE164: string, role: "admin" | "member" | "driver") {
    const membership = await this.requireMember(userId, accountId);
    if (!["owner", "admin"].includes(membership.role)) throw new ForbiddenException("Only business owners and admins can add members.");
    const user = await this.database.query<{ id: string }>("SELECT id FROM users WHERE phone_e164 = $1", [phoneE164]);
    const target = user.rows[0];
    if (!target) throw new NotFoundException("No user with that phone number exists.");
    const existing = await this.database.query<{ member_role: string }>(
      "SELECT member_role FROM business_members WHERE business_account_id = $1 AND user_id = $2",
      [accountId, target.id]
    );
    if (existing.rows[0]?.member_role === "owner") {
      throw new ConflictException("The business owner role cannot be changed here.");
    }
    await this.database.query(
      `INSERT INTO business_members (business_account_id, user_id, member_role) VALUES ($1,$2,$3)
       ON CONFLICT (business_account_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role
       WHERE business_members.member_role <> 'owner'`,
      [accountId, target.id, role]
    );
    return { userId: target.id, role };
  }

  async removeMember(userId: string, accountId: string, memberId: string) {
    const membership = await this.requireMember(userId, accountId);
    if (!["owner", "admin"].includes(membership.role)) {
      throw new ForbiddenException("Only business owners and admins can manage members.");
    }
    const target = await this.database.query<{ member_role: string }>(
      "SELECT member_role FROM business_members WHERE business_account_id = $1 AND user_id = $2",
      [accountId, memberId]
    );
    if (!target.rows[0]) throw new NotFoundException("Business member not found.");
    if (target.rows[0].member_role !== "driver") {
      throw new ConflictException("Only fleet drivers can be removed from the driver roster.");
    }
    const activeAssignment = await this.database.query(
      "SELECT 1 FROM business_fleet_assignments WHERE business_account_id = $1 AND driver_user_id = $2 AND status = 'assigned'",
      [accountId, memberId]
    );
    if ((activeAssignment.rowCount ?? 0) > 0) {
      throw new ConflictException("Complete or reassign this driver's active delivery before removing them.");
    }
    await this.database.query(
      "UPDATE business_members SET member_role = 'member' WHERE business_account_id = $1 AND user_id = $2 AND member_role = 'driver'",
      [accountId, memberId]
    );
    await this.audit.record({
      actorUserId: userId, action: "business.fleet_driver_removed", entityType: "business_member",
      entityId: memberId, requestId: null, metadata: { businessAccountId: accountId, previousRole: target.rows[0].member_role }
    });
    return { removedFromFleet: true };
  }

  async addLocation(userId: string, accountId: string, input: Readonly<{ label: string; addressLine: string; contactName: string | null; contactPhone: string | null; latitude: number | null; longitude: number | null }>) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO business_locations (business_account_id, label, address_line, contact_name, contact_phone_e164, location)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$6),4326) END) RETURNING id`,
      [accountId, input.label, input.addressLine, input.contactName, input.contactPhone, input.latitude, input.longitude]
    );
    return { id: result.rows[0]?.id };
  }

  async attachOrder(userId: string, accountId: string, orderId: string, input: Readonly<{ costCenter: string | null; referenceCode: string | null }>) {
    await this.requireMember(userId, accountId);
    const order = await this.database.query("SELECT 1 FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
    if ((order.rowCount ?? 0) === 0) throw new NotFoundException("Order not found.");
    const existing = await this.database.query("SELECT 1 FROM business_orders WHERE order_id = $1", [orderId]);
    if ((existing.rowCount ?? 0) > 0) throw new ConflictException("This order is already linked to a business account.");
    await this.database.query(
      "INSERT INTO business_orders (order_id, business_account_id, cost_center, reference_code, created_by) VALUES ($1,$2,$3,$4,$5)",
      [orderId, accountId, input.costCenter, input.referenceCode, userId]
    );
    return { linked: true };
  }

  async orders(userId: string, accountId: string, limit: number, offset: number) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query(
      `SELECT o.id, o.order_number, o.status, o.total_minor, o.currency, o.created_at, bo.cost_center, bo.reference_code
       FROM business_orders bo JOIN orders o ON o.id = bo.order_id
       WHERE bo.business_account_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderNumber: row.order_number as string, status: row.status as string,
        totalMinor: Number(row.total_minor), currency: row.currency as string, costCenter: row.cost_center,
        referenceCode: row.reference_code, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async fleet(userId: string, accountId: string) {
    const membership = await this.requireMember(userId, accountId);
    if (!["owner", "admin", "driver"].includes(membership.role)) {
      throw new ForbiddenException("You do not have fleet access for this business account.");
    }
    const account = await this.database.query<{ id: string; display_name: string; status: string; currency: string }>(
      "SELECT id, display_name, status, currency FROM business_accounts WHERE id = $1",
      [accountId]
    );
    const business = account.rows[0];
    if (!business) throw new NotFoundException("Business account not found.");
    await this.syncFleetAssignments(accountId);
    const driverScope = membership.role === "driver" ? userId : null;
    const [drivers, vehicles, deliveries, eligibleOrders, performance] = await Promise.all([
      this.database.query<{
        user_id: string; display_name: string | null; phone_e164: string | null; account_status: string;
        courier_status: string | null; courier_vehicle_type: string | null; is_online: boolean | null;
        accepting_offers: boolean | null; active_order_id: string | null;
        completed_count: string; delivered_count: string; on_time_count: string;
      }>(
        `SELECT u.id AS user_id, u.display_name, u.phone_e164, u.account_status,
                cp.status AS courier_status, cp.vehicle_type AS courier_vehicle_type,
                ca.is_online, ca.accepting_offers, ca.active_order_id,
                count(bfa.id) FILTER (WHERE o.status IN ('DELIVERED','FAILED','CANCELLED'))::text AS completed_count,
                count(bfa.id) FILTER (WHERE o.status = 'DELIVERED')::text AS delivered_count,
                count(bfa.id) FILTER (WHERE o.status = 'DELIVERED' AND
                  (o.delivery_estimate_minutes IS NULL OR o.delivered_at <= o.created_at + make_interval(mins => o.delivery_estimate_minutes)))::text AS on_time_count
         FROM business_members bm
         JOIN users u ON u.id = bm.user_id
         LEFT JOIN courier_profiles cp ON cp.user_id = u.id
         LEFT JOIN courier_availability ca ON ca.courier_user_id = u.id
         LEFT JOIN business_fleet_assignments bfa ON bfa.driver_user_id = u.id AND bfa.business_account_id = bm.business_account_id
         LEFT JOIN orders o ON o.id = bfa.order_id
         WHERE bm.business_account_id = $1 AND bm.member_role = 'driver'
           AND ($2::uuid IS NULL OR u.id = $2)
         GROUP BY u.id, cp.status, cp.vehicle_type, ca.is_online, ca.accepting_offers, ca.active_order_id
         ORDER BY u.display_name NULLS LAST, u.phone_e164`,
        [accountId, driverScope]
      ),
      this.database.query<{
        id: string; label: string; vehicle_type: string; make_model: string | null; plate_number: string;
        registration_expires_on: string | null; insurance_expires_on: string | null; is_active: boolean;
        assigned: boolean;
      }>(
        `SELECT v.id, v.label, v.vehicle_type, v.make_model, v.plate_number,
                v.registration_expires_on::text AS registration_expires_on,
                v.insurance_expires_on::text AS insurance_expires_on, v.is_active,
                EXISTS (SELECT 1 FROM business_fleet_assignments a WHERE a.vehicle_id = v.id AND a.status = 'assigned') AS assigned
         FROM business_fleet_vehicles v
         WHERE v.business_account_id = $1
           AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM business_fleet_assignments a WHERE a.vehicle_id = v.id AND a.driver_user_id = $2))
         ORDER BY v.label`,
        [accountId, driverScope]
      ),
      this.database.query<{
        assignment_id: string; order_id: string; order_number: string; order_status: string; merchant_name: string;
        driver_user_id: string; driver_name: string | null; vehicle_id: string; vehicle_label: string;
        plate_number: string; total_minor: string; currency: string; created_at: Date;
        delivered_at: Date | null; delivery_estimate_minutes: number | null; assignment_status: string;
      }>(
        `SELECT a.id AS assignment_id, o.id AS order_id, o.order_number, o.status AS order_status,
                m.display_name AS merchant_name, a.driver_user_id, u.display_name AS driver_name,
                a.vehicle_id, v.label AS vehicle_label, v.plate_number, o.total_minor, o.currency,
                o.created_at, o.delivered_at, o.delivery_estimate_minutes, a.status AS assignment_status
         FROM business_fleet_assignments a
         JOIN business_orders bo ON bo.order_id = a.order_id AND bo.business_account_id = a.business_account_id
         JOIN orders o ON o.id = a.order_id
         JOIN users u ON u.id = a.driver_user_id
         JOIN business_fleet_vehicles v ON v.id = a.vehicle_id AND v.business_account_id = a.business_account_id
         JOIN merchants m ON m.id = o.merchant_id
         WHERE a.business_account_id = $1 AND ($2::uuid IS NULL OR a.driver_user_id = $2)
         ORDER BY a.created_at DESC LIMIT 100`,
        [accountId, driverScope]
      ),
      this.database.query<{
        id: string; order_number: string; status: string; merchant_name: string; total_minor: string;
        currency: string; created_at: Date;
      }>(
        `SELECT o.id, o.order_number, o.status, m.display_name AS merchant_name, o.total_minor, o.currency, o.created_at
         FROM business_orders bo JOIN orders o ON o.id = bo.order_id JOIN merchants m ON m.id = o.merchant_id
         WHERE bo.business_account_id = $1 AND o.fulfillment_type = 'delivery' AND o.status = 'READY_FOR_PICKUP'
           AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id AND da.status IN ('offered','accepted','arrived_pickup','picked_up'))
           AND NOT EXISTS (SELECT 1 FROM business_fleet_assignments a WHERE a.order_id = o.id AND a.status = 'assigned')
         ORDER BY o.created_at ASC LIMIT 100`,
        [accountId]
      ),
      this.database.query<{ assigned: string; delivered: string; failed: string; on_time: string }>(
        `SELECT count(*)::text AS assigned,
                count(*) FILTER (WHERE o.status = 'DELIVERED')::text AS delivered,
                count(*) FILTER (WHERE o.status IN ('FAILED','CANCELLED'))::text AS failed,
                count(*) FILTER (WHERE o.status = 'DELIVERED' AND (o.delivery_estimate_minutes IS NULL OR o.delivered_at <= o.created_at + make_interval(mins => o.delivery_estimate_minutes)))::text AS on_time
         FROM business_fleet_assignments a JOIN orders o ON o.id = a.order_id
         WHERE a.business_account_id = $1 AND ($2::uuid IS NULL OR a.driver_user_id = $2)`,
        [accountId, driverScope]
      )
    ]);
    const totals = performance.rows[0];
    return {
      account: { id: business.id, name: business.display_name, status: business.status, currency: business.currency, role: membership.role },
      drivers: drivers.rows.map((driver) => ({
        userId: driver.user_id,
        name: driver.display_name,
        phoneE164: driver.phone_e164,
        accountStatus: driver.account_status,
        courierStatus: driver.courier_status,
        vehicleType: driver.courier_vehicle_type,
        isOnline: driver.is_online ?? false,
        hasActiveDelivery: driver.active_order_id !== null,
        eligible: driver.account_status === "active" && driver.courier_status === "approved",
        available: driver.account_status === "active" && driver.courier_status === "approved" && driver.is_online === true && driver.accepting_offers === true && driver.active_order_id === null,
        deliveries: Number(driver.delivered_count),
        onTimeDeliveries: Number(driver.on_time_count),
        completedAssignments: Number(driver.completed_count)
      })),
      vehicles: vehicles.rows.map((vehicle) => {
        const today = new Date().toISOString().slice(0, 10);
        const registrationCurrent = vehicle.registration_expires_on === null || vehicle.registration_expires_on >= today;
        const insuranceCurrent = vehicle.insurance_expires_on === null || vehicle.insurance_expires_on >= today;
        return {
          id: vehicle.id,
          label: vehicle.label,
          vehicleType: vehicle.vehicle_type,
          makeModel: vehicle.make_model,
          plateNumber: vehicle.plate_number,
          registrationExpiresOn: vehicle.registration_expires_on,
          insuranceExpiresOn: vehicle.insurance_expires_on,
          isActive: vehicle.is_active,
          assigned: vehicle.assigned,
          eligible: vehicle.is_active && registrationCurrent && insuranceCurrent
        };
      }),
      deliveries: deliveries.rows.map((delivery) => ({
        assignmentId: delivery.assignment_id,
        orderId: delivery.order_id,
        orderNumber: delivery.order_number,
        status: delivery.order_status,
        merchantName: delivery.merchant_name,
        driverUserId: delivery.driver_user_id,
        driverName: delivery.driver_name,
        vehicleId: delivery.vehicle_id,
        vehicleLabel: delivery.vehicle_label,
        plateNumber: delivery.plate_number,
        totalMinor: Number(delivery.total_minor),
        currency: delivery.currency,
        createdAt: delivery.created_at.toISOString(),
        deliveredAt: delivery.delivered_at?.toISOString() ?? null,
        deliveryEstimateMinutes: delivery.delivery_estimate_minutes,
        assignmentStatus: delivery.assignment_status
      })),
      eligibleOrders: membership.role === "driver" ? [] : eligibleOrders.rows.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        merchantName: order.merchant_name,
        totalMinor: Number(order.total_minor),
        currency: order.currency,
        createdAt: order.created_at.toISOString()
      })),
      performance: {
        assigned: Number(totals?.assigned ?? 0),
        delivered: Number(totals?.delivered ?? 0),
        failed: Number(totals?.failed ?? 0),
        onTime: Number(totals?.on_time ?? 0),
        onTimeRate: Number(totals?.delivered ?? 0) === 0 ? 0 : Number(totals?.on_time ?? 0) / Number(totals?.delivered ?? 0)
      }
    };
  }

  async createFleetVehicle(userId: string, accountId: string, input: Readonly<{
    label: string; vehicleType: string; makeModel?: string | undefined; plateNumber: string;
    registrationExpiresOn?: string | null | undefined; insuranceExpiresOn?: string | null | undefined;
  }>) {
    await this.requireFleetAdmin(userId, accountId);
    const duplicate = await this.database.query(
      "SELECT 1 FROM business_fleet_vehicles WHERE business_account_id = $1 AND upper(plate_number) = upper($2)",
      [accountId, input.plateNumber.trim()]
    );
    if ((duplicate.rowCount ?? 0) > 0) throw new ConflictException("This plate number is already registered to this fleet.");
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO business_fleet_vehicles
         (business_account_id, label, vehicle_type, make_model, plate_number, registration_expires_on, insurance_expires_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [accountId, input.label.trim(), input.vehicleType, input.makeModel?.trim() || null, input.plateNumber.trim().toUpperCase(), input.registrationExpiresOn ?? null, input.insuranceExpiresOn ?? null]
    );
    await this.audit.record({
      actorUserId: userId, action: "business.fleet_vehicle_created", entityType: "business_fleet_vehicle",
      entityId: result.rows[0]?.id ?? null, requestId: null,
      metadata: { businessAccountId: accountId, vehicleType: input.vehicleType, plateNumber: input.plateNumber.trim().toUpperCase() }
    });
    return { id: result.rows[0]?.id };
  }

  async updateFleetVehicle(userId: string, accountId: string, vehicleId: string, input: Readonly<{
    label?: string | undefined; vehicleType?: string | undefined; makeModel?: string | undefined;
    plateNumber?: string | undefined; registrationExpiresOn?: string | null | undefined;
    insuranceExpiresOn?: string | null | undefined; isActive?: boolean | undefined;
  }>) {
    await this.requireFleetAdmin(userId, accountId);
    const vehicle = await this.database.query<{ id: string }>(
      "SELECT id FROM business_fleet_vehicles WHERE id = $1 AND business_account_id = $2",
      [vehicleId, accountId]
    );
    if (!vehicle.rows[0]) throw new NotFoundException("Fleet vehicle not found.");
    if (input.isActive === false) {
      const assigned = await this.database.query(
        "SELECT 1 FROM business_fleet_assignments WHERE vehicle_id = $1 AND status = 'assigned'",
        [vehicleId]
      );
      if ((assigned.rowCount ?? 0) > 0) throw new ConflictException("Unassign this vehicle before marking it inactive.");
    }
    const duplicatePlate = input.plateNumber
      ? await this.database.query(
          "SELECT 1 FROM business_fleet_vehicles WHERE business_account_id = $1 AND upper(plate_number) = upper($2) AND id <> $3",
          [accountId, input.plateNumber.trim(), vehicleId]
        )
      : { rowCount: 0 };
    if ((duplicatePlate.rowCount ?? 0) > 0) throw new ConflictException("This plate number is already registered to another fleet vehicle.");
    await this.database.query(
      `UPDATE business_fleet_vehicles SET
         label = COALESCE($3, label), vehicle_type = COALESCE($4, vehicle_type),
         make_model = CASE WHEN $5::boolean THEN $6 ELSE make_model END,
         plate_number = COALESCE($7, plate_number),
         registration_expires_on = CASE WHEN $8::boolean THEN $9::date ELSE registration_expires_on END,
         insurance_expires_on = CASE WHEN $10::boolean THEN $11::date ELSE insurance_expires_on END,
         is_active = COALESCE($12, is_active), updated_at = now()
       WHERE id = $1 AND business_account_id = $2`,
      [vehicleId, accountId, input.label?.trim() ?? null, input.vehicleType ?? null,
        Object.hasOwn(input, "makeModel"), input.makeModel?.trim() || null,
        input.plateNumber?.trim().toUpperCase() ?? null,
        Object.hasOwn(input, "registrationExpiresOn"), input.registrationExpiresOn ?? null,
        Object.hasOwn(input, "insuranceExpiresOn"), input.insuranceExpiresOn ?? null,
        input.isActive ?? null]
    );
    await this.audit.record({
      actorUserId: userId, action: "business.fleet_vehicle_updated", entityType: "business_fleet_vehicle",
      entityId: vehicleId, requestId: null,
      metadata: { businessAccountId: accountId, changedFields: Object.keys(input) }
    });
    return { updated: true };
  }

  async assignFleetDelivery(userId: string, accountId: string, input: Readonly<{ orderId: string; driverUserId: string; vehicleId: string }>) {
    await this.requireFleetAdmin(userId, accountId);
    return this.database.withTransaction(async (client) => {
      const membership = await client.query<{ status: string; member_role: string }>(
        `SELECT ba.status, bm.member_role FROM business_accounts ba
         JOIN business_members bm ON bm.business_account_id = ba.id
         WHERE ba.id = $1 AND bm.user_id = $2 FOR UPDATE OF ba, bm`,
        [accountId, userId]
      );
      if (!membership.rows[0] || !["owner", "admin"].includes(membership.rows[0].member_role)) {
        throw new ForbiddenException("Only business owners and admins can assign fleet deliveries.");
      }
      if (membership.rows[0].status !== "active") {
        throw new ConflictException("Fleet management is available only for active business accounts.");
      }
      await client.query(
        `UPDATE business_fleet_assignments a SET
           status = CASE WHEN o.status = 'DELIVERED' THEN 'completed' ELSE 'cancelled' END,
           completed_at = CASE WHEN o.status = 'DELIVERED' THEN COALESCE(o.delivered_at, now()) ELSE NULL END,
           updated_at = now()
         FROM orders o
         WHERE a.order_id = o.id AND a.business_account_id = $1 AND a.status = 'assigned'
           AND (o.status IN ('DELIVERED','CANCELLED','REFUNDED') OR
             (o.status = 'FAILED' AND NOT EXISTS (
               SELECT 1 FROM delivery_assignments da
               WHERE da.order_id = o.id AND da.courier_user_id = a.driver_user_id AND da.return_status = 'pending'
             )))`,
        [accountId]
      );
      const orderResult = await client.query<{ id: string; order_number: string; status: string; fulfillment_type: string; user_id: string }>(
        `SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.user_id
         FROM business_orders bo JOIN orders o ON o.id = bo.order_id
         WHERE bo.business_account_id = $1 AND o.id = $2 FOR UPDATE OF o`,
        [accountId, input.orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Eligible business delivery not found.");
      if (order.fulfillment_type !== "delivery" || order.status !== "READY_FOR_PICKUP") {
        throw new ConflictException("Only business deliveries ready for pickup can be assigned.");
      }
      const driverResult = await client.query<{
        user_id: string; display_name: string | null; status: string; vehicle_type: string;
        account_status: string; is_online: boolean; accepting_offers: boolean; active_order_id: string | null;
      }>(
        `SELECT u.id AS user_id, u.display_name, cp.status, cp.vehicle_type, u.account_status,
                ca.is_online, ca.accepting_offers, ca.active_order_id
         FROM business_members bm JOIN users u ON u.id = bm.user_id
         JOIN courier_profiles cp ON cp.user_id = u.id
         JOIN courier_availability ca ON ca.courier_user_id = u.id
         WHERE bm.business_account_id = $1 AND bm.user_id = $2 AND bm.member_role = 'driver'
         FOR UPDATE OF u, cp, ca`,
        [accountId, input.driverUserId]
      );
      const driver = driverResult.rows[0];
      if (!driver || driver.account_status !== "active" || driver.status !== "approved") {
        throw new ConflictException("Select an active, approved fleet driver.");
      }
      if (!driver.is_online || !driver.accepting_offers || driver.active_order_id) {
        throw new ConflictException("The selected driver is not currently available.");
      }
      const vehicleResult = await client.query<{
        id: string; vehicle_type: string; is_active: boolean;
        registration_expires_on: string | null; insurance_expires_on: string | null;
      }>(
        "SELECT id, vehicle_type, is_active, registration_expires_on::text AS registration_expires_on, insurance_expires_on::text AS insurance_expires_on FROM business_fleet_vehicles WHERE id = $1 AND business_account_id = $2 FOR UPDATE",
        [input.vehicleId, accountId]
      );
      const vehicle = vehicleResult.rows[0];
      if (!vehicle || !vehicle.is_active ||
          (vehicle.registration_expires_on !== null && vehicle.registration_expires_on < new Date().toISOString().slice(0, 10)) ||
          (vehicle.insurance_expires_on !== null && vehicle.insurance_expires_on < new Date().toISOString().slice(0, 10))) {
        throw new ConflictException("Select an active vehicle with current registration and insurance.");
      }
      if (vehicle.vehicle_type !== driver.vehicle_type) {
        throw new ConflictException("The vehicle type does not match the driver's approved vehicle.");
      }
      const activeDelivery = await client.query(
        "SELECT 1 FROM delivery_assignments WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup','picked_up')",
        [order.id]
      );
      if ((activeDelivery.rowCount ?? 0) > 0) throw new ConflictException("This delivery already has a courier assignment.");
      const assignment = await client.query<{ id: string }>(
        "INSERT INTO delivery_assignments (order_id, courier_user_id, status, accepted_at) VALUES ($1,$2,'accepted',now()) RETURNING id",
        [order.id, driver.user_id]
      );
      await client.query(
        `INSERT INTO business_fleet_assignments (business_account_id, order_id, driver_user_id, vehicle_id, assigned_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [accountId, order.id, driver.user_id, vehicle.id, userId]
      );
      await client.query(
        "UPDATE orders SET status = 'COURIER_ASSIGNED', courier_user_id = $2, version = version + 1 WHERE id = $1",
        [order.id, driver.user_id]
      );
      await client.query(
        "UPDATE courier_availability SET active_order_id = $2, accepting_offers = false, updated_at = now() WHERE courier_user_id = $1",
        [driver.user_id, order.id]
      );
      await client.query(
        "INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata) VALUES ($1,'READY_FOR_PICKUP','COURIER_ASSIGNED',$2,$3)",
        [order.id, userId, JSON.stringify({ note: "Assigned by business fleet manager", assignmentId: assignment.rows[0]?.id, vehicleId: vehicle.id })]
      );
      await client.query(
        "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('delivery.assigned','order',$1,$2)",
        [order.id, JSON.stringify({ orderId: order.id, courierId: driver.user_id, assignmentId: assignment.rows[0]?.id, businessAccountId: accountId, vehicleId: vehicle.id })]
      );
      await this.notifications.create({
        userId: order.user_id,
        type: "order.courier_assigned",
        title: "Courier assigned",
        body: `A courier is on the way to collect order ${order.order_number}.`,
        data: { orderId: order.id }
      }, client);
      await this.notifications.create({
        userId: driver.user_id,
        type: "delivery.assigned",
        title: "Fleet delivery assigned",
        body: `You have been assigned order ${order.order_number}.`,
        data: { orderId: order.id, assignmentId: assignment.rows[0]?.id, businessAccountId: accountId, vehicleId: vehicle.id }
      }, client);
      await this.audit.record({
        actorUserId: userId,
        action: "business.fleet_delivery_assigned",
        entityType: "order",
        entityId: order.id,
        requestId: null,
        metadata: { businessAccountId: accountId, driverUserId: driver.user_id, vehicleId: vehicle.id, deliveryAssignmentId: assignment.rows[0]?.id }
      }, client);
      return { assignmentId: assignment.rows[0]?.id, orderId: order.id };
    });
  }

  async adminList(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT ba.id, ba.display_name AS name, ba.status, ba.currency, ba.billing_email, ba.billing_phone_e164, ba.created_at,
              u.phone_e164 AS creator_phone
       FROM business_accounts ba JOIN users u ON u.id = ba.created_by
       WHERE ($1::text IS NULL OR ba.status = $1) ORDER BY ba.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, name: row.name as string, status: row.status as string, currency: row.currency as string,
        billingEmail: row.billing_email, billingPhone: row.billing_phone_e164, creatorPhone: row.creator_phone,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async review(accountId: string, actorUserId: string, decision: "approve" | "reject") {
    const result = await this.database.query(
      `UPDATE business_accounts SET status = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $1`,
      [accountId, decision === "approve" ? "active" : "closed", actorUserId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Business account not found.");
    return { status: decision === "approve" ? "active" : "closed" };
  }

  async bulkAttach(userId: string, accountId: string, items: readonly { costCenter?: string | null; referenceCode?: string | null }[] & readonly { orderId?: string }[]) {
    await this.requireMember(userId, accountId);
    return this.database.withTransaction(async (client) => {
      const linked: string[] = [];
      for (const item of items) {
        const orderId = (item as { orderId: string }).orderId;
        const order = await client.query("SELECT 1 FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
        if ((order.rowCount ?? 0) === 0) throw new NotFoundException(`Order ${orderId} not found.`);
        const existing = await client.query("SELECT 1 FROM business_orders WHERE order_id = $1", [orderId]);
        if ((existing.rowCount ?? 0) > 0) throw new ConflictException(`Order ${orderId} is already linked.`);
        await client.query(
          "INSERT INTO business_orders (order_id, business_account_id, cost_center, reference_code, created_by) VALUES ($1,$2,$3,$4,$5)",
          [orderId, accountId, item.costCenter ?? null, item.referenceCode ?? null, userId]
        );
        linked.push(orderId);
      }
      return { linkedCount: linked.length, orderIds: linked };
    });
  }

  async importOrders(userId: string, accountId: string, csv: string, dryRun: boolean) {
    await this.requireMember(userId, accountId);
    const lines = csv.trim().split(/\r?\n/);
    const header = (lines[0] ?? "").split(",").map((value) => value.trim().toLowerCase());
    const required = ["order_id"];
    for (const field of required) {
      if (!header.includes(field)) throw new BadRequestException(`CSV is missing required column: ${field}.`);
    }
    const rows: Array<{ orderId: string; costCenter: string | null; referenceCode: string | null; valid: boolean; error?: string }> = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line.trim()) continue;
      const values = line.split(",").map((value) => value.trim());
      const record: Record<string, string> = {};
      header.forEach((key, index) => { record[key] = values[index] ?? ""; });
      const orderId = record["order_id"] ?? "";
      let valid = true;
      let error: string | undefined;
      const order = await this.database.query("SELECT 1 FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
      if ((order.rowCount ?? 0) === 0) { valid = false; error = "Order not found or not owned by you."; }
      const existing = valid ? await this.database.query("SELECT 1 FROM business_orders WHERE order_id = $1", [orderId]) : { rowCount: 0 };
      if (valid && (existing.rowCount ?? 0) > 0) { valid = false; error = "Order already linked to a business account."; }
      rows.push({ orderId, costCenter: record["cost_center"] || null, referenceCode: record["reference_code"] || null, valid, ...(error ? { error } : {}) });
    }
    if (!dryRun) {
      await this.database.withTransaction(async (client) => {
        for (const row of rows) {
          if (!row.valid) continue;
          await client.query(
            "INSERT INTO business_orders (order_id, business_account_id, cost_center, reference_code, created_by) VALUES ($1,$2,$3,$4,$5)",
            [row.orderId, accountId, row.costCenter, row.referenceCode, userId]
          );
        }
      });
    }
    return { dryRun, totalRows: rows.length, validRows: rows.filter((row) => row.valid).length, rows };
  }
  private async requireFleetAdmin(userId: string, accountId: string): Promise<void> {
    const membership = await this.requireMember(userId, accountId);
    if (!['owner', 'admin'].includes(membership.role)) {
      throw new ForbiddenException('Only business owners and admins can manage the fleet.');
    }
    const account = await this.database.query<{ status: string }>(
      'SELECT status FROM business_accounts WHERE id = $1',
      [accountId]
    );
    if (!account.rows[0]) throw new NotFoundException('Business account not found.');
    if (account.rows[0].status !== 'active') {
      throw new ConflictException('Fleet management is available only for active business accounts.');
    }
  }

  private async syncFleetAssignments(accountId: string): Promise<void> {
    await this.database.query(
      `UPDATE business_fleet_assignments a SET
         status = CASE WHEN o.status = 'DELIVERED' THEN 'completed' ELSE 'cancelled' END,
         completed_at = CASE WHEN o.status = 'DELIVERED' THEN COALESCE(o.delivered_at, now()) ELSE NULL END,
         updated_at = now()
       FROM orders o
       WHERE a.business_account_id = $1 AND a.order_id = o.id AND a.status = 'assigned'
         AND (o.status IN ('DELIVERED','CANCELLED','REFUNDED') OR
           (o.status = 'FAILED' AND NOT EXISTS (
             SELECT 1 FROM delivery_assignments da
             WHERE da.order_id = o.id AND da.courier_user_id = a.driver_user_id AND da.return_status = 'pending'
           )))`,
      [accountId]
    );
  }

  async schedule(userId: string, accountId: string, orderId: string, input: Readonly<{ frequency: "daily" | "weekly" | "monthly"; intervalCount: number; nextRunAt: string; endAt: string | null }>) {
    await this.requireMember(userId, accountId);
    const order = await this.database.query("SELECT 1 FROM business_orders WHERE order_id = $1 AND business_account_id = $2", [orderId, accountId]);
    if ((order.rowCount ?? 0) === 0) throw new NotFoundException("Business order not found.");
    const nextRunAt = new Date(input.nextRunAt);
    if (Number.isNaN(nextRunAt.getTime())) throw new BadRequestException("Invalid nextRunAt.");
    const endAt = input.endAt ? new Date(input.endAt) : null;
    if (endAt && Number.isNaN(endAt.getTime())) throw new BadRequestException("Invalid endAt.");
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO business_delivery_schedules (business_account_id, template_order_id, frequency, interval_count, next_run_at, end_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [accountId, orderId, input.frequency, input.intervalCount, nextRunAt, endAt, userId]
    );
    await this.database.query("UPDATE business_orders SET scheduled_for = $2, recurrence_rule = $3, parent_schedule_id = $4 WHERE order_id = $1", [orderId, nextRunAt, input.frequency, result.rows[0]?.id]);
    return { id: result.rows[0]?.id, orderId, frequency: input.frequency, nextRunAt: nextRunAt.toISOString() };
  }

  async schedules(userId: string, accountId: string) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query(
      `SELECT id, template_order_id, frequency, interval_count, next_run_at, end_at, is_active, created_at
       FROM business_delivery_schedules WHERE business_account_id = $1 ORDER BY next_run_at ASC`,
      [accountId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, templateOrderId: row.template_order_id as string | null, frequency: row.frequency as string,
        intervalCount: row.interval_count as number, nextRunAt: (row.next_run_at as Date).toISOString(),
        endAt: (row.end_at as Date | null)?.toISOString() ?? null, isActive: row.is_active as boolean,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async multiStop(userId: string, accountId: string, orderId: string, stops: readonly { stopType: "pickup" | "dropoff" | "waypoint"; sequenceNumber: number; label?: string; addressLine: string; latitude?: number; longitude?: number; contactName?: string; contactPhone?: string }[]) {
    await this.requireMember(userId, accountId);
    const order = await this.database.query("SELECT 1 FROM business_orders WHERE order_id = $1 AND business_account_id = $2", [orderId, accountId]);
    if ((order.rowCount ?? 0) === 0) throw new NotFoundException("Business order not found.");
    const sequences = new Set(stops.map((stop) => stop.sequenceNumber));
    if (sequences.size !== stops.length) throw new BadRequestException("Stop sequence numbers must be unique.");
    await this.database.withTransaction(async (client) => {
      await client.query("DELETE FROM business_order_stops WHERE business_order_id = $1", [orderId]);
      for (const stop of stops) {
        await client.query(
          `INSERT INTO business_order_stops (business_order_id, stop_type, sequence_number, label, address_line, location, contact_name, contact_phone_e164)
           VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$6),4326) END, $8,$9)`,
          [orderId, stop.stopType, stop.sequenceNumber, stop.label ?? null, stop.addressLine, stop.latitude ?? null, stop.longitude ?? null, stop.contactName ?? null, stop.contactPhone ?? null]
        );
      }
    });
    return { orderId, stopCount: stops.length };
  }
  async createInvoice(userId: string, accountId: string, orderId: string) {
    await this.requireMember(userId, accountId);
    const order = await this.database.query<{ total_minor: string; currency: string }>(
      "SELECT o.total_minor, o.currency FROM business_orders bo JOIN orders o ON o.id = bo.order_id WHERE bo.business_account_id = $1 AND bo.order_id = $2",
      [accountId, orderId]
    );
    const row = order.rows[0];
    if (!row) throw new NotFoundException("Business order not found.");
    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO business_invoices (business_account_id, order_id, invoice_number, amount_minor, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (business_account_id, order_id) DO UPDATE SET amount_minor = EXCLUDED.amount_minor
       RETURNING id`,
      [accountId, orderId, invoiceNumber, row.total_minor, row.currency]
    );
    return { id: result.rows[0]?.id, invoiceNumber, orderId, amountMinor: Number(row.total_minor), currency: row.currency };
  }

  async invoices(userId: string, accountId: string, limit: number, offset: number) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query(
      `SELECT id, order_id, invoice_number, amount_minor, currency, status, issued_at FROM business_invoices
       WHERE business_account_id = $1 ORDER BY issued_at DESC LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderId: row.order_id as string, invoiceNumber: row.invoice_number as string,
        amountMinor: Number(row.amount_minor), currency: row.currency as string, status: row.status as string,
        issuedAt: (row.issued_at as Date).toISOString()
      }))
    };
  }

  async report(userId: string, accountId: string, days: number) {
    await this.requireMember(userId, accountId);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.database.query<{ orders: number; total_minor: string; delivered: number }>(
      `SELECT count(*)::int AS orders, COALESCE(sum(o.total_minor),0)::text AS total_minor,
              count(*) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered
       FROM business_orders bo JOIN orders o ON o.id = bo.order_id
       WHERE bo.business_account_id = $1 AND o.created_at >= $2`,
      [accountId, from]
    );
    const row = result.rows[0];
    return {
      days, from: from.toISOString(), to: new Date().toISOString(),
      orders: row?.orders ?? 0, delivered: row?.delivered ?? 0,
      totalMinor: Number(row?.total_minor ?? 0)
    };
  }
  private async requireMember(userId: string, accountId: string): Promise<{ role: string }> {
    const result = await this.database.query<{ member_role: string }>("SELECT member_role FROM business_members WHERE business_account_id = $1 AND user_id = $2", [accountId, userId]);
    const row = result.rows[0];
    if (!row) throw new ForbiddenException("You are not a member of this business account.");
    return { role: row.member_role };
  }
}

