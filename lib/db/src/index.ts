import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});
export const db = drizzle(pool, { schema });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  try {
    await migrate(db, { migrationsFolder });
  } catch (_err: unknown) {
    // Schema may already be applied via drizzle-kit push — ignore duplicate errors
  }
  await pool.query("ALTER TABLE channels ADD COLUMN IF NOT EXISTS backup_stream_url text");
  await pool.query(`CREATE TABLE IF NOT EXISTS iptv_users (
    id serial PRIMARY KEY,
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    playlist_key text NOT NULL UNIQUE,
    channel_ids integer[] NOT NULL,
    enabled boolean NOT NULL DEFAULT true
  )`);
  await pool.query(`ALTER TABLE iptv_users
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS imported_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS device_leases jsonb NOT NULL DEFAULT '{}'::jsonb`);
}

export * from "./schema";
