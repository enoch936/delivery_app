import { readFile } from "node:fs/promises";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-one-sql.mjs <path-to-sql>");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
});
await client.connect();
try {
  const sql = await readFile(file, "utf8");
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end();
}
