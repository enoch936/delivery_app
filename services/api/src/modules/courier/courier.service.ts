import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  allowedCourierActions,
  effectiveProofMode,
  failureReason,
  type CourierAction,
  type FailureReasonCode
} from "@delivery-app/domain";
import { DatabaseService } from "../../database/database.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { SupportService } from "../support/support.service.js";

type CourierDeliveryRow = {
  assignment_id: string; assignment_status: string; accepted_at: Date | null; arrived_at: Date | null;
  picked_up_at: Date | null; delivered_at: Date | null;
  failure_reason_code: string | null; failure_notes: string | null; return_required: boolean;
  return_status: string; return_confirmed_at: Date | null; return_notes: string | null;
  order_id: string; order_number: string; order_status: string; order_kind: string; payment_status: string;
  total_minor: string; currency: string; delivery_fee_minor: string; tip_minor: string;
  delivery_estimate_minutes: number | null; delivery_address_snapshot: Record<string, unknown> | null;
  delivery_instructions: string | null; delivery_proof_required: boolean; delivery_proof_mode: string | null;
  delivery_lat: number | null; delivery_lng: number | null;
  merchant_name: string; pickup_address: string | null;
  merchant_contact_name: string | null; merchant_contact_phone: string | null;
  pickup_lat: number | null; pickup_lng: number | null;
  delivery_address: string | null; delivery_recipient_name: string | null; delivery_contact_phone: string | null;
  customer_name: string | null; customer_phone: string | null;
};

type CourierProfileRow = {
  user_id: string; status: string; full_name: string | null; email: string | null; vehicle_type: string; vehicle_plate: string | null;
  vehicle_model: string | null; license_number: string | null; service_zone_id: string | null; city_id: string | null;
  service_category_slug: string | null; capacity_units: number; rating_average: string; completed_deliveries: number;
  rejection_reason: string | null; last_decision_reason: string | null; availability_preferences: Record<string, unknown> | null;
  verification_submitted_at: Date | null; suspended_at: Date | null; reactivated_at: Date | null; created_at: Date;
  is_online: boolean | null; accepting_offers: boolean | null; last_seen_at: Date | null;
  latitude: number | null; longitude: number | null; active_order_id: string | null;
};

const DELIVERY_SELECT = `
  SELECT da.id AS assignment_id, da.status AS assignment_status, da.accepted_at, da.arrived_at,
         da.picked_up_at, da.delivered_at,
         da.failure_reason_code, da.failure_notes, da.return_required, da.return_status,
         da.return_confirmed_at, da.return_notes,
         o.id AS order_id, o.order_number, o.status AS order_status, o.kind AS order_kind,
         o.payment_status, o.total_minor, o.currency, o.delivery_fee_minor, o.tip_minor,
         o.delivery_estimate_minutes, o.delivery_address_snapshot, o.delivery_instructions,
         o.delivery_proof_required, o.delivery_proof_mode, o.delivery_lat, o.delivery_lng,
         COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
         ml.address_line AS pickup_address,
         ml.contact_name AS merchant_contact_name, ml.contact_phone_e164 AS merchant_contact_phone,
         ST_Y(ml.location::geometry) AS pickup_lat, ST_X(ml.location::geometry) AS pickup_lng,
         COALESCE(o.delivery_address_snapshot->>'addressLine', ca.address_line) AS delivery_address,
         COALESCE(o.delivery_address_snapshot->>'recipientName', ca.recipient_name) AS delivery_recipient_name,
         COALESCE(o.delivery_address_snapshot->>'phoneE164', ca.phone_e164) AS delivery_contact_phone,
         cusr.display_name AS customer_name, cusr.phone_e164 AS customer_phone
  FROM delivery_assignments da
  JOIN orders o ON o.id = da.order_id
  JOIN merchants m ON m.id = o.merchant_id
  LEFT JOIN merchant_locations ml ON ml.id = o.merchant_location_id
  LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
  LEFT JOIN users cusr ON cusr.id = o.user_id
`;

@Injectable()
export class CourierService {
  constructor(private readonly database: DatabaseService, private readonly orders: OrdersService, private readonly support: SupportService) {}

  async profile(userId: string) {
    const result = await this.database.query<CourierProfileRow>(
      `SELECT cp.*, ca.is_online, ca.accepting_offers, ca.last_seen_at, ca.active_order_id,
              ST_Y(ca.last_location::geometry) AS latitude, ST_X(ca.last_location::geometry) AS longitude
       FROM courier_profiles cp LEFT JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
       WHERE cp.user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Courier profile not found. Complete courier registration first.");
    const [documents, vehicles] = await Promise.all([
      this.database.query("SELECT id, document_type, status, review_notes, original_name, content_type, size_bytes, expires_at, created_at FROM courier_documents WHERE courier_user_id = $1 ORDER BY created_at DESC", [userId]),
      this.database.query("SELECT id, vehicle_type, plate_number, make_model, is_active FROM courier_vehicles WHERE courier_user_id = $1 ORDER BY created_at DESC", [userId])
    ]);
    return {
      userId: row.user_id, status: row.status, fullName: row.full_name, email: row.email, vehicleType: row.vehicle_type,
      vehicleModel: row.vehicle_model, vehiclePlate: row.vehicle_plate, licenseNumber: row.license_number,
      serviceZoneId: row.service_zone_id, cityId: row.city_id, serviceCategorySlug: row.service_category_slug,
      capacityUnits: row.capacity_units, ratingAverage: Number(row.rating_average), completedDeliveries: row.completed_deliveries,
      rejectionReason: row.rejection_reason, lastDecisionReason: row.last_decision_reason,
      availabilityPreferences: row.availability_preferences ?? {},
      verificationSubmittedAt: row.verification_submitted_at?.toISOString() ?? null,
      suspendedAt: row.suspended_at?.toISOString() ?? null, reactivatedAt: row.reactivated_at?.toISOString() ?? null,
      availability: {
        isOnline: row.is_online ?? false, acceptingOffers: row.accepting_offers ?? false,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null, activeOrderId: row.active_order_id,
        latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude)
      },
      documents: documents.rows.map((doc) => ({ id: doc.id, documentType: doc.document_type, status: doc.status, reviewNotes: doc.review_notes, originalName: doc.original_name, contentType: doc.content_type, sizeBytes: doc.size_bytes, expiresAt: (doc.expires_at as Date | null)?.toISOString() ?? null, createdAt: (doc.created_at as Date).toISOString() })),
      vehicles: vehicles.rows.map((vehicle) => ({ id: vehicle.id, vehicleType: vehicle.vehicle_type, plateNumber: vehicle.plate_number, makeModel: vehicle.make_model, isActive: vehicle.is_active })),
      createdAt: row.created_at.toISOString()
    };
  }

  async register(userId: string, input: Readonly<{ fullName: string; email?: string | undefined; cityId?: string | undefined; serviceCategorySlug?: string | undefined; vehicleType: string; vehicleModel?: string | undefined; vehiclePlate?: string | undefined; licenseNumber?: string | undefined; serviceZoneId?: string | undefined; capacityUnits?: number | undefined; availabilityPreferences?: Record<string, unknown> | undefined }>) {
    return this.database.withTransaction(async (client) => {
      const existing = await client.query("SELECT 1 FROM courier_profiles WHERE user_id = $1", [userId]);
      if ((existing.rowCount ?? 0) > 0) throw new ConflictException("A courier profile already exists.");
      await client.query(
        `INSERT INTO courier_profiles (user_id, full_name, email, city_id, service_category_slug, vehicle_type, vehicle_model, vehicle_plate, license_number, service_zone_id, capacity_units, availability_preferences)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [userId, input.fullName, input.email ?? null, input.cityId ?? null, input.serviceCategorySlug ?? null, input.vehicleType, input.vehicleModel ?? null, input.vehiclePlate ?? null, input.licenseNumber ?? null, input.serviceZoneId ?? null, input.capacityUnits ?? 1, JSON.stringify(input.availabilityPreferences ?? {})]
      );
      await client.query("INSERT INTO courier_availability (courier_user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
      await client.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1,'courier') ON CONFLICT DO NOTHING", [userId]);
      await client.query("INSERT INTO courier_verification_events (courier_user_id, actor_user_id, to_status, reason) VALUES ($1,$1,'pending','Courier registration created')", [userId]);
    });
    return this.profile(userId);
  }

  async updateProfile(userId: string, input: Readonly<{ fullName?: string | undefined; email?: string | undefined; cityId?: string | undefined; serviceCategorySlug?: string | undefined; vehicleType?: string | undefined; vehicleModel?: string | undefined; vehiclePlate?: string | undefined; licenseNumber?: string | undefined; serviceZoneId?: string | undefined; capacityUnits?: number | undefined; availabilityPreferences?: Record<string, unknown> | undefined }>) {
    const result = await this.database.query(
      `UPDATE courier_profiles SET
         full_name = COALESCE($2, full_name),
         email = COALESCE($3, email),
         city_id = COALESCE($4, city_id),
         service_category_slug = COALESCE($5, service_category_slug),
         vehicle_type = COALESCE($6, vehicle_type),
         vehicle_model = COALESCE($7, vehicle_model),
         vehicle_plate = COALESCE($8, vehicle_plate),
         license_number = COALESCE($9, license_number),
         service_zone_id = COALESCE($10, service_zone_id),
         capacity_units = COALESCE($11, capacity_units),
         availability_preferences = COALESCE($12, availability_preferences),
         updated_at = now()
       WHERE user_id = $1`,
      [userId, input.fullName ?? null, input.email ?? null, input.cityId ?? null, input.serviceCategorySlug ?? null, input.vehicleType ?? null, input.vehicleModel ?? null, input.vehiclePlate ?? null, input.licenseNumber ?? null, input.serviceZoneId ?? null, input.capacityUnits ?? null, input.availabilityPreferences ? JSON.stringify(input.availabilityPreferences) : null]
    );
    if (result.rowCount === 0) throw new NotFoundException("Courier profile not found.");
    return this.profile(userId);
  }

  async addDocument(userId: string, input: Readonly<{ documentType: string; storageKey: string }>) {
    const profile = await this.database.query("SELECT 1 FROM courier_profiles WHERE user_id = $1", [userId]);
    if ((profile.rowCount ?? 0) === 0) throw new NotFoundException("Courier profile not found.");
    const result = await this.database.query<{ id: string }>(
      "INSERT INTO courier_documents (courier_user_id, document_type, storage_key) VALUES ($1,$2,$3) RETURNING id",
      [userId, input.documentType, input.storageKey]
    );
    return { id: result.rows[0]?.id, status: "pending" };
  }

  async requirements(userId: string, cityId?: string, serviceCategorySlug?: string, vehicleType?: string) {
    const profile = await this.database.query<{ city_id: string | null; service_category_slug: string | null; vehicle_type: string }>("SELECT city_id, service_category_slug, vehicle_type FROM courier_profiles WHERE user_id = $1", [userId]);
    const resolvedCityId = cityId ?? profile.rows[0]?.city_id ?? null;
    const resolvedCategory = serviceCategorySlug ?? profile.rows[0]?.service_category_slug ?? null;
    const resolvedVehicle = vehicleType ?? profile.rows[0]?.vehicle_type ?? null;
    const result = await this.database.query<{ document_type: string; is_required: boolean; requires_expiry: boolean; max_age_days: number | null; sort_order: number }>(
      `SELECT document_type, is_required, requires_expiry, max_age_days, sort_order
       FROM courier_verification_requirements
       WHERE is_active = true
         AND (city_id IS NULL OR city_id = $1)
         AND (service_category_slug IS NULL OR service_category_slug = $2)
         AND (vehicle_type IS NULL OR vehicle_type = $3)
       ORDER BY sort_order ASC, document_type ASC`,
      [resolvedCityId, resolvedCategory, resolvedVehicle]
    );
    const deduped = new Map<string, { documentType: string; required: boolean; requiresExpiry: boolean; maxAgeDays: number | null; sortOrder: number }>();
    for (const row of result.rows) {
      if (!deduped.has(row.document_type)) {
        deduped.set(row.document_type, { documentType: row.document_type, required: row.is_required, requiresExpiry: row.requires_expiry, maxAgeDays: row.max_age_days, sortOrder: row.sort_order });
      }
    }
    return { cityId: resolvedCityId, serviceCategorySlug: resolvedCategory, vehicleType: resolvedVehicle, items: [...deduped.values()] };
  }

  async uploadDocument(userId: string, input: Readonly<{ documentType: string; fileName: string; contentType: string; dataBase64: string; expiresAt?: string | undefined; replacesDocumentId?: string | undefined }>) {
    const profile = await this.database.query("SELECT 1 FROM courier_profiles WHERE user_id = $1", [userId]);
    if ((profile.rowCount ?? 0) === 0) throw new NotFoundException("Courier profile not found.");
    const base64 = input.dataBase64.includes(",") ? input.dataBase64.split(",").pop() ?? "" : input.dataBase64;
    let buffer: Buffer;
    try { buffer = Buffer.from(base64, "base64"); } catch { throw new BadRequestException("Invalid document data."); }
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) throw new BadRequestException("Document must be between 1 byte and 5 MB.");
    const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    const storageRoot = process.env.COURIER_DOCUMENT_STORAGE_DIR || join(process.cwd(), "var", "courier-documents");
    const directory = join(storageRoot, userId);
    await mkdir(directory, { recursive: true });
    const storageKey = join(userId, `${randomUUID()}-${safeName}`);
    await writeFile(join(storageRoot, storageKey), buffer);
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException("Invalid document expiry date.");
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO courier_documents
        (courier_user_id, document_type, storage_key, storage_provider, original_name, content_type, size_bytes, checksum_sha256, expires_at, status)
       VALUES ($1,$2,$3,'local_private',$4,$5,$6,$7,$8,'pending')
       RETURNING id`,
      [userId, input.documentType, storageKey, safeName, input.contentType, buffer.length, checksum, expiresAt]
    );
    const documentId = result.rows[0]?.id;
    if (!documentId) throw new NotFoundException("Document upload failed.");
    if (input.replacesDocumentId) {
      await this.database.query("UPDATE courier_documents SET status = 'rejected', review_notes = COALESCE(review_notes, 'Superseded by a newer upload.'), reviewed_at = COALESCE(reviewed_at, now()) WHERE id = $1 AND courier_user_id = $2 AND id <> $3", [input.replacesDocumentId, userId, documentId]);
    }
    await this.database.query("INSERT INTO courier_verification_events (courier_user_id, document_id, actor_user_id, to_status, reason, metadata) VALUES ($1,$2,$3,'pending','Document uploaded',$4)", [userId, documentId, userId, JSON.stringify({ documentType: input.documentType, sizeBytes: buffer.length, contentType: input.contentType })]);
    return { id: documentId, documentType: input.documentType, status: "pending", originalName: safeName, contentType: input.contentType, sizeBytes: buffer.length, expiresAt: expiresAt?.toISOString() ?? null };
  }

  async documentFile(actorUserId: string, documentId: string, roles: readonly string[]) {
    const result = await this.database.query<{ id: string; courier_user_id: string; storage_key: string; content_type: string | null; original_name: string | null; storage_provider: string }>(
      "SELECT id, courier_user_id, storage_key, content_type, original_name, storage_provider FROM courier_documents WHERE id = $1",
      [documentId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Document not found.");
    const isAdmin = roles.includes("admin") || roles.includes("operations") || roles.includes("support");
    if (!isAdmin && row.courier_user_id !== actorUserId) throw new ForbiddenException("You cannot access this document.");
    const storageRoot = process.env.COURIER_DOCUMENT_STORAGE_DIR || join(process.cwd(), "var", "courier-documents");
    const file = await readFile(join(storageRoot, row.storage_key));
    return { id: row.id, courierUserId: row.courier_user_id, fileName: row.original_name, contentType: row.content_type ?? "application/octet-stream", dataBase64: file.toString("base64") };
  }

  async submitVerification(userId: string) {
    const profile = await this.database.query<{ status: string; city_id: string | null; service_category_slug: string | null; vehicle_type: string }>("SELECT status, city_id, service_category_slug, vehicle_type FROM courier_profiles WHERE user_id = $1", [userId]);
    const row = profile.rows[0];
    if (!row) throw new NotFoundException("Courier profile not found.");
    const requirements = await this.requirements(userId, row.city_id ?? undefined, row.service_category_slug ?? undefined, row.vehicle_type);
    const required = requirements.items.filter((item) => item.required).map((item) => item.documentType);
    const documents = await this.database.query<{ document_type: string; status: string }>("SELECT document_type, status FROM courier_documents WHERE courier_user_id = $1", [userId]);
    const approvedTypes = new Set(documents.rows.filter((doc) => doc.status === "approved").map((doc) => doc.document_type));
    const missing = required.filter((type) => !approvedTypes.has(type));
    if (missing.length > 0) throw new ConflictException(`Upload and receive approval for: ${missing.join(", ")}.`);
    await this.database.query("UPDATE courier_profiles SET status = 'pending', verification_submitted_at = now(), last_decision_reason = NULL, updated_at = now() WHERE user_id = $1", [userId]);
    await this.database.query("INSERT INTO courier_verification_events (courier_user_id, actor_user_id, from_status, to_status, reason) VALUES ($1,$1,$2,'pending','Verification submitted with all required documents')", [userId, row.status]);
    return this.profile(userId);
  }

  async setAvailability(userId: string, input: Readonly<{ isOnline: boolean; acceptingOffers?: boolean | undefined; latitude?: number | undefined; longitude?: number | undefined }>) {
    const profile = await this.database.query<{ status: string }>("SELECT status FROM courier_profiles WHERE user_id = $1", [userId]);
    if (!profile.rows[0]) throw new NotFoundException("Courier profile not found.");
    if (input.isOnline && profile.rows[0].status !== "approved") throw new ConflictException("Your courier account has not been approved yet.");
    await this.database.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO courier_availability (courier_user_id, is_online, accepting_offers, last_location, last_seen_at)
         VALUES ($1,$2,$3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$4),4326) END, now())
         ON CONFLICT (courier_user_id) DO UPDATE SET
           is_online = $2, accepting_offers = COALESCE($3, courier_availability.accepting_offers),
           last_location = CASE WHEN $4::float8 IS NULL THEN courier_availability.last_location ELSE ST_SetSRID(ST_MakePoint($5,$4),4326) END,
           last_seen_at = now(), updated_at = now()`,
        [userId, input.isOnline, input.acceptingOffers ?? true, input.latitude ?? null, input.longitude ?? null]
      );
      if (!input.isOnline) {
        await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE courier_user_id = $1 AND status = 'pending'", [userId]);
        await client.query("UPDATE courier_availability SET accepting_offers = false WHERE courier_user_id = $1", [userId]);
      }
      if (input.latitude !== undefined && input.longitude !== undefined) {
        await client.query(
          `INSERT INTO courier_location_samples (courier_user_id, order_id, assignment_id, location)
           SELECT $1, ca.active_order_id, da.id, ST_SetSRID(ST_MakePoint($3,$2),4326)
           FROM courier_availability ca LEFT JOIN delivery_assignments da ON da.order_id = ca.active_order_id AND da.courier_user_id = $1 AND da.status IN ('accepted','arrived_pickup','picked_up')
           WHERE ca.courier_user_id = $1`,
          [userId, input.latitude, input.longitude]
        );
      }
    });
    return { isOnline: input.isOnline, acceptingOffers: input.acceptingOffers ?? true };
  }

  async recordLocation(userId: string, input: Readonly<{ latitude: number; longitude: number; accuracyMeters?: number | undefined; headingDegrees?: number | undefined; speedMps?: number | undefined }>, idempotencyKey: string | undefined) {
    if (idempotencyKey && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header is required.");
    }
    return this.database.withTransaction(async (client) => {
      if (idempotencyKey) {
        const existing = await client.query(
          "SELECT 1 FROM courier_location_samples WHERE courier_user_id = $1 AND client_operation_id = $2",
          [userId, idempotencyKey]
        );
        if ((existing.rowCount ?? 0) > 0) return { recorded: true };
      }
      const availability = await client.query<{ active_order_id: string | null; is_online: boolean }>("SELECT active_order_id, is_online FROM courier_availability WHERE courier_user_id = $1", [userId]);
      const state = availability.rows[0];
      if (!state) throw new NotFoundException("Courier availability not initialized.");
      if (!state.is_online && !state.active_order_id) {
        throw new ForbiddenException("Location updates are only accepted while online or on an active delivery.");
      }
      await client.query(
        `UPDATE courier_availability SET last_location = ST_SetSRID(ST_MakePoint($2,$3),4326), last_seen_at = now(), updated_at = now() WHERE courier_user_id = $1`,
        [userId, input.longitude, input.latitude]
      );
      if (state.active_order_id) {
        const assignment = await client.query<{ id: string }>(
          "SELECT id FROM delivery_assignments WHERE order_id = $1 AND courier_user_id = $2 AND status IN ('accepted','arrived_pickup','picked_up') ORDER BY created_at DESC LIMIT 1",
          [state.active_order_id, userId]
        );
        await client.query(
          `INSERT INTO courier_location_samples (courier_user_id, order_id, assignment_id, location, accuracy_meters, heading_degrees, speed_mps, client_operation_id)
           VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($5,$4),4326),$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [userId, state.active_order_id, assignment.rows[0]?.id ?? null, input.latitude, input.longitude, input.accuracyMeters ?? null, input.headingDegrees ?? null, input.speedMps ?? null, idempotencyKey ?? null]
        );
      }
      return { recorded: true };
    });
  }

  async deliveries(userId: string, scope: "active" | "history", limit: number, offset: number) {
    const result = await this.database.query<CourierDeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE da.courier_user_id = $1 AND da.status = ANY($2::text[])
       ORDER BY da.created_at DESC LIMIT $3 OFFSET $4`,
      [userId, scope === "active" ? ["accepted", "arrived_pickup", "picked_up"] : ["delivered", "cancelled", "failed"], limit, offset]
    );
    // Contact details are only exposed while the delivery is live.
    return { items: result.rows.map((row) => this.mapDelivery(row, scope === "active")) };
  }

  async activeDelivery(userId: string) {
    const result = await this.deliveries(userId, "active", 1, 0);
    return { delivery: result.items[0] ?? null };
  }

  /**
   * Full execution view for one assigned delivery. Only the courier holding the
   * assignment may read it, so customer and merchant contact data stay scoped.
   */
  async delivery(userId: string, orderId: string) {
    const result = await this.database.query<CourierDeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE da.courier_user_id = $1 AND o.id = $2
       ORDER BY da.created_at DESC LIMIT 1`,
      [userId, orderId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Delivery not found.");
    const events = await this.database.query<{ from_status: string | null; to_status: string; note: string | null; created_at: Date }>(
      `SELECT from_status, to_status, metadata->>'note' AS note, created_at
       FROM order_status_events WHERE order_id = $1 ORDER BY created_at ASC, id ASC LIMIT 100`,
      [orderId]
    );
    const includeContact = ["accepted", "arrived_pickup", "picked_up"].includes(row.assignment_status)
      || row.return_status === "pending";
    const delivery = this.mapDelivery(row, includeContact);
    return {
      delivery,
      allowedActions: allowedCourierActions({
        assignmentStatus: row.assignment_status,
        orderStatus: row.order_status,
        returnRequired: row.return_required,
        returnStatus: row.return_status
      }),
      timeline: events.rows.map((event) => ({
        fromStatus: event.from_status,
        toStatus: event.to_status,
        note: event.note,
        at: event.created_at.toISOString()
      }))
    };
  }

  /** Failed deliveries whose goods must be returned to the merchant. */
  async pendingReturns(userId: string) {
    const result = await this.database.query<CourierDeliveryRow>(
      `${DELIVERY_SELECT}
       WHERE da.courier_user_id = $1 AND da.status = 'failed'
         AND da.return_required = true AND da.return_status = 'pending'
       ORDER BY da.cancelled_at DESC NULLS LAST, da.created_at DESC LIMIT 50`,
      [userId]
    );
    return { items: result.rows.map((row) => this.mapDelivery(row, false)) };
  }

  async transition(
    userId: string,
    orderId: string,
    action: CourierAction,
    input: Readonly<{
      proofCode?: string | undefined;
      proofStorageKey?: string | undefined;
      recipientName?: string | undefined;
      notes?: string | undefined;
      failureReason?: FailureReasonCode | undefined;
      returnRequired?: boolean | undefined;
    }>,
    requestIdValue: string | null,
    idempotencyKey: string | undefined
  ) {
    if (idempotencyKey && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      throw new BadRequestException("A valid Idempotency-Key header is required.");
    }
    const profile = await this.database.query<{ status: string }>("SELECT status FROM courier_profiles WHERE user_id = $1", [userId]);
    if (!profile.rows[0] || profile.rows[0].status !== "approved") throw new ForbiddenException("Your courier account has not been approved yet.");
    return this.orders.courierTransition({
      orderId,
      courierUserId: userId,
      action,
      proofCode: input.proofCode,
      proofStorageKey: input.proofStorageKey,
      recipientName: input.recipientName,
      notes: input.notes,
      failureReason: input.failureReason,
      returnRequired: input.returnRequired,
      requestId: requestIdValue,
      ipHash: null,
      idempotencyKey
    });
  }

  private mapDelivery(row: CourierDeliveryRow, includeContact = true) {
    const proofMode = effectiveProofMode({
      proofMode: row.delivery_proof_mode,
      proofRequired: row.delivery_proof_required
    });
    const reason = row.failure_reason_code ? failureReason(row.failure_reason_code) : undefined;
    return {
      assignmentId: row.assignment_id,
      assignmentStatus: row.assignment_status,
      orderId: row.order_id,
      orderNumber: row.order_number,
      orderStatus: row.order_status,
      orderKind: row.order_kind,
      paymentStatus: row.payment_status,
      totalMinor: Number(row.total_minor),
      currency: row.currency,
      courierEarningMinor: Number(row.delivery_fee_minor) + Number(row.tip_minor),
      tipMinor: Number(row.tip_minor),
      merchantName: row.merchant_name,
      pickupAddress: row.pickup_address,
      deliveryAddress: row.delivery_address,
      deliveryAddressSnapshot: row.delivery_address_snapshot,
      deliveryInstructions: includeContact ? row.delivery_instructions : null,
      customerName: row.customer_name,
      customerPhone: includeContact ? row.customer_phone : null,
      deliveryProofRequired: row.delivery_proof_required,
      deliveryProofMode: proofMode,
      deliveryEstimateMinutes: row.delivery_estimate_minutes,
      pickup: {
        name: row.merchant_name,
        address: row.pickup_address,
        latitude: row.pickup_lat === null ? null : Number(row.pickup_lat),
        longitude: row.pickup_lng === null ? null : Number(row.pickup_lng),
        contactName: includeContact ? row.merchant_contact_name : null,
        contactPhone: includeContact ? row.merchant_contact_phone : null
      },
      dropoff: {
        name: row.delivery_recipient_name ?? row.customer_name,
        address: row.delivery_address,
        latitude: row.delivery_lat === null ? null : Number(row.delivery_lat),
        longitude: row.delivery_lng === null ? null : Number(row.delivery_lng),
        contactName: includeContact ? row.customer_name : null,
        contactPhone: includeContact ? row.delivery_contact_phone ?? row.customer_phone : null,
        instructions: includeContact ? row.delivery_instructions : null
      },
      failure: row.failure_reason_code === null ? null : {
        reasonCode: row.failure_reason_code,
        reasonLabel: reason?.label ?? row.failure_reason_code,
        notes: row.failure_notes,
        returnRequired: row.return_required,
        returnStatus: row.return_status,
        returnConfirmedAt: row.return_confirmed_at?.toISOString() ?? null,
        returnNotes: row.return_notes
      },
      acceptedAt: row.accepted_at?.toISOString() ?? null,
      arrivedAt: row.arrived_at?.toISOString() ?? null,
      pickedUpAt: row.picked_up_at?.toISOString() ?? null,
      deliveredAt: row.delivered_at?.toISOString() ?? null
    };
  }

  async earnings(userId: string) {
    const [summary, payouts, recent, performance] = await Promise.all([
      this.database.query<{ delivered: number; gross: string; tips: string }>(
        `SELECT count(*)::int AS delivered,
                COALESCE(sum(f.courier_earning_minor),0)::text AS gross,
                COALESCE(sum(f.tip_minor),0)::text AS tips
         FROM delivery_assignments da JOIN order_financials f ON f.order_id = da.order_id
         WHERE da.courier_user_id = $1 AND da.status = 'delivered'`, [userId]
      ),
      this.database.query("SELECT id, period_start, period_end, gross_earnings_minor, deductions_minor, tips_minor, net_payable_minor, currency, status, paid_at FROM courier_payouts WHERE courier_user_id = $1 ORDER BY period_end DESC LIMIT 20", [userId]),
      this.database.query(
        `SELECT o.order_number, o.delivered_at, f.courier_earning_minor, f.tip_minor, f.currency
         FROM delivery_assignments da JOIN orders o ON o.id = da.order_id JOIN order_financials f ON f.order_id = o.id
         WHERE da.courier_user_id = $1 AND da.status = 'delivered' ORDER BY o.delivered_at DESC LIMIT 20`, [userId]
      ),
      this.database.query<{ rating_average: string; acceptance_rate: number }>(
        `SELECT cp.rating_average::text AS rating_average,
                COALESCE((SELECT count(*) FILTER (WHERE o.status = 'accepted')::float8 / NULLIF(count(*) FILTER (WHERE o.status IN ('accepted','rejected')), 0)
                          FROM dispatch_offers o WHERE o.courier_user_id = cp.user_id AND o.created_at > now() - interval '30 days'), 0.75)::float8 AS acceptance_rate
         FROM courier_profiles cp WHERE cp.user_id = $1`, [userId]
      ),
    ]);
    const paidOut = payouts.rows.filter((row) => row.status === "PAID").reduce((sum, row) => sum + Number(row.net_payable_minor), 0);
    const gross = Number(summary.rows[0]?.gross ?? 0);
    const tips = Number(summary.rows[0]?.tips ?? 0);
    const deductions = payouts.rows.reduce((sum, row) => sum + Number(row.deductions_minor ?? 0), 0);
    return {
      completedDeliveries: summary.rows[0]?.delivered ?? 0,
      lifetimeEarningsMinor: gross + tips,
      grossEarningsMinor: gross,
      tipsMinor: tips,
      deductionsMinor: deductions,
      settledEarningsMinor: paidOut,
      pendingPayoutMinor: Math.max(0, gross + tips - paidOut),
      ratingAverage: Number(performance.rows[0]?.rating_average ?? 0),
      acceptanceRate: performance.rows[0]?.acceptance_rate ?? 0.75,
      payouts: payouts.rows.map((row) => ({
        id: row.id as string, periodStart: (row.period_start as Date).toISOString(), periodEnd: (row.period_end as Date).toISOString(),
        grossEarningsMinor: Number(row.gross_earnings_minor), deductionsMinor: Number(row.deductions_minor), tipsMinor: Number(row.tips_minor),
        netPayableMinor: Number(row.net_payable_minor), currency: row.currency as string, status: row.status as string,
        paidAt: (row.paid_at as Date | null)?.toISOString() ?? null
      })),
      recentDeliveries: recent.rows.map((row) => ({
        orderNumber: row.order_number as string, deliveredAt: (row.delivered_at as Date | null)?.toISOString() ?? null,
        earningMinor: Number(row.courier_earning_minor), tipMinor: Number(row.tip_minor), currency: row.currency as string
      }))
    };
  }

  async earningsDisputes(userId: string) {
    const result = await this.database.query(
      `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at, o.order_number,
              (SELECT count(*)::int FROM support_messages sm WHERE sm.ticket_id = t.id AND sm.is_internal = false) AS message_count
       FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.user_id = $1 AND t.category = 'earnings' ORDER BY t.created_at DESC LIMIT 20`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, subject: row.subject as string, status: row.status as string, priority: row.priority as string,
        orderNumber: row.order_number as string | null, messageCount: row.message_count as number,
        createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString()
      }))
    };
  }

  async createEarningsDispute(userId: string, input: Readonly<{ subject: string; message: string; orderId?: string | null; payoutId?: string | null }>) {
    if (input.orderId) {
      const assignment = await this.database.query(
        `SELECT 1 FROM delivery_assignments da WHERE da.courier_user_id = $1 AND da.order_id = $2 LIMIT 1`,
        [userId, input.orderId]
      );
      if ((assignment.rowCount ?? 0) === 0) throw new NotFoundException("Order not found.");
    }
    const reference = input.payoutId ? `Ref payout ${input.payoutId}. ` : "";
    return this.support.create(userId, {
      subject: input.subject, category: "earnings", orderId: input.orderId ?? null, priority: "NORMAL",
      message: `${reference}${input.message}`
    });
  }
}
