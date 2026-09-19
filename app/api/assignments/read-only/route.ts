import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/admin";

export async function GET(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Select an organization." }, { status: 400 });
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
  if (!access?.length) return NextResponse.json({ games: [], hasMore: false, isMentor: mentor });
  const from = new Date().toISOString().slice(0,10);
  // Explicit projection excludes response tokens, personal contact data, rankings and pay.
  const { data: games, error } = await service.from("games")
    .select("id,game_number,starts_at,status,officials_needed,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name),assignments(id,status,published_at,officials(first_name,last_name),sport_positions(name))")
    .eq("organization_id", organizationId).in("league_id", access.map(row => row.league_id))
    .gte("starts_at", `${from}T00:00:00Z`).order("starts_at").order("id").limit(5000);
  if (error) return NextResponse.json({ error: "Could not load assignments." }, { status: 500 });
  return NextResponse.json({ games: games || [], isMentor: mentor }, { headers: { "Cache-Control": "private, no-store" } });
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
