/**
 * Module 1 — Organization settings service. Reads/writes the per-tenant global
 * settings (locale, grading scale, feature flags) stored in the existing
 * organizations.global_settings jsonb column — no new table needed. Mutations
 * are super_admin-only (enforced at the route) and audited.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { organizations } from "../../db/schema";
import { ValidationError, type OrgSettingsInput, type GradingScale } from "../../lib/validation";
import type { AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface OrgSettings {
  locale: string;
  gradingScale: GradingScale;
  featureFlags: Record<string, boolean>;
}

const DEFAULTS: OrgSettings = {
  locale: "en-US",
  gradingScale: "letter",
  featureFlags: {},
};

/** Coerce whatever is in the jsonb column into a complete settings object. */
function normalize(raw: unknown): OrgSettings {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    locale: typeof s.locale === "string" ? s.locale : DEFAULTS.locale,
    gradingScale: (["letter", "percentage", "gpa4", "gpa10"].includes(s.gradingScale as string)
      ? s.gradingScale
      : DEFAULTS.gradingScale) as GradingScale,
    featureFlags:
      s.featureFlags && typeof s.featureFlags === "object" && !Array.isArray(s.featureFlags)
        ? (s.featureFlags as Record<string, boolean>)
        : {},
  };
}

/** Read an organization's settings (defaults applied for missing keys). */
export async function getOrgSettings(db: DB, orgId: string): Promise<OrgSettings> {
  const [row] = await db
    .select({ id: organizations.id, globalSettings: organizations.globalSettings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!row) {
    throw new ValidationError("Organization not found", { orgId: "no such organization" });
  }
  return normalize(row.globalSettings);
}

/** Replace an organization's settings (+ audit). */
export async function updateOrgSettings(
  db: DB,
  orgId: string,
  input: OrgSettingsInput,
  ctx: AuthContext,
): Promise<OrgSettings> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!row) {
      throw new ValidationError("Organization not found", { orgId: "no such organization" });
    }

    const settings: OrgSettings = {
      locale: input.locale,
      gradingScale: input.gradingScale,
      featureFlags: input.featureFlags,
    };

    await tx
      .update(organizations)
      .set({
        globalSettings: settings as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId,
      branchId: null,
      action: "org.settings.update",
      entityType: "organization",
      entityId: orgId,
      summary: `Updated settings: locale ${settings.locale}, grading ${settings.gradingScale}`,
      metadata: settings as unknown as Record<string, unknown>,
    });

    return settings;
  });
}
