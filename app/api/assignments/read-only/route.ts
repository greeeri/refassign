import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/admin";

export async function GET(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Select an organization." }, { status: 400 });
  const today = new Date().toISOString().slice(0, 10);
  const from = request.nextUrl.searchParams.get("from") || today;
  const offsetText = request.nextUrl.searchParams.get("offset") || "0";
  const offset = Number(offsetText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isFinite(Date.parse(`${from}T00:00:00Z`)) || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from)
    return NextResponse.json({ error: "Select a valid date." }, { status: 400 });
  if (from < today) return NextResponse.json({ error: "Reload assignments to see upcoming games." }, { status: 400 });
  if (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(offset) || offset > Number.MAX_SAFE_INTEGER - 500)
    return NextResponse.json({ error: "Select a valid page." }, { status: 400 });
  // Keep each database response below the standard PostgREST row cap.
  const pageSize = 500;
  const headers = { "Cache-Control": "private, no-store" };
  const service = createServiceClient();
  const { data: memberships, error: memberError } = await service.from("organization_memberships")
    .select("role,viewer_permissions").eq("organization_id", organizationId).eq("user_id", user.id).in("role", ["viewer", "mentor"]);
  const mentor = memberships?.some(member => member.role === "mentor");
  const viewer = memberships?.some(member => member.role === "viewer" && member.viewer_permissions?.includes("assignments"));
  if (memberError || (!mentor && !viewer)) return NextResponse.json({ error: "Read-only game and assignment access has not been granted for this organization." }, { status: 403 });
  const [{ data: subscription, error: subscriptionError }, { data: access, error: accessError }] = await Promise.all([
    service.from("refassign_subscriptions").select("status,access_override").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("organization_member_league_access").select("league_id").eq("organization_id", organizationId).eq("user_id", user.id),
  ]);
  if (subscriptionError || accessError) return NextResponse.json({ error: "Could not verify assignment access." }, { status: 500 });
  if (!subscription || (!subscription.access_override && !["active", "trialing"].includes(subscription.status))) return NextResponse.json({ error: "This organization needs an active subscription." }, { status: 402 });
  if (!access?.length) return NextResponse.json({ games: [], hasMore: false, nextOffset: null, from, isMentor: mentor }, { headers });
  // Explicit projection excludes response tokens, personal contact data, rankings and pay.
  const { data: games, error } = await service.from("games")
    .select("id,game_number,starts_at,status,officials_needed,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name),assignments(id,status,published_at,officials(first_name,last_name),sport_positions(name))")
    .eq("organization_id", organizationId).is("archived_at", null).in("league_id", access.map(row => row.league_id))
    .gte("starts_at", `${from}T00:00:00Z`).order("starts_at").order("id").range(offset, offset + pageSize - 1);
  if (error) return NextResponse.json({ error: "Could not load assignments." }, { status: 500 });
  const rows = games || [];
  const hasMore = rows.length === pageSize;
  return NextResponse.json({ games: rows, hasMore, nextOffset: hasMore ? offset + rows.length : null, from, isMentor: mentor }, { headers });
}

export async function POST(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { gameId } = await request.json() as { gameId?: string };
  if (!gameId) return NextResponse.json({ error: "Select a game." }, { status: 400 });
  const { error } = await session.rpc("self_assign_game_mentor", { p_game_id: gameId });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ success: true });
}
