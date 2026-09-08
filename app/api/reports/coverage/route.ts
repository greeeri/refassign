import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await supabase.rpc(
    "can_manage_game_setup",
  );
  if (accessError || !canManage)
    return NextResponse.json(
      { error: "Administrator or Assignor access is required." },
      { status: 403 },
    );

  // Use the signed-in client so league and organization RLS policies remain
  // authoritative as organization workspaces are enabled.
  const [gamesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("games")
      .select(
        "id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)",
      )
      .order("starts_at", { ascending: true }),
    supabase
      .from("assignments")
      .select(
        "id,game_id,status,published_at,accept_by,responded_at,decline_reason,officials(first_name,last_name),sport_positions(name)",
      ),
  ]);
  const error = gamesResult.error || assignmentsResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    games: gamesResult.data || [],
    assignments: assignmentsResult.data || [],
  });
}
