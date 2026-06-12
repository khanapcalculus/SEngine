/**
 * Standalone production seed — bootstraps the first Super Admin.
 *
 * Run once against a fresh database to create the network owner account so a
 * human can log in and configure everything else. Designed for `tsx`/`ts-node`,
 * NOT the edge runtime.
 *
 * Properties:
 *  - Password is read from SEED_ADMIN_PASSWORD (never hardcoded, never logged).
 *  - Password is hashed with our edge crypto (PBKDF2) — same code path as login,
 *    so the seeded hash verifies against /api/auth/login with zero drift.
 *  - Idempotent: re-running detects an existing admin and exits cleanly.
 *  - Transactional: org + branch + user + staff_profile commit together.
 *
 * Schema note: a super_admin is network-level (users.org_id may be null), but
 * staff_profiles.branch_id is NOT NULL. To create the *linked* Staff_Profile the
 * prompt asks for, we first bootstrap a "Network HQ" organization + branch for
 * the admin's profile to reference. This keeps the FK satisfied and gives the
 * admin a real home branch instead of a dangling profile.
 *
 * Usage:
 *   export DATABASE_URL="postgres://...neon..."
 *   export SEED_ADMIN_EMAIL="admin@network.com"        # optional, has default
 *   export SEED_ADMIN_PASSWORD="<strong-password>"     # required
 *   npx tsx src/db/seed.ts
 *   # or: npx ts-node --esm src/db/seed.ts
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";
import ws from "ws";

/**
 * Load KEY=VALUE pairs from an env file (e.g. one created by
 * `vercel env pull`) into process.env, WITHOUT overriding anything already set
 * in the shell. Lets the seed use Vercel's exact DATABASE_URL with no retyping.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// Pick up Vercel-pulled env (.env.local) if the shell didn't already set these.
loadEnvFile(".env.local");
import {
  organizations,
  branches,
  users,
  staffProfiles,
} from "./schema";
import { hashPassword, verifyPassword } from "../lib/crypto";

// In Node there is no global WebSocket; Neon's driver needs one for its pool.
// (At the edge this is provided by the runtime and this line is unnecessary.)
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@network.com";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Network Super Admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    console.error(
      "✗ SEED_ADMIN_PASSWORD must be set and at least 12 characters. Aborting.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, {
    schema: { organizations, branches, users, staffProfiles },
  });

  // Print which database host we're about to write to (password masked) so we
  // can confirm it matches the host Vercel uses. Host is not a secret.
  try {
    const host = new URL(url).host;
    console.log(`→ Connected to database host: ${host}`);
  } catch {
    console.log("→ (could not parse DATABASE_URL host)");
  }

  try {
    // Idempotency guard: bail out if this admin already exists.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    if (existing.length > 0) {
      // Reset mode: overwrite the existing admin's password with the current
      // SEED_ADMIN_PASSWORD. Use this when you no longer know the stored
      // password. Run: set SEED_RESET_PASSWORD=true  (then re-run the seed)
      if (process.env.SEED_RESET_PASSWORD === "true") {
        const newHash = await hashPassword(ADMIN_PASSWORD);
        await db
          .update(users)
          .set({ passwordHash: newHash, globalStatus: "active" })
          .where(eq(users.id, existing[0].id));

        // Self-verify: read the row back and confirm the password we just set
        // verifies against the stored hash IN THIS DATABASE. If this prints
        // true but the live site still rejects login, the live site is reading
        // a DIFFERENT database than this one.
        const [check] = await db
          .select({
            passwordHash: users.passwordHash,
            role: users.role,
            status: users.globalStatus,
          })
          .from(users)
          .where(eq(users.id, existing[0].id))
          .limit(1);
        const verifies = check?.passwordHash
          ? await verifyPassword(ADMIN_PASSWORD, check.passwordHash)
          : false;

        console.log(
          `✓ Reset password for "${ADMIN_EMAIL}" (id=${existing[0].id}).`,
        );
        console.log(`  role=${check?.role} status=${check?.status}`);
        console.log(`  password verifies against stored hash: ${verifies}`);
        console.log(
          "  → If this says true but the website still rejects login, the",
        );
        console.log(
          "    website's DATABASE_URL points to a different database than this seed.",
        );
        return;
      }

      console.log(
        `• Super Admin "${ADMIN_EMAIL}" already exists (id=${existing[0].id}). Nothing to do.`,
      );
      console.log(
        "  To reset its password: set SEED_RESET_PASSWORD=true  and run this again.",
      );
      return;
    }

    // Hash BEFORE the transaction (PBKDF2 is CPU-bound; keep the tx short).
    const passwordHash = await hashPassword(ADMIN_PASSWORD);

    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: "Network HQ" })
        .returning({ id: organizations.id });

      const [branch] = await tx
        .insert(branches)
        .values({
          orgId: org.id,
          location: "Network Headquarters",
          status: "active",
        })
        .returning({ id: branches.id });

      const [user] = await tx
        .insert(users)
        .values({
          orgId: org.id,
          email: ADMIN_EMAIL,
          fullName: ADMIN_NAME,
          passwordHash,
          role: "super_admin",
          globalStatus: "active",
        })
        .returning({ id: users.id });

      const [profile] = await tx
        .insert(staffProfiles)
        .values({
          userId: user.id,
          branchId: branch.id,
          department: "Administration",
          status: "active",
          // hire_date is NOT NULL; stamp today (yyyy-mm-dd).
          hireDate: new Date().toISOString().slice(0, 10),
        })
        .returning({ id: staffProfiles.id });

      return {
        orgId: org.id,
        branchId: branch.id,
        userId: user.id,
        staffProfileId: profile.id,
      };
    });

    // Log identifiers only — never the password or the hash.
    console.log("✓ Seeded Super Admin and linked Staff_Profile:");
    console.log(`  email           : ${ADMIN_EMAIL}`);
    console.log(`  user id         : ${result.userId}`);
    console.log(`  staff profile id: ${result.staffProfileId}`);
    console.log(`  organization id : ${result.orgId} (Network HQ)`);
    console.log(`  branch id       : ${result.branchId} (Network Headquarters)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Seed failed:", err instanceof Error ? err.message : err);
  // Drizzle wraps the underlying Postgres/connection error as `.cause`; surface
  // it so we can tell "table missing" from "auth failed" from "wrong host".
  const cause = (err as { cause?: unknown })?.cause;
  if (cause) {
    console.error(
      "  Underlying cause:",
      cause instanceof Error ? cause.message : cause,
    );
  }
  process.exit(1);
});
