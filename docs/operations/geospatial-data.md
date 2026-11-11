# Geospatial Data Operations

The geospatial stack runs from the `geo` Docker Compose profile. It requires a real Ethiopia OpenStreetMap extract plus generated tile/routing/search data.

## Required inputs

- OSM extract: `infrastructure/geo/osm/ethiopia-latest.osm.pbf`
- Vector tiles: `infrastructure/geo/data/ethiopia.mbtiles`
- Optional satellite imagery: a real COG/GeoTIFF and `MAP_SATELLITE_TILE_URL`

Partial downloads must never be treated as valid inputs. Check the PBF header before building:

```powershell
$path = 'infrastructure/geo/osm/ethiopia-latest.osm.pbf'
$stream = [System.IO.File]::OpenRead($path)
try {
  $header = New-Object byte[] 4
  [void]$stream.Read($header, 0, 4)
  $length = ($header[0] -shl 24) -bor ($header[1] -shl 16) -bor ($header[2] -shl 8) -bor $header[3]
  $block = New-Object byte[] $length
  [void]$stream.Read($block, 0, $length)
  [System.Text.Encoding]::ASCII.GetString($block)
} finally {
  $stream.Dispose()
}
```

A valid file starts with `OSMHeader`.

## Build vector tiles

```powershell
docker compose --profile geo-build run --rm planetiler
```

Planetiler also needs OpenMapTiles source datasets. If `osmdata.openstreetmap.de` is unreachable, the build stops before reading the PBF. Download those datasets on a reliable network, place them in `infrastructure/geo/data/sources/`, and rerun:

- `natural_earth_vector.sqlite.zip` from `https://dev.maptiler.download/geodata/omt/natural_earth_vector.sqlite.zip`
- `lake_centerline.shp.zip` from `https://dev.maptiler.download/geodata/omt/lake_centerline.shp.zip`
- `water-polygons-split-3857.zip` from `https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip`

Because the build cache is mounted at `/data`, existing files in `infrastructure/geo/data/sources/` are reused instead of downloaded. For a landlocked Ethiopia extract, the smaller global `simplified-water-polygons-split-3857.zip` can be saved as `water-polygons-split-3857.zip`; use the full dataset for coastal extracts. `--download` can time out against slow mirrors, so pre-populating the cache is usually more reliable.

## Start services

```powershell
docker compose --profile geo up -d
docker compose ps
```

If `ghcr.io` is unreachable, build the Martin image locally from the official musl binary:

```powershell
$url = 'https://github.com/maplibre/martin/releases/download/martin-v1.15.0/martin-x86_64-unknown-linux-musl.tar.gz'
$dir = "$env:TEMP\martin-bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
curl.exe -L --fail --retry 3 -o "$dir\martin.tar.gz" $url
tar -xzf "$dir\martin.tar.gz" -C $dir
@'
FROM scratch
COPY martin /usr/local/bin/martin
ENTRYPOINT ["/usr/local/bin/martin"]
'@ | Set-Content "$dir\Dockerfile"
docker build -t ghcr.io/maplibre/martin:1.15.0 $dir
docker compose --profile geo up -d --no-deps martin
```

Services:

- Martin: `http://localhost:8080`
- Valhalla: `http://localhost:8002`
- Nominatim: `http://localhost:8081`
- TiTiler: `http://localhost:8000` (optional; start with `--profile geo-imagery`)
- Geo gateway: `http://localhost:8090`

Enable self-hosted geocoding with `GEOCODING_PROVIDER=nominatim`. When the API is started through the npm workspace, `dotenv` loads `services/api/.env`; keep `NOMINATIM_URL`, `VALHALLA_URL`, and `MAP_TILE_SERVER_URL` aligned with the root `.env` used by Compose.

## Database targets

The API uses the local PostgreSQL instance from `.env` at `localhost:5432`. Compose database `db` publishes `5433` and is a separate dataset. Martin defaults to the local app database through `GEO_DATABASE_URL`; keep this aligned with the API:

```powershell
docker compose run --rm --no-deps db psql "postgresql://delivery_app:delivery_app@host.docker.internal:5432/delivery_app" -c "SELECT count(*) FROM orders;"
```

## Apply geospatial migrations

```powershell
node --env-file=.env scripts/apply-one-sql.mjs infrastructure/postgres/migrations/0031_geospatial_intelligence.sql
```

The existing `scripts/apply-sql.mjs` applies every sorted SQL file and has no migration ledger. Use `apply-one-sql.mjs` when only one migration is intended.

## Import buildings

Full national extraction streams the Ethiopia PBF through a temporary SQLite node index:

```powershell
node scripts/extract-osm-buildings.mjs infrastructure/geo/osm/ethiopia-latest.osm.pbf infrastructure/geo/data/buildings-full.geojsonseq
node --env-file=.env scripts/import-geojson-buildings.mjs infrastructure/geo/data/buildings-full.geojsonseq osm
```

The extractor writes one GeoJSON Feature per line, so the importer never loads the full national dataset into memory. The importer validates the dataset source, repairs geometries, computes `area_sqm`, upserts by `(source_id, source_feature_id)`, and updates dataset import metadata. Only import real licensed data.

Verified full import from `ethiopia-latest.osm.pbf`: `28,702,872` nodes, `3,333,757` ways, `2,656,214` building ways, `2,656,212` written footprints, `2` skipped unclosed ways, `0` missing-node ways, `1,077,850,374` bytes, `244s`. Database totals: `2,656,212` footprints, `194.08 km²`, `73.1 m²` average, extent `32.9627258,3.3616757` to `47.9431839,14.809186`.

## Validation

- PBF starts with `OSMHeader`
- `ethiopia.mbtiles` exists and is larger than a placeholder. The verified Ethiopia build is `191,291,392` bytes with `259,655` tiles, zoom `0-14`, and metadata format `pbf`/`OpenMapTiles`.
- Martin `/health`, MBTiles tile, and `building_footprints` tile endpoints respond
- Valhalla route request returns distance/duration
- Nominatim `/search` and `/reverse` return real place data
- Geo gateway `/tiles`, `/routing`, and `/geocode` proxies respond
- API `/api/v1/maps/config` reports the configured provider, tileset, routing, and geocoding state
- Migrations `0031` exist in both target databases
- No PBF/MBTiles/GeoTIFF artifacts are committed
