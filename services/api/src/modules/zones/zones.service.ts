import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class ZonesService {
  constructor(private readonly database: DatabaseService) {}

  async list(citySlug: string | undefined) {
    const result = await this.database.query(
      `SELECT z.id, z.slug, z.display_name, z.operating_hours, z.is_active, c.slug AS city_slug, c.display_name AS city_name,
              ST_AsGeoJSON(z.boundary::geometry)::json AS boundary
       FROM service_zones z JOIN cities c ON c.id = z.city_id
       WHERE z.is_active = true AND c.is_active = true AND ($1::text IS NULL OR c.slug = $1)
       ORDER BY z.display_name`,
      [citySlug ?? null]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, slug: row.slug as string, displayName: row.display_name as string,
        citySlug: row.city_slug as string, cityName: row.city_name as string,
        operatingHours: row.operating_hours, boundary: row.boundary, isActive: row.is_active as boolean
      }))
    };
  }

  async check(latitude: number, longitude: number) {
    const result = await this.database.query(
      `SELECT z.id, z.slug, z.display_name, c.slug AS city_slug
       FROM service_zones z JOIN cities c ON c.id = z.city_id
       WHERE z.is_active = true AND c.is_active = true
         AND ST_Contains(z.boundary, ST_SetSRID(ST_MakePoint($2,$1),4326))
       LIMIT 1`,
      [latitude, longitude]
    );
    const zone = result.rows[0];
    return {
      serviceable: Boolean(zone),
      zone: zone ? { id: zone.id as string, slug: zone.slug as string, displayName: zone.display_name as string, citySlug: zone.city_slug as string } : null
    };
  }

  async adminList() {
    const result = await this.database.query(
      `SELECT z.id, z.slug, z.display_name, z.is_active, c.slug AS city_slug, c.display_name AS city_name,
              ST_AsGeoJSON(z.boundary::geometry)::json AS boundary, z.operating_hours
       FROM service_zones z JOIN cities c ON c.id = z.city_id ORDER BY c.display_name, z.display_name`
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, slug: row.slug, displayName: row.display_name, isActive: row.is_active,
        citySlug: row.city_slug, cityName: row.city_name, boundary: row.boundary, operatingHours: row.operating_hours
      }))
    };
  }

  async create(input: Readonly<{ cityId: string; slug: string; displayName: string; boundary: Record<string, unknown>; operatingHours: Record<string, unknown> }>) {
    const city = await this.database.query("SELECT 1 FROM cities WHERE id = $1", [input.cityId]);
    if ((city.rowCount ?? 0) === 0) throw new NotFoundException("City not found.");
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO service_zones (city_id, slug, display_name, boundary, operating_hours)
       VALUES ($1,$2,$3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)), $5) RETURNING id`,
      [input.cityId, input.slug, input.displayName, JSON.stringify(input.boundary), JSON.stringify(input.operatingHours)]
    );
    return { id: result.rows[0]?.id };
  }

  async setActive(zoneId: string, active: boolean) {
    const result = await this.database.query("UPDATE service_zones SET is_active = $2 WHERE id = $1", [zoneId, active]);
    if (result.rowCount === 0) throw new NotFoundException("Service zone not found.");
    return { zoneId, isActive: active };
  }

  async update(zoneId: string, input: Readonly<{ displayName?: string | undefined; boundary?: Record<string, unknown> | undefined; operatingHours?: Record<string, unknown> | undefined }>) {
    if (!input.displayName && !input.boundary && !input.operatingHours) throw new ConflictException("No changes supplied.");
    const result = await this.database.query(
      `UPDATE service_zones SET display_name = COALESCE($2, display_name),
              boundary = CASE WHEN $3::text IS NULL THEN boundary ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)) END,
              operating_hours = COALESCE($4::jsonb, operating_hours)
       WHERE id = $1`,
      [zoneId, input.displayName ?? null, input.boundary ? JSON.stringify(input.boundary) : null, input.operatingHours ? JSON.stringify(input.operatingHours) : null]
    );
    if (result.rowCount === 0) throw new NotFoundException("Service zone not found.");
    return { updated: true };
  }
}
