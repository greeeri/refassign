import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { session: supabase, service, organizationId } = scope;
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  if (subscription?.reporting_access === "standard")
    return NextResponse.json(
      {
        error: "Premium reporting is required for payroll and payment reports.",
        reportingAccess: "standard",
      },
      { status: 403 },
    );

  // The signed-in client preserves organization and league RLS filtering.
  const { data, error } = await supabase
    .from("assignments")
    .select(
      "id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name),sport_positions(name),games!inner(id,organization_id,game_number,starts_at,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
    )
    .eq("games.organization_id", organizationId)
    .not("official_id", "is", null)
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    reportingAccess: "premium",
    assignments: data || [],
  });
}
