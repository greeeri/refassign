import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, [
    "owner",
    "admin",
    "assignor",
    "billing",
  ]);
  if (context.error) return context.error;
  const { service, user, organizationId } = context;
  const assignmentResult = await service
    .from("assignments")
    .select(
      "id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,payroll_notes,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games!inner(id,game_number,starts_at,organization_id,bill_to_id,bill_to:bill_to_accounts(name),leagues(name,mileage_plan),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,latitude,longitude))",
    )
    .eq("games.organization_id", organizationId)
    .not("official_id", "is", null)
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  const officialIds = [
    ...new Set(
      (assignmentResult.data || [])
        .map((row) => {
          const official = row.officials as unknown as
            { id: string } | Array<{ id: string }> | null;
          return Array.isArray(official) ? official[0]?.id : official?.id;
        })
        .filter(Boolean),
    ),
  ] as string[];
  const originResult = officialIds.length
    ? await service
        .from("official_weekday_origins")
        .select(
          "official_id,weekday,use_home,alternate_label,alternate_latitude,alternate_longitude",
        )
        .in("official_id", officialIds)
    : { data: [], error: null };

  const loadError = assignmentResult.error || originResult.error;
  if (loadError) {
    console.error("[api/payroll] manager payroll load failed", {
      userId: user.id,
      organizationId,
      error: loadError.message,
    });
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }

  console.info("[api/payroll] manager payroll loaded", {
    userId: user.id,
    organizationId,
    assignments: assignmentResult.data?.length || 0,
  });
  return NextResponse.json({
    assignments: assignmentResult.data || [],
    weekdayOrigins: originResult.data || [],
  });
}

export async function PATCH(request: NextRequest) {
  const context = await requireManagedOrganization(request, [
    "owner",
    "admin",
    "billing",
  ]);
  if (context.error) return context.error;
  const { service, user, organizationId } = context;
  const body = (await request.json()) as {
    assignmentId?: string;
    billToId?: string | null;
    gameFee?: number;
    mileageMiles?: number;
    mileageRate?: number;
    paymentStatus?: string;
    payrollNotes?: string | null;
  };
  if (!body.assignmentId)
    return NextResponse.json(
      { error: "Assignment is required." },
      { status: 400 },
    );
  if (
    !["unpaid", "approved", "paid", "void"].includes(body.paymentStatus || "")
  )
    return NextResponse.json(
      { error: "Payment status is invalid." },
      { status: 400 },
    );
  if (
    [body.gameFee, body.mileageMiles, body.mileageRate].some(
      (value) => Number(value) < 0,
    )
  )
    return NextResponse.json(
      { error: "Payroll amounts cannot be negative." },
      { status: 400 },
    );
  const { data: assignment, error: assignmentError } = await service
    .from("assignments")
    .select("id,game_id,paid_at,games!inner(organization_id)")
    .eq("id", body.assignmentId)
    .eq("games.organization_id", organizationId)
    .single();
  if (assignmentError || !assignment)
    return NextResponse.json(
      { error: "Payroll assignment was not found." },
      { status: 404 },
    );
  if (body.billToId) {
    const { data: billTo } = await service
      .from("bill_to_accounts")
      .select("id")
      .eq("id", body.billToId)
      .eq("organization_id", organizationId)
      .eq("active", true)
      .maybeSingle();
    if (!billTo)
      return NextResponse.json(
        { error: "Bill To is not available for this organization." },
        { status: 400 },
      );
  }
  const now = new Date().toISOString();
  const [{ error: payrollError }, { error: gameError }] = await Promise.all([
    service
      .from("assignments")
      .update({
        game_fee: Number(body.gameFee || 0),
        mileage_miles: Number(body.mileageMiles || 0),
        mileage_rate: Number(body.mileageRate || 0),
        payment_status: body.paymentStatus,
        paid_at:
          body.paymentStatus === "paid" ? assignment.paid_at || now : null,
        payroll_notes: String(body.payrollNotes || "").trim() || null,
        payroll_updated_at: now,
        payroll_updated_by: user.id,
      })
      .eq("id", assignment.id),
    service
      .from("games")
      .update({ bill_to_id: body.billToId || null })
      .eq("id", assignment.game_id)
      .eq("organization_id", organizationId),
  ]);
  const error = payrollError || gameError;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ saved: true });
}
