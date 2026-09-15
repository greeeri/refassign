import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json(
    {
      error:
        message === "UNAUTHORIZED"
          ? "Sign in required."
          : message === "FORBIDDEN"
            ? "Super-admin access required."
            : message,
    },
    {
      status:
        message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400,
    },
  );
}

export async function GET(request: NextRequest) {
  try {
    const { service } = await requireSuperAdmin();
    const [
      { data: organizations, error: organizationError },
      { data: leagues, error: leagueError },
    ] = await Promise.all([
      service.from("organizations").select("id,name,created_at").order("name"),
      service.from("leagues").select("id,name,active").order("name"),
    ]);
    if (organizationError) throw organizationError;
    if (leagueError) throw leagueError;

    const organizationRows = await Promise.all(
      (organizations || []).map(async (organization) => {
        const [officials, games, members, subscription] = await Promise.all([
          service
            .from("organization_officials")
            .select("official_id", { count: "exact", head: true })
            .eq("organization_id", organization.id),
          service
            .from("games")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organization.id),
          service
            .from("organization_memberships")
            .select("user_id", { count: "exact", head: true })
            .eq("organization_id", organization.id),
          service
            .from("refassign_subscriptions")
            .select("status")
            .eq("organization_id", organization.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return {
          ...organization,
          official_count: officials.count || 0,
          game_count: games.count || 0,
          member_count: members.count || 0,
          subscription_status: subscription.data?.status || null,
        };
      }),
    );

    const leagueRows = await Promise.all((leagues || []).map(async (league) => {
      const [games, eligibility, coverage] = await Promise.all([
        service.from("games").select("id", { count: "exact", head: true }).eq("league_id", league.id),
        service.from("official_league_eligibility").select("official_id", { count: "exact", head: true }).eq("league_id", league.id),
        service.from("organization_league_coverage").select("organizations(name)").eq("league_id", league.id),
      ]);
      return {
        ...league,
        game_count: games.count || 0,
        official_count: eligibility.count || 0,
        organizations: (coverage.data || []).map((row) => {
          const organization = row.organizations as unknown as { name?: string } | null;
          return organization?.name || "";
        }).filter(Boolean),
      };
    }));

    const search = (request.nextUrl.searchParams.get("officialQuery") || "").trim();
    let officials: Record<string, unknown>[] = [];
    let protectedRows: { user_id: string }[] = [];
    if (search.length >= 2) {
      const safeSearch = search.replace(/[%_(),]/g, " ").trim();
      const [{ data, error }, protectedResult] = await Promise.all([
        service
        .from("officials")
        .select("id,first_name,last_name,full_name,email,active,auth_user_id")
        .or(`first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%,full_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`)
        .order("last_name")
        .order("first_name")
        .limit(100),
        service.from("protected_accounts").select("user_id"),
      ]);
      if (error) throw error;
      officials = data || [];
      protectedRows = protectedResult.data || [];
    }

    const protectedIds = new Set(
      (protectedRows || []).map((row) => row.user_id),
    );
    return NextResponse.json({
      organizations: organizationRows,
      leagues: leagueRows,
      official_search_active: search.length >= 2,
      officials: officials.map((official) => ({
        ...official,
        protected: protectedIds.has(String(official.auth_user_id || "")),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = (await request.json()) as {
      type?: "official" | "league" | "organization";
      id?: string;
      confirmation?: string;
    };
    if (!body.id || !body.type) throw new Error("A resource is required.");

    if (body.type === "official") {
      const { data: official, error } = await service
        .from("officials")
        .select("first_name,last_name,full_name,email,auth_user_id")
        .eq("id", body.id)
        .maybeSingle();
      if (error) throw error;
      if (!official) throw new Error("Official not found.");
      const name =
        `${official.first_name || ""} ${official.last_name || ""}`.trim() ||
        official.full_name ||
        "Official";
      const required = official.email || name;
      if (body.confirmation !== required)
        throw new Error(`Type ${required} exactly to confirm deletion.`);
      const { error: deleteError } = await service.rpc(
        "super_admin_delete_official",
        {
          p_actor_user_id: user.id,
          p_official_id: body.id,
        },
      );
      if (deleteError) throw deleteError;
      if (official.auth_user_id) {
        const { data: protectedAccount } = await service.from("protected_accounts").select("user_id").eq("user_id", official.auth_user_id).maybeSingle();
        if (protectedAccount) throw new Error("The protected Super Admin login cannot be deleted.");
        const { error: authDeleteError } = await service.auth.admin.deleteUser(official.auth_user_id);
        if (authDeleteError) throw new Error(`Official records were deleted, but the linked login could not be removed: ${authDeleteError.message}`);
      }
      return NextResponse.json({ deleted: true, cache_version: Date.now() });
    }

    if (body.type === "league") {
      const { data: league, error } = await service.from("leagues").select("name").eq("id", body.id).maybeSingle();
      if (error) throw error;
      if (!league) throw new Error("League not found.");
      if (body.confirmation !== league.name) throw new Error(`Type ${league.name} exactly to confirm deletion.`);
      const { error: deleteError } = await service.rpc("super_admin_delete_league", {
        p_actor_user_id: user.id,
        p_league_id: body.id,
      });
      if (deleteError) throw deleteError;
      return NextResponse.json({ deleted: true, cache_version: Date.now() });
    }

    const { data: organization, error } = await service
      .from("organizations")
      .select("name")
      .eq("id", body.id)
      .maybeSingle();
    if (error) throw error;
    if (!organization) throw new Error("Organization not found.");
    if (body.confirmation !== organization.name)
      throw new Error(`Type ${organization.name} exactly to confirm deletion.`);
    const { error: deleteError } = await service.rpc(
      "super_admin_delete_organization",
      {
        p_actor_user_id: user.id,
        p_organization_id: body.id,
      },
    );
    if (deleteError) throw deleteError;
    return NextResponse.json({ deleted: true, cache_version: Date.now() });
  } catch (error) {
    return failure(error);
  }
}
