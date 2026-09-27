import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

const roles = ["owner", "admin", "assignor", "billing"];

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, roles);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  const result = await readAllPages<Record<string, any>>((from, to) => service
    .from("payroll_fee_corrections")
    .select("id,assignment_id,paid_game_fee,proposed_game_fee,difference,status,created_at,reviewed_at,assignments!inner(officials(first_name,last_name),sport_positions(name),games!inner(game_number,starts_at,league_id,leagues(name)))")
    .eq("organization_id", organizationId).order("created_at", { ascending: false }).order("id").range(from, to));
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const corrections = (result.data || []).filter((row) => {
    const assignment = Array.isArray(row.assignments) ? row.assignments[0] : row.assignments;
    const game = Array.isArray(assignment?.games) ? assignment.games[0] : assignment?.games;
    return !leagueIds || leagueIds.includes(game?.league_id);
  });
  return NextResponse.json({ corrections });
}

export async function PATCH(request: NextRequest) {
  const context = await requireManagedOrganization(request, roles);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds, user } = context;
  const body = await request.json().catch(() => ({})) as { id?: string; status?: string };
  if (!body.id || !["approved", "void"].includes(body.status || ""))
    return NextResponse.json({ error: "Select an adjustment and approve or void it." }, { status: 400 });
  const { data: correction } = await service.from("payroll_fee_corrections")
    .select("id,assignment_id,assignments!inner(games!inner(league_id))")
    .eq("id", body.id).eq("organization_id", organizationId).maybeSingle();
  if (!correction) return NextResponse.json({ error: "Correction not found." }, { status: 404 });
  const assignment = Array.isArray(correction.assignments) ? correction.assignments[0] : correction.assignments;
  const game = Array.isArray(assignment?.games) ? assignment.games[0] : assignment?.games;
  if (leagueIds && !leagueIds.includes(game?.league_id))
    return NextResponse.json({ error: "You do not manage this league." }, { status: 403 });
  const { data, error } = await service.from("payroll_fee_corrections")
    .update({ status: body.status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", body.id).eq("organization_id", organizationId).eq("status", "pending")
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Correction was already reviewed. Reload Payroll." }, { status: 409 });
  return NextResponse.json({ saved: true });
}
