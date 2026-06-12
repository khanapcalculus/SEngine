import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration — drives `drizzle-kit generate` / `push`.
 * Connection string points at the serverless Postgres branch (Neon/Supabase).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
