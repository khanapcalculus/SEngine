/**
 * Drizzle client backed by serverless Postgres (Neon).
 *
 * Runs on Vercel's Node.js serverless runtime (NOT edge). We deliberately moved
 * off the edge runtime for DB routes: edge + Neon's per-invocation WebSocket
 * pool was intermittently failing to connect and crashing the function (500s).
 * On Node the WebSocket pool is stable, and it preserves the interactive
 * transactions our services need (the Neon HTTP driver can't do those).
 */
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema";

// Node has no global WebSocket in all versions; give Neon an explicit one.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
// Route simple (non-transactional) queries over HTTP fetch — faster and more
// robust than holding a socket open for a one-shot select.
neonConfig.poolQueryViaFetch = true;

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
