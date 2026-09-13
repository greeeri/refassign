import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";

type Access = {
  locations?: string[];
  leagues?: string[];
  levels?: string[];
  teams?: string[];
};

const accessTables = [
  ["contact_location_access", "location_id", "locations"],
  ["contact_league_access", "league_id", "leagues"],
  ["contact_level_access", "level_id", "levels"],
  ["contact_team_access", "team_id", "teams"],
] as const;

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { service, organizationId } = scope;

  const [contacts, locationLinks, leagueLinks, levelLinks, teams] =
    await Promise.all([
      service
        .from("contacts")
        .select("id,contact_type,first_name,last_name,email,phone,active")
        .eq("organization_id", organizationId)
        .order("last_name"),
      service
        .from("organization_locations")
        .select("location_id,locations(id,name)")
        .eq("organization_id", organizationId)
        .eq("active", true),
      service
        .from("organization_league_coverage")
        .select("league_id,leagues(id,name)")
        .eq("organization_id", organizationId)
        .eq("active", true),
      service
        .from("organization_levels")
        .select("level_id,levels(id,name)")
        .eq("organization_id", organizationId)
        .eq("active", true),
      service
        .from("teams")
        .select("id,name,level_id")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("name"),
    ]);
  const firstError =
    contacts.error ||
    locationLinks.error ||
    leagueLinks.error ||
    levelLinks.error ||
    teams.error;
  if (firstError)
    return NextResponse.json({ error: firstError.message }, { status: 400 });

  const contactIds = (contacts.data || []).map((row) => row.id);
  const access: Record<
    string,
    {
      locations: string[];
      leagues: string[];
      levels: string[];
      teams: string[];
    }
  > = {};
  contactIds.forEach((id) => {
    access[id] = { locations: [], leagues: [], levels: [], teams: [] };
  });
  if (contactIds.length) {
    const results = await Promise.all(
      accessTables.map(([table, column]) =>
        service
          .from(table)
          .select(`contact_id,${column}`)
          .in("contact_id", contactIds),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    results.forEach((result, index) => {
      const [, column, key] = accessTables[index];
      (result.data || []).forEach((row: Record<string, string>) =>
        access[row.contact_id]?.[key].push(row[column]),
      );
    });
  }
  const related = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.flatMap((row) => {
      const value = row[key];
      const item = Array.isArray(value) ? value[0] : value;
      return item && typeof item === "object" ? [item] : [];
    });
  return NextResponse.json({
    contacts: contacts.data || [],
    access,
    locations: related(
      (locationLinks.data || []) as Array<Record<string, unknown>>,
      "locations",
    ),
    leagues: related(
      (leagueLinks.data || []) as Array<Record<string, unknown>>,
      "leagues",
    ),
    levels: related(
      (levelLinks.data || []) as Array<Record<string, unknown>>,
      "levels",
    ),
    teams: teams.data || [],
  });
}

export async function POST(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { service, organizationId } = scope;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  > & { access?: Access };
  const firstName = String(body.first_name || "").trim(),
    lastName = String(body.last_name || "").trim(),
    email = String(body.email || "")
      .trim()
      .toLowerCase();
  if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json(
      { error: "First name, last name, and a valid email are required." },
      { status: 400 },
    );
  const contactType = body.contact_type === "admin" ? "admin" : "coach",
    selected = body.access || {};
  if (
    contactType === "coach" &&
    !accessTables.some(
      ([, , key]) => Array.isArray(selected[key]) && selected[key]!.length,
    )
  )
    return NextResponse.json(
      { error: "A Coach must have at least one Game access selection." },
      { status: 400 },
    );

  const allowed = new Map<string, Set<string>>();
  const [locations, leagues, levels, teams] = await Promise.all([
    service
      .from("organization_locations")
      .select("location_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    service
      .from("organization_league_coverage")
      .select("league_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    service
      .from("organization_levels")
      .select("level_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    service
      .from("teams")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("active", true),
  ]);
  allowed.set(
    "locations",
    new Set((locations.data || []).map((row) => row.location_id)),
  );
  allowed.set(
    "leagues",
    new Set((leagues.data || []).map((row) => row.league_id)),
  );
  allowed.set(
    "levels",
    new Set((levels.data || []).map((row) => row.level_id)),
  );
  allowed.set("teams", new Set((teams.data || []).map((row) => row.id)));
  if (
    accessTables.some(([, , key]) =>
      (selected[key] || []).some((id) => !allowed.get(key)?.has(id)),
    )
  )
    return NextResponse.json(
      {
        error:
          "One or more access selections do not belong to this organization.",
      },
      { status: 400 },
    );

  const payload = {
    organization_id: organizationId,
    contact_type: contactType,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: String(body.phone || "").trim() || null,
    active: body.active !== false,
  };
  let id = typeof body.id === "string" ? body.id : "";
  const saved = id
    ? await service
        .from("contacts")
        .update(payload)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id")
        .single()
    : await service.from("contacts").insert(payload).select("id").single();
  if (saved.error)
    return NextResponse.json({ error: saved.error.message }, { status: 400 });
  id = saved.data.id;
  for (const [table, column, key] of accessTables) {
    const removed = await service.from(table).delete().eq("contact_id", id);
    if (removed.error)
      return NextResponse.json(
        { error: removed.error.message },
        { status: 400 },
      );
    const values = [...new Set(selected[key] || [])];
    if (values.length) {
      const inserted = await service
        .from(table)
        .insert(values.map((value) => ({ contact_id: id, [column]: value })));
      if (inserted.error)
        return NextResponse.json(
          { error: inserted.error.message },
          { status: 400 },
        );
    }
  }
  return NextResponse.json({ id });
}
