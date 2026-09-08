import { NextRequest, NextResponse } from "next/server";
import { geocodeVenue } from "../../../../lib/geocode";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

type AddressRow = {
  id: string;
  name?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const addressText = (row: AddressRow) =>
  [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ");

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const { service, organizationId } = context;
  const [locationLinks, officialLinks] = await Promise.all([
    service
      .from("organization_locations")
      .select("location_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    service
      .from("organization_officials")
      .select("official_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
  ]);
  const linkError = locationLinks.error || officialLinks.error;
  if (linkError)
    return NextResponse.json({ error: linkError.message }, { status: 400 });
  const locationIds = (locationLinks.data || []).map((row) => row.location_id);
  const officialIds = (officialLinks.data || []).map((row) => row.official_id);
  const [locationsResult, officialsResult, originsResult] = await Promise.all([
    locationIds.length ? service
      .from("locations")
      .select("id,name,address,city,state")
      .in("id", locationIds)
      .or("latitude.is.null,longitude.is.null")
      .limit(100) : Promise.resolve({ data: [], error: null }),
    officialIds.length ? service
      .from("officials")
      .select(
        "id,address:home_address,city:home_city,state:home_state,zip:home_zip",
      )
      .in("id", officialIds)
      .not("home_address", "is", null)
      .or("home_latitude.is.null,home_longitude.is.null")
      .limit(100) : Promise.resolve({ data: [], error: null }),
    officialIds.length ? service
      .from("official_weekday_origins")
      .select(
        "id:official_id,weekday,address:alternate_address,city:alternate_city,state:alternate_state,zip:alternate_zip",
      )
      .in("official_id", officialIds)
      .eq("use_home", false)
      .not("alternate_address", "is", null)
      .or("alternate_latitude.is.null,alternate_longitude.is.null")
      .limit(100) : Promise.resolve({ data: [], error: null }),
  ]);

  const queryError =
    locationsResult.error || officialsResult.error || originsResult.error;
  if (queryError)
    return NextResponse.json({ error: queryError.message }, { status: 400 });

  let updated = 0;
  const failures: string[] = [];

  const locationTasks = ((locationsResult.data || []) as unknown as AddressRow[])
    .filter((row) => {
      const address = addressText(row).trim();
      const name = row.name?.trim() || "";
      return Boolean(
        (address && !/^tbd(?:,\s*tbd)*$/i.test(address)) ||
          (name && !/^tbd$/i.test(name)),
      );
    })
    .map(async (row) => {
      try {
        const point = await geocodeVenue(addressText(row), row.name || undefined);
        const { error } = await service
          .from("locations")
          .update(point)
          .eq("id", row.id);
        if (error) throw error;
        updated++;
      } catch (error) {
        failures.push(
          error instanceof Error
            ? error.message
            : `Venue could not be located: ${row.name || addressText(row)}`,
        );
      }
    });

  const officialTasks = (
    (officialsResult.data || []) as unknown as AddressRow[]
  ).map(async (row) => {
    try {
      const point = await geocodeVenue(addressText(row));
      const { error } = await service
        .from("officials")
        .update({
          home_latitude: point.latitude,
          home_longitude: point.longitude,
        })
        .eq("id", row.id);
      if (error) throw error;
      updated++;
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : "Official address could not be located.",
      );
    }
  });

  const originTasks = (
    (originsResult.data || []) as unknown as Array<
      AddressRow & { weekday: number }
    >
  ).map(async (row) => {
    try {
      const point = await geocodeVenue(addressText(row));
      const { error } = await service
        .from("official_weekday_origins")
        .update({
          alternate_latitude: point.latitude,
          alternate_longitude: point.longitude,
        })
        .eq("official_id", row.id)
        .eq("weekday", row.weekday);
      if (error) throw error;
      updated++;
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : "Alternate address could not be located.",
      );
    }
  });

  await Promise.all([...locationTasks, ...officialTasks, ...originTasks]);

  return NextResponse.json({
    updated,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
}
