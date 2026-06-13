/**
 * Module 1 — Tenant topology queries for the super admin dashboard.
 *
 * Read-only helpers that expose the organization -> branch tree so a network
 * admin can switch management context without manually entering identifiers.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { branches, organizations } from "../../db/schema";
import type {
  CreateBranchInput,
  CreateOrganizationInput,
} from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";

export interface TenantBranch {
  id: string;
  orgId: string;
  location: string;
  status: string;
}

export interface TenantOrganization {
  id: string;
  name: string;
  branches: TenantBranch[];
}

export async function listTenantTree(db: DB): Promise<TenantOrganization[]> {
  const orgRows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
    })
    .from(organizations);

  const branchRows = await db
    .select({
      id: branches.id,
      orgId: branches.orgId,
      location: branches.location,
      status: branches.status,
    })
    .from(branches);

  const sortedBranches = [...branchRows].sort((a, b) =>
    a.location.localeCompare(b.location),
  );

  return [...orgRows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((org) => ({
      id: org.id,
      name: org.name,
      branches: sortedBranches.filter((branch) => branch.orgId === org.id),
    }));
}

/** The authenticated super admin performing a tenant mutation (for audit). */
export interface TenantActor {
  userId: string;
}

export interface CreatedOrganization {
  id: string;
  name: string;
}

/**
 * Provision a new organization (top of the tenant hierarchy). Super-admin only;
 * the route enforces RBAC. The org row + its audit entry commit together.
 */
export async function createOrganization(
  db: DB,
  input: CreateOrganizationInput,
  actor: TenantActor,
): Promise<CreatedOrganization> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.name })
      .returning({ id: organizations.id, name: organizations.name });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: org.id,
      branchId: null,
      action: "organization.create",
      entityType: "organization",
      entityId: org.id,
      summary: `Created organization ${org.name}`,
    });

    return { id: org.id, name: org.name };
  });
}

export interface CreatedBranch {
  id: string;
  orgId: string;
  location: string;
  status: string;
}

/**
 * Provision a new branch inside an existing organization. We verify the org
 * exists first so a bad orgId returns a clean 400 instead of a raw FK violation.
 * The branch row + its audit entry commit together.
 */
export async function createBranch(
  db: DB,
  input: CreateBranchInput,
  actor: TenantActor,
): Promise<CreatedBranch> {
  return db.transaction(async (tx) => {
    const org = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, input.orgId))
      .limit(1);

    if (org.length === 0) {
      throw new ValidationError("Organization not found", {
        orgId: "unknown organization",
      });
    }

    const [branch] = await tx
      .insert(branches)
      .values({
        orgId: input.orgId,
        location: input.location,
        status: input.status,
      })
      .returning({
        id: branches.id,
        orgId: branches.orgId,
        location: branches.location,
        status: branches.status,
      });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: branch.orgId,
      branchId: branch.id,
      action: "branch.create",
      entityType: "branch",
      entityId: branch.id,
      summary: `Created branch ${branch.location} (${branch.status})`,
    });

    return branch;
  });
}
