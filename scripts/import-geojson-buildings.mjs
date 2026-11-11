import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import pg from "pg";

const [file, sourceId = "osm"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/import-geojson-buildings.mjs <file.geojson|file.geojsonseq> [source-id]");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const batchSize = 500;
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
});
await client.connect();

const source = await client.query("SELECT id FROM geo_dataset_sources WHERE id = $1", [sourceId]);
if (source.rowCount === 0) {
  console.error(`Unknown geo_dataset_sources.id "${sourceId}". Add the dataset source before importing.`);
  await client.end();
  process.exit(1);
}

const confidence = sourceId === "osm" ? 0.9 : null;
let imported = 0;
let skipped = 0;
let batch = [];

for await (const feature of readFeatures(file)) {
  const record = toRecord(feature);
  if (!record) {
    skipped += 1;
    continue;
  }
  batch.push(record);
  if (batch.length >= batchSize) {
    await insertBatch(batch);
    imported += batch.length;
    batch = [];
    if (imported % 10_000 === 0) console.log(`imported: ${imported.toLocaleString()} skipped: ${skipped.toLocaleString()}`);
  }
}
if (batch.length > 0) {
  await insertBatch(batch);
  imported += batch.length;
}

await client.query(
  "UPDATE geo_dataset_sources SET imported_at = now(), updated_at = now(), dataset_version = $2 WHERE id = $1",
  [sourceId, file.split(/[\\/]/).pop() ?? file]
);
await client.query(
  "UPDATE building_footprints SET area_sqm = ST_Area(geometry::geography) WHERE source_id = $1 AND area_sqm IS NULL",
  [sourceId]
);
await client.end();

console.log(JSON.stringify({ file, sourceId, imported, skipped }, null, 2));

async function insertBatch(records) {
  await client.query("BEGIN");
  try {
    await client.query(
      `WITH input AS (
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[])
           AS t(source_feature_id, geometry, building_type, name, height_m)
       ), prepared AS (
         SELECT source_feature_id,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326)), 3)) AS geom,
                building_type,
                name,
                height_m
         FROM input
       )
       INSERT INTO building_footprints (
         source_id, source_feature_id, geometry, building_type, name, height_m, confidence, area_sqm
       )
       SELECT $6, source_feature_id, geom, NULLIF(building_type, ''), NULLIF(name, ''), height_m, $7, ST_Area(geom::geography)
       FROM prepared
       ON CONFLICT (source_id, source_feature_id) WHERE source_feature_id IS NOT NULL
       DO UPDATE SET
         geometry = EXCLUDED.geometry,
         building_type = EXCLUDED.building_type,
         name = EXCLUDED.name,
         height_m = EXCLUDED.height_m,
         confidence = EXCLUDED.confidence,
         area_sqm = EXCLUDED.area_sqm,
         last_seen_at = now(),
         updated_at = now()`,
      [
        records.map((record) => record.featureId),
        records.map((record) => record.geometry),
        records.map((record) => record.buildingType),
        records.map((record) => record.name),
        records.map((record) => record.height),
        sourceId,
        confidence
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function toRecord(feature) {
  const geometry = feature.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  const properties = feature.properties ?? {};
  const featureId = String(
    properties.source_feature_id
    ?? properties["@id"]
    ?? properties.osm_id
    ?? properties.id
    ?? feature.id
    ?? ""
  ).trim();
  if (!featureId) return null;
  const height = Number(properties.height_m ?? properties.height ?? properties["building:levels"]);
  return {
    featureId,
    geometry: JSON.stringify(geometry),
    buildingType: String(properties.building_type ?? properties.building ?? ""),
    name: String(properties.name ?? properties["name:en"] ?? ""),
    height: Number.isFinite(height) && height > 0 ? height : null
  };
}

async function* readFeatures(path) {
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      if (!first) throw error;
      lines.close();
      stream.destroy();
      const document = JSON.parse(await readFile(path, "utf8"));
      if (document.type === "FeatureCollection") {
        for (const feature of document.features ?? []) yield feature;
        return;
      }
      if (document.type === "Feature") {
        yield document;
        return;
      }
      throw new Error("Expected a GeoJSON Feature or FeatureCollection.");
    }
    first = false;
    if (parsed.type === "FeatureCollection") {
      for (const feature of parsed.features ?? []) yield feature;
      return;
    }
    if (parsed.type === "Feature") yield parsed;
  }
}
