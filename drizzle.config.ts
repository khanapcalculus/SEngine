import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Force Drizzle to use the Next.js local env file that we know already exists
config({ path: ".env.local" }); 

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