import { NextResponse } from "next/server";
import { geocodeUSAddress } from "../../../../lib/geocode";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

type AddressRow = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const addressText = (row: AddressRow) =>
  [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ");

export async function POST() {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: canManage } = await session.rpc("can_manage_game_setup");
  if (!canManage)
    return NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 });

  const service = createServiceClient();
  const [locationsResult, officialsResult, originsResult] = await Promise.all([
    service.from("locations")
      .select("id,address,city,state")
      .not("address", "is", null)
      .or("latitude.is.null,longitude.is.null")
      .limit(100),
    service.from("officials")
      .select("id,address:home_address,city:home_city,state:home_state,zip:home_zip")
      .not("home_address", "is", null)
      .or("home_latitude.is.null,home_longitude.is.null")
      .limit(100),
    service.from("official_weekday_origins")
      .select("id:official_id,weekday,address:alternate_address,city:alternate_city,state:alternate_state,zip:alternate_zip")
      .eq("use_home", false)
      .not("alternate_address", "is", null)
      .or("alternate_latitude.is.null,alternate_longitude.is.null")
      .limit(100),
  ]);
  const queryError = locationsResult.error || officialsResult.error || originsResult.error;
  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 400 });

  let updated = 0;
  const failures: string[] = [];
  const tasks = [
    ...((locationsResult.data || []) as unknown as AddressRow[]).map(async (row) => {
      try {
        const point = await geocodeUSAddress(addressText(row));
        const { error } = await service.from("locations").update(point).eq("id", row.id);
        if (error) throw error;
        updated++;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Venue address could not be located.");
      }
    }),
    ...((officialsResult.data || []) as unknown as AddressRow[]).map(async (row) => {
      try {
        const point = await geocodeUSAddress(addressText(row));
        const { error } = await service.from("officials").update({
          home_latitude: point.latitude,
          home_longitude: point.longitude,
        }).eq("id", row.id);
        if (error) throw error;
        updated++;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Official address could not be located.");
      }
    }),
    ...((originsResult.data || []) as unknown as Array<AddressRow & { weekday: number }>).map(async (row) => {
      try {
        const point = await geocodeUSAddress(addressText(row));
        const { error } = await service.from("official_weekday_origins").update({
          alternate_latitude: point.latitude,
          alternate_longitude: point.longitude,
        }).eq("official_id", row.id).eq("weekday", row.weekday);
        if (error) throw error;
        updated++;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Alternate address could not be located.");
      }
    }),
  ];
  await Promise.all(tasks);
  return NextResponse.json({ updated, failed: failures.length, failures: failures.slice(0, 10) });
}
