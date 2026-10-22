import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../supabase/admin";
import { createServerSupabaseClient } from "../supabase/server";
import { readAllPages, readAllForChunks } from "../supabase/readAll";

const managerRoles = ["owner", "admin", "assignor"];
export type LeagueAccess = { league_id: string; all_locations: boolean; location_ids: string[] };
const noRecord = "00000000-0000-0000-0000-000000000000";

/** Apply the paired league/location predicate before ordering or pagination. */
export function scopeGameQuery<Query>(query: Query, scope: { fullOrganizationAccess?: boolean; leagueAccess?: LeagueAccess[] | null }, referencedTable?: string): Query {
  if (scope.fullOrganizationAccess === true) return query;
  const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);
  const filters = (scope.leagueAccess || []).flatMap((access) => {
    if (!safeId(access.league_id)) return [];
    if (access.all_locations === true) return [`league_id.eq.${access.league_id}`];
    const locations = [...new Set((access.location_ids || []).filter(safeId))];
    return locations.length ? [`and(league_id.eq.${access.league_id},location_id.in.(${locations.join(",")}))`] : [];
  });
  const builder = query as Query & { eq(column: string, value: string): Query; or(filter: string, options?: { referencedTable: string }): Query };
  if (!filters.length) return builder.eq(referencedTable ? `${referencedTable}.id` : "id", noRecord);
  return builder.or(filters.join(","), referencedTable ? { referencedTable } : undefined);
}

/** Resolve active membership grants and location links without cached profile fallbacks. */
export async function readCurrentLeagueAccess(service: ReturnType<typeof createServiceClient>, organizationId: string, userId: string) {
  const [access, coverage] = await Promise.all([
    readAllPages<LeagueAccess>((from, to) => service.from("organization_member_league_access")
      .select("league_id,all_locations,location_ids").eq("organization_id", organizationId).eq("user_id", userId).order("league_id").range(from, to)),
    readAllPages<{ league_id: string }>((from, to) => service.from("organization_league_coverage").select("league_id")
      .eq("organization_id", organizationId).eq("active", true).order("league_id").order("id").range(from, to)),
  ]);
  if (access.error || coverage.error) return { data: null, error: access.error || coverage.error };
  const covered = new Set((coverage.data || []).map((row) => row.league_id));
  const grants = (access.data || []).filter((row) => covered.has(row.league_id));
  const locations = grants.some((row) => row.all_locations !== true)
    ? await readAllPages<{ location_id: string }>((from, to) => service.from("organization_locations")
        .select("location_id,locations!inner(active)").eq("organization_id", organizationId).eq("active", true)
        .eq("locations.active", true).order("location_id").range(from, to))
    : { data: [], error: null };
  if (locations.error) return { data: null, error: locations.error };
  const activeLocations = new Set((locations.data || []).map((row) => row.location_id));
  return { data: grants.map((row) => ({ league_id: row.league_id, all_locations: row.all_locations === true,
    location_ids: Array.isArray(row.location_ids) ? row.location_ids.filter((id) => activeLocations.has(id)) : [],
  })), error: null };
}

/** Resolve current membership and explicit scope on every request, never a cached profile. */
export async function requireManagedOrganization(
  request: NextRequest,
  allowedRoles: string[] = managerRoles,
) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId)
    return { error: NextResponse.json({ error: "Select an organization." }, { status: 400 }) };

  const service = createServiceClient();
  const [membershipResult, superAdminResult] = await Promise.all([
    // A user can have several roles. Taking an arbitrary first row can hide owner access.
    service.from("organization_memberships").select("role")
      .eq("organization_id", organizationId).eq("user_id", user.id),
    service.from("protected_accounts").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (membershipResult.error || superAdminResult.error)
    return { error: NextResponse.json({ error: "Could not verify organization access." }, { status: 500 }) };
  const roles = (membershipResult.data || []).map((membership) => membership.role as string);
  const isSuperAdmin = Boolean(superAdminResult.data);
  const fullOrganizationAccess = isSuperAdmin || roles.includes("owner");
  if (!fullOrganizationAccess && !roles.some((role) => allowedRoles.includes(role)))
    return { error: NextResponse.json({ error: "You do not manage this organization." }, { status: 403 }) };

  const { data: subscription, error: subscriptionError } = await service
    .from("refassign_subscriptions").select("status,access_override")
    .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (subscriptionError)
    return { error: NextResponse.json({ error: "Could not verify the organization subscription." }, { status: 500 }) };
  if (!isSuperAdmin && (!subscription || (!subscription.access_override && !["active", "trialing"].includes(subscription.status))))
    return {
      error: NextResponse.json({
        error: "This organization needs an active subscription. Open Billing & Tax to restore access.",
        code: "SUBSCRIPTION_REQUIRED", billing_url: "/billing",
      }, { status: 402 }),
    };

  let leagueIds: string[] | null = null;
  let leagueAccess: LeagueAccess[] | null = null;
  if (!fullOrganizationAccess) {
    const access = await readCurrentLeagueAccess(service, organizationId, user.id);
    if (access.error)
      return { error: NextResponse.json({ error: "Could not verify league access." }, { status: 500 }) };
    leagueAccess = access.data || [];
    leagueIds = [...new Set(leagueAccess.map((row) => row.league_id))];
    // Empty/missing/revoked scope never falls back to organization-wide access.
    if (!leagueIds.length)
      return { error: NextResponse.json({ error: "No active leagues are assigned to your organization access." }, { status: 403 }) };
  }
  return { session, service, user, organizationId, isSuperAdmin, fullOrganizationAccess, leagueIds, leagueAccess };
}

/** Shared organization records have no league-local permission boundary. */
export async function requireOrganizationOwner(request: NextRequest) {
  return requireManagedOrganization(request, ["owner"]);
}

type ManagedScope = {
  service: ReturnType<typeof createServiceClient>;
  organizationId: string;
  fullOrganizationAccess: boolean;
  leagueIds: string[] | null;
  leagueAccess: LeagueAccess[] | null;
};
const denied = () => NextResponse.json({ error: "One or more selected records are outside your league access." }, { status: 403 });
const validIds = (ids: string[]) => ids.length > 0 && ids.every((id) => typeof id === "string" && id.trim().length > 0);

/** Validate the complete requested batch before any service-role content read or side effect. */
export async function requireGameScope(scope: Partial<ManagedScope>, requestedIds: string[]) {
  if (!scope.service || !scope.organizationId || typeof scope.fullOrganizationAccess !== "boolean" || !validIds(requestedIds)) return denied();
  const ids = [...new Set(requestedIds)];
  if (!scope.fullOrganizationAccess && !scope.leagueIds?.length) return denied();
  const result = await readAllForChunks<{ id: string }, string>(ids, (chunk, from, to) => {
    let query = scope.service.from("games").select("id,league_id,location_id").eq("organization_id", scope.organizationId).in("id", chunk);
    query = scopeGameQuery(query, scope);
    return query.order("id").range(from, to);
  });
  if (result.error) return NextResponse.json({ error: "Could not verify selected game access." }, { status: 500 });
  return new Set((result.data || []).map((row) => row.id)).size === ids.length ? null : denied();
}

export async function requireAssignmentScope(scope: Partial<ManagedScope>, requestedIds: string[], gameId?: string) {
  if (!scope.service || !scope.organizationId || typeof scope.fullOrganizationAccess !== "boolean" || !validIds(requestedIds)) return denied();
  const ids = [...new Set(requestedIds)];
  if (!scope.fullOrganizationAccess && !scope.leagueIds?.length) return denied();
  const result = await readAllForChunks<{ id: string }, string>(ids, (chunk, from, to) => {
    let query = scope.service.from("assignments").select("id,games!inner(organization_id,league_id,location_id)")
      .eq("games.organization_id", scope.organizationId).in("id", chunk).order("id").range(from, to);
    query = scopeGameQuery(query, scope, "games");
    if (gameId) query = query.eq("game_id", gameId);
    return query.order("id").range(from, to);
  });
  if (result.error) return NextResponse.json({ error: "Could not verify selected assignment access." }, { status: 500 });
  return new Set((result.data || []).map((row) => row.id)).size === ids.length ? null : denied();
}

/** League-wide operations need All locations; restricted members use game/assignment guards. */
export async function requireLeagueScope(scope: Partial<ManagedScope>, requestedIds: string[]) {
  if (!scope.service || !scope.organizationId || typeof scope.fullOrganizationAccess !== "boolean" || !validIds(requestedIds)) return denied();
  const ids = [...new Set(requestedIds)];
  if (!scope.fullOrganizationAccess && ids.some((id) => !scope.leagueIds?.includes(id) || !scope.leagueAccess?.some((access) => access.league_id === id && access.all_locations === true))) return denied();
  const result = await readAllForChunks<{ league_id: string }, string>(ids, (chunk, from, to) => scope.service
    .from("organization_league_coverage").select("league_id").eq("organization_id", scope.organizationId)
    .eq("active", true).in("league_id", chunk).order("league_id").order("id").range(from, to));
  if (result.error) return NextResponse.json({ error: "Could not verify selected league access." }, { status: 500 });
  return new Set((result.data || []).map((row) => row.league_id)).size === ids.length ? null : denied();
}

/** Scoped operators may reuse only billing accounts already attached to their games. */
export async function requireBillToScope(scope: Partial<ManagedScope>, requestedIds: string[]) {
  if (!scope.service || !scope.organizationId || typeof scope.fullOrganizationAccess !== "boolean" || !validIds(requestedIds)) return denied();
  if (scope.fullOrganizationAccess) return null;
  const ids = [...new Set(requestedIds)];
  const result = await readAllForChunks<{ bill_to_id: string }, string>(ids, (chunk, from, to) => scopeGameQuery(scope.service
    .from("games").select("bill_to_id").eq("organization_id", scope.organizationId).in("bill_to_id", chunk), scope)
    .order("id").range(from, to));
  if (result.error) return NextResponse.json({ error: "Could not verify selected billing account access." }, { status: 500 });
  const allowed = new Set((result.data || []).map((row) => row.bill_to_id));
  return ids.every((id) => allowed.has(id)) ? null : denied();
}

/** Group outreach is limited to active organization officials connected to the selected leagues. */
export async function requireOfficialScope(scope: Partial<ManagedScope>, requestedIds: string[]) {
  if (!scope.service || !scope.organizationId || typeof scope.fullOrganizationAccess !== "boolean" || !validIds(requestedIds)) return denied();
  const ids = [...new Set(requestedIds)];
  const links = await readAllForChunks<{ official_id: string }, string>(ids, (chunk, from, to) => scope.service
    .from("organization_officials").select("official_id").eq("organization_id", scope.organizationId)
    .eq("active", true).in("official_id", chunk).order("official_id").range(from, to));
  if (links.error) return NextResponse.json({ error: "Could not verify selected official access." }, { status: 500 });
  if (new Set((links.data || []).map((row) => row.official_id)).size !== ids.length) return denied();
  if (scope.fullOrganizationAccess) return null;
  if (!scope.leagueIds?.length) return denied();
  const [eligible, assigned] = await Promise.all([
    readAllForChunks<{ official_id: string }, string>(ids, (chunk, from, to) => scope.service
      .from("official_league_eligibility").select("official_id").in("official_id", chunk)
      .in("league_id", (scope.leagueAccess || []).filter((access) => access.all_locations).map((access) => access.league_id)).order("official_id").order("league_id").range(from, to)),
    readAllForChunks<{ official_id: string }, string>(ids, (chunk, from, to) => scopeGameQuery(scope.service
      .from("assignments").select("official_id,games!inner(organization_id,league_id)").in("official_id", chunk)
      .eq("games.organization_id", scope.organizationId).in("games.league_id", scope.leagueIds || [])
      .order("id").range(from, to), scope, "games")),
  ]);
  if (eligible.error || assigned.error) return NextResponse.json({ error: "Could not verify selected official league access." }, { status: 500 });
  const allowed = new Set([...(eligible.data || []), ...(assigned.data || [])].map((row) => row.official_id));
  return ids.every((id) => allowed.has(id)) ? null : denied();
}

/** Billing must stay available to a current owner even when the subscription is inactive. */
export async function isCurrentOrganizationOwner(service: ReturnType<typeof createServiceClient>, organizationId: string, userId: string) {
  const [membership, protectedAccount] = await Promise.all([
    service.from("organization_memberships").select("role").eq("organization_id", organizationId)
      .eq("user_id", userId).eq("role", "owner").maybeSingle(),
    service.from("protected_accounts").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  return !membership.error && !protectedAccount.error && Boolean(membership.data || protectedAccount.data);
}

export function canAccessGame(scope: { fullOrganizationAccess?: boolean; leagueAccess?: LeagueAccess[] | null }, game: { league_id?: string; location_id?: string | null }) {
  return scope.fullOrganizationAccess === true || Boolean(scope.leagueAccess?.some((access) => access.league_id === game.league_id &&
    (access.all_locations === true || (game.location_id && access.location_ids.includes(game.location_id)))));
}

/** A payroll batch is indivisible: every included game must be authorized. */
export async function requirePayrollBatchScope(scope: Partial<ManagedScope>, batchId: string) {
  if (!scope.service || !scope.organizationId) return denied();
  const { data: batch, error } = await scope.service.from("payroll_batches").select("id,league_id")
    .eq("id", batchId).eq("organization_id", scope.organizationId).maybeSingle();
  if (error || !batch) return denied();
  const items = await readAllPages<{ game_id: string }>((from, to) => scope.service.from("payroll_batch_items")
    .select("game_id").eq("payroll_batch_id", batchId).order("id").range(from, to));
  if (items.error) return NextResponse.json({ error: "Could not verify payroll batch access." }, { status: 500 });
  const gameIds = [...new Set((items.data || []).map((row) => row.game_id))];
  if (!gameIds.length) return scope.fullOrganizationAccess ? null : denied();
  return requireGameScope(scope, gameIds);
}

/** Read only scope keys before filtering complete batches, then page their content. */
export async function accessiblePayrollBatchIds(scope: Partial<ManagedScope>) {
  if (!scope.service || !scope.organizationId) return { data: [] as string[], error: { message: "Could not verify payroll scope." } };
  if (scope.fullOrganizationAccess) return { data: null, error: null };
  const items = await readAllPages<{ payroll_batch_id: string; games: { organization_id: string; league_id: string; location_id: string | null } | Array<{ organization_id: string; league_id: string; location_id: string | null }> }>((from, to) => scope.service
    .from("payroll_batch_items").select("payroll_batch_id,games(organization_id,league_id,location_id),payroll_batches!inner(organization_id)")
    .eq("payroll_batches.organization_id", scope.organizationId).order("id").range(from, to));
  if (items.error) return { data: [], error: items.error };
  const allowed = new Map<string, boolean>();
  for (const item of items.data || []) {
    const game = Array.isArray(item.games) ? item.games[0] : item.games;
    allowed.set(item.payroll_batch_id, allowed.get(item.payroll_batch_id) !== false && Boolean(game && game.organization_id === scope.organizationId && canAccessGame(scope, game)));
  }
  return { data: [...allowed].filter(([, permitted]) => permitted).map(([id]) => id), error: null };
}
