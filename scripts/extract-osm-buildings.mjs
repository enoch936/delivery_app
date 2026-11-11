import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import parseOSM from "osm-pbf-parser";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/extract-osm-buildings.mjs <input.osm.pbf> <output.geojsonseq>");
  process.exit(1);
}

const startedAt = Date.now();
const tempDir = await mkdtemp(join(tmpdir(), "delivery-osm-"));
const database = new DatabaseSync(join(tempDir, "buildings.sqlite"));
database.exec("PRAGMA journal_mode = OFF");
database.exec("PRAGMA synchronous = OFF");
database.exec("PRAGMA locking_mode = EXCLUSIVE");
database.exec("PRAGMA temp_store = MEMORY");
database.exec("CREATE TABLE nodes (id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL) WITHOUT ROWID");
database.exec("CREATE TABLE ways (id INTEGER PRIMARY KEY, refs TEXT NOT NULL, tags TEXT NOT NULL) WITHOUT ROWID");
const insertNode = database.prepare("INSERT OR REPLACE INTO nodes (id, lat, lon) VALUES (?, ?, ?)");
const insertWay = database.prepare("INSERT OR REPLACE INTO ways (id, refs, tags) VALUES (?, ?, ?)");
const selectNode = database.prepare("SELECT lat, lon FROM nodes WHERE id = ?");

let nodeCount = 0;
let wayCount = 0;
let buildingWayCount = 0;
let transactionRows = 0;
let inTransaction = false;

const startTransaction = () => {
  if (inTransaction) return;
  database.exec("BEGIN");
  inTransaction = true;
};

const commitTransaction = () => {
  if (!inTransaction) return;
  database.exec("COMMIT");
  inTransaction = false;
  transactionRows = 0;
};

const progress = (label, count) => {
  if (count % 100_000 !== 0) return;
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`${label}: ${count.toLocaleString()} (${elapsed}s)`);
};

const parser = parseOSM();
const source = createReadStream(input);
const sink = new Writable({
  objectMode: true,
  async write(items, _encoding, callback) {
    try {
      startTransaction();
      for (const item of items) {
        if (item.type === "node") {
          insertNode.run(item.id, item.lat, item.lon);
          nodeCount += 1;
          transactionRows += 1;
          progress("nodes", nodeCount);
        } else if (item.type === "way") {
          wayCount += 1;
          const building = item.tags?.building;
          if (building && building !== "no" && item.refs?.length >= 4) {
            const tags = {
              building,
              name: item.tags.name ?? item.tags["name:en"] ?? null,
              height: item.tags.height ?? null,
              levels: item.tags["building:levels"] ?? null
            };
            insertWay.run(item.id, JSON.stringify(item.refs), JSON.stringify(tags));
            buildingWayCount += 1;
            transactionRows += 1;
            progress("building ways", buildingWayCount);
          }
        }
        if (transactionRows >= 250_000) commitTransaction();
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }
});

await pipeline(source, parser, sink);
commitTransaction();

console.log(`parsed nodes=${nodeCount.toLocaleString()} ways=${wayCount.toLocaleString()} buildings=${buildingWayCount.toLocaleString()}`);

let written = 0;
let skippedUnclosed = 0;
let skippedMissing = 0;
const out = createWriteStream(output, { encoding: "utf8" });
const wayRows = database.prepare("SELECT id, refs, tags FROM ways").iterate();

for (const way of wayRows) {
  const refs = JSON.parse(way.refs);
  if (refs.length < 4 || refs[0] !== refs[refs.length - 1]) {
    skippedUnclosed += 1;
    continue;
  }
  const ring = [];
  let missing = false;
  for (const ref of refs) {
    const node = selectNode.get(ref);
    if (!node) {
      missing = true;
      break;
    }
    ring.push([node.lon, node.lat]);
  }
  if (missing) {
    skippedMissing += 1;
    continue;
  }
  const tags = JSON.parse(way.tags);
  const heightMeters = numericHeight(tags.height, tags.levels);
  const feature = {
    type: "Feature",
    id: `way/${way.id}`,
    properties: {
      source_feature_id: `way/${way.id}`,
      building: tags.building,
      name: tags.name,
      height_m: heightMeters
    },
    geometry: {
      type: "Polygon",
      coordinates: [ring]
    }
  };
  if (!out.write(`${JSON.stringify(feature)}\n`)) await once(out, "drain");
  written += 1;
  progress("features", written);
}

await new Promise((resolve, reject) => {
  out.end((error) => (error ? reject(error) : resolve()));
});

const size = (await stat(output)).size;
const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(JSON.stringify({
  input,
  output,
  bytes: size,
  written,
  skippedUnclosed,
  skippedMissing,
  nodeCount,
  wayCount,
  buildingWayCount,
  elapsedSeconds: elapsed
}, null, 2));

database.close();
await rm(tempDir, { recursive: true, force: true });

function numericHeight(height, levels) {
  const parsedHeight = Number(height);
  if (Number.isFinite(parsedHeight) && parsedHeight > 0) return parsedHeight;
  const parsedLevels = Number(levels);
  if (Number.isFinite(parsedLevels) && parsedLevels > 0) return parsedLevels * 3.2;
  return null;
}
