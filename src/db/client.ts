/**
 * Edge-compatible Drizzle client backed by serverless Postgres (Neon).
 * Stateless: one HTTP-driven connection per request, suitable for Workers.
 */
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

/** Lazily build the singleton db handle from DATABASE_URL. */
export function getDb(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  _db = drizzle(pool, { schema });
  return _db;
}

export { schema };
