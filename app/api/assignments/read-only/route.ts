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
  const { data: member, error: memberError } = await service.from("organization_memberships")
    .select("viewer_permissions").eq("organization_id", organizationId).eq("user_id", user.id).eq("role", "viewer").maybeSingle();
  if (memberError || !member?.viewer_permissions?.includes("assignments")) return NextResponse.json({ error: "Read-only assignment access has not been granted for this organization." }, { status: 403 });
  const [{ data: subscription, error: subscriptionError }, { data: access, error: accessError }] = await Promise.all([
    service.from("refassign_subscriptions").select("status,access_override").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("organization_member_league_access").select("league_id").eq("organization_id", organizationId).eq("user_id", user.id),
  ]);
  if (subscriptionError || accessError) return NextResponse.json({ error: "Could not verify assignment access." }, { status: 500 });
  if (!subscription || (!subscription.access_override && !["active", "trialing"].includes(subscription.status))) return NextResponse.json({ error: "This organization needs an active subscription." }, { status: 402 });
  if (!access?.length) return NextResponse.json({ games: [], hasMore: false });
  const from = request.nextUrl.searchParams.get("from") || new Date().toISOString().slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) return NextResponse.json({ error: "Choose a valid start date." }, { status: 400 });
  const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  // Explicit projection excludes response tokens, personal contact data, rankings and pay.
  const { data: games, error } = await service.from("games")
    .select("id,game_number,starts_at,status,officials_needed,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name),assignments(id,status,published_at,officials(first_name,last_name),sport_positions(name))")
    .eq("organization_id", organizationId).in("league_id", access.map(row => row.league_id))
    .gte("starts_at", `${from}T00:00:00Z`).order("starts_at").order("id").range(offset, offset + 49);
  if (error) return NextResponse.json({ error: "Could not load assignments." }, { status: 500 });
  return NextResponse.json({ games: games || [], hasMore: games?.length === 50 }, { headers: { "Cache-Control": "private, no-store" } });
}
