import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/apply-sql.mjs <migrations|seeds>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const directory = join(process.cwd(), "infrastructure", "postgres", folder);
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: databaseUrl, ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });

await client.connect();
try {
  for (const file of files) {
    const sql = await readFile(join(directory, file), "utf8");
    process.stdout.write(`Applying ${folder}/${file}... `);
    await client.query(sql);
    console.log("ok");
  }
} finally {
  await client.end();
}
