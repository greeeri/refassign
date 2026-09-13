import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../../lib/supabase/server";
import { requireManagedOrganization } from "../../../../../lib/server/organizationScope";

type Targets = {
  coverage: number;
  compliance: number;
  delivery: number;
  training: number;
};
const defaults: Targets = {
  coverage: 95,
  compliance: 95,
  delivery: 95,
  training: 90,
};
const nextSend = (frequency: "weekly" | "monthly", day: number) => {
  const now = new Date(),
    next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13),
    );
  if (frequency === "weekly") {
    const distance = (day - next.getUTCDay() + 7) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + distance);
  } else {
    next.setUTCDate(Math.min(28, day));
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.toISOString();
};

async function context(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return { error: scope.error };
  const { user, service, organizationId } = scope;
  const organizationIds = [organizationId];
  let query = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  query = organizationIds.length
    ? query.in("organization_id", organizationIds)
    : query.eq("user_id", user.id);
  const { data: subscription } = await query.maybeSingle();
  return {
    user,
    service,
    organizationIds,
    premium: subscription?.reporting_access !== "standard",
  };
}

export async function GET(request: NextRequest) {
  const value = await context(request);
  if (value.error) return value.error;
  const { user, service, organizationIds, premium } = value;
  const [{ data: organizations }, { data: schedules }] = await Promise.all([
    organizationIds.length
      ? service
          .from("organizations")
          .select("id,name")
          .in("id", organizationIds)
          .order("name")
      : Promise.resolve({ data: [] }),
    premium && organizationIds.length
      ? service
          .from("executive_report_schedules")
          .select(
            "organization_id,recipient_email,frequency,send_day,enabled,kpi_targets,last_sent_at,next_send_at",
          )
          .eq("user_id", user.id)
          .in("organization_id", organizationIds)
      : Promise.resolve({ data: [] }),
  ]);
  return NextResponse.json({
    reportingAccess: premium ? "premium" : "standard",
    organizations: organizations || [],
    schedules: schedules || [],
    defaultEmail: user.email || "",
    defaultTargets: defaults,
  });
}

export async function POST(request: NextRequest) {
  const value = await context(request);
  if (value.error) return value.error;
  const { user, service, organizationIds, premium } = value;
  if (!premium)
    return NextResponse.json(
      {
        error:
          "Premium reporting is required for executive targets and scheduled summaries.",
      },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as {
    organizationId?: string;
    recipientEmail?: string;
    frequency?: "weekly" | "monthly";
    sendDay?: number;
    enabled?: boolean;
    kpiTargets?: Partial<Targets>;
  };
  if (!body.organizationId || !organizationIds.includes(body.organizationId))
    return NextResponse.json(
      { error: "Select an organization you manage." },
      { status: 403 },
    );
  const email = (body.recipientEmail || user.email || "").trim().slice(0, 320),
    frequency = body.frequency === "monthly" ? "monthly" : "weekly",
    maxDay = frequency === "weekly" ? 6 : 28,
    sendDay = Math.min(
      maxDay,
      Math.max(
        frequency === "weekly" ? 0 : 1,
        Math.round(Number(body.sendDay ?? 1)),
      ),
    );
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json(
      { error: "Enter a valid recipient email." },
      { status: 400 },
    );
  const targets = Object.fromEntries(
    Object.entries({ ...defaults, ...(body.kpiTargets || {}) }).map(
      ([key, raw]) => [
        key,
        Math.min(
          100,
          Math.max(
            1,
            Math.round(Number(raw) || defaults[key as keyof Targets]),
          ),
        ),
      ],
    ),
  );
  const payload = {
    organization_id: body.organizationId,
    user_id: user.id,
    recipient_email: email,
    frequency,
    send_day: sendDay,
    enabled: Boolean(body.enabled),
    kpi_targets: targets,
    next_send_at: body.enabled ? nextSend(frequency, sendDay) : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await service
    .from("executive_report_schedules")
    .upsert(payload, { onConflict: "organization_id,user_id" })
    .select(
      "organization_id,recipient_email,frequency,send_day,enabled,kpi_targets,last_sent_at,next_send_at",
    )
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ schedule: data });
}
