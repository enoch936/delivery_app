import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { AddressRecord } from "./addresses.types.js";

type AddressRow = {
  id: string;
  label: string;
  recipient_name: string;
  phone_e164: string;
  address_line: string;
  delivery_instructions: string | null;
  latitude: number | null;
  longitude: number | null;
  service_zone_id: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

export type AddressInput = Readonly<{
  label?: string;
  recipientName?: string;
  phoneE164?: string;
  addressLine?: string;
  deliveryInstructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}>;

@Injectable()
export class AddressesService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string): Promise<{ items: AddressRecord[] }> {
    const result = await this.database.query<AddressRow>(
      `SELECT id, label, recipient_name, phone_e164, address_line, delivery_instructions,
              ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
              service_zone_id, is_default, created_at, updated_at
       FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return { items: result.rows.map(mapAddress) };
  }

  async create(userId: string, input: Required<Pick<AddressInput, "label" | "recipientName" | "phoneE164" | "addressLine">> & AddressInput): Promise<AddressRecord> {
    return this.database.withTransaction(async (client) => {
      if (input.isDefault) await client.query("UPDATE customer_addresses SET is_default = false WHERE user_id = $1 AND is_default = true", [userId]);
      const hasAddress = await client.query("SELECT 1 FROM customer_addresses WHERE user_id = $1 LIMIT 1", [userId]);
      const isDefault = input.isDefault || hasAddress.rowCount === 0;
      const result = await client.query<AddressRow>(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, phone_e164, address_line, delivery_instructions, location, is_default)
         VALUES ($1, $2, $3, $4, $5, $6,
           CASE WHEN $7::double precision IS NULL OR $8::double precision IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326) END,
           $9)
         RETURNING id, label, recipient_name, phone_e164, address_line, delivery_instructions,
                   ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                   service_zone_id, is_default, created_at, updated_at`,
        [userId, input.label, input.recipientName, input.phoneE164, input.addressLine, input.deliveryInstructions ?? null, input.latitude ?? null, input.longitude ?? null, isDefault]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Address insert did not return a row.");
      await client.query(
        `UPDATE customer_addresses ca SET service_zone_id = sz.id
         FROM service_zones sz
         WHERE ca.id = $1 AND ca.location IS NOT NULL AND sz.is_active = true
           AND ST_Contains(sz.boundary, ca.location::geometry)`,
        [row.id]
      );
      return mapAddress(row);
    });
  }

  async update(userId: string, addressId: string, input: AddressInput): Promise<AddressRecord> {
    return this.database.withTransaction(async (client) => {
      const existing = await client.query<AddressRow>(
        `SELECT id, label, recipient_name, phone_e164, address_line, delivery_instructions,
                ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                service_zone_id, is_default, created_at, updated_at
         FROM customer_addresses WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [addressId, userId]
      );
      const current = existing.rows[0];
      if (!current) throw new NotFoundException("Address not found.");
      if (input.isDefault) await client.query("UPDATE customer_addresses SET is_default = false WHERE user_id = $1 AND is_default = true", [userId]);
      const latitude = input.latitude === undefined ? current.latitude : input.latitude;
      const longitude = input.longitude === undefined ? current.longitude : input.longitude;
      const result = await client.query<AddressRow>(
        `UPDATE customer_addresses SET
           label = COALESCE($3, label),
           recipient_name = COALESCE($4, recipient_name),
           phone_e164 = COALESCE($5, phone_e164),
           address_line = COALESCE($6, address_line),
           delivery_instructions = CASE WHEN $7 THEN $8 ELSE delivery_instructions END,
           location = CASE WHEN $9::double precision IS NULL OR $10::double precision IS NULL THEN NULL
                           ELSE ST_SetSRID(ST_MakePoint($10, $9), 4326) END,
           is_default = COALESCE($11, is_default)
         WHERE id = $1 AND user_id = $2
         RETURNING id, label, recipient_name, phone_e164, address_line, delivery_instructions,
                   ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                   service_zone_id, is_default, created_at, updated_at`,
        [addressId, userId, input.label, input.recipientName, input.phoneE164, input.addressLine,
          input.deliveryInstructions !== undefined, input.deliveryInstructions ?? null, latitude, longitude, input.isDefault]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Address update did not return a row.");
      await client.query(
        `UPDATE customer_addresses ca SET service_zone_id = (
           SELECT sz.id FROM service_zones sz WHERE sz.is_active = true AND ca.location IS NOT NULL
           AND ST_Contains(sz.boundary, ca.location::geometry) ORDER BY sz.created_at LIMIT 1)
         WHERE ca.id = $1`,
        [addressId]
      );
      return mapAddress(row);
    });
  }

  async remove(userId: string, addressId: string): Promise<void> {
    const result = await this.database.query("DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2", [addressId, userId]);
    if (result.rowCount === 0) throw new NotFoundException("Address not found.");
  }
}

function mapAddress(row: AddressRow): AddressRecord {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    phoneE164: row.phone_e164,
    addressLine: row.address_line,
    deliveryInstructions: row.delivery_instructions,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    serviceZoneId: row.service_zone_id,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
