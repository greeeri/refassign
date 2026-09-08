import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const testUrl = "https://slenztuopbfxqzjyrtzp.supabase.co";
const testKey = "sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ";

type Workspace = { organization_id: string };
type NominatimPlace = {
  place_id: number;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  address?: {
    amenity?: string;
    building?: string;
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    postcode?: string;
  };
};

export async function GET(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const organizationId = request.nextUrl.searchParams.get("organization") || "";
  if (!token)
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401 },
    );
  if (query.length < 2 || query.length > 150)
    return NextResponse.json(
      { error: "Enter at least two characters." },
      { status: 400 },
    );

  const supabase = createClient(testUrl, testKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData }, { data: workspaces, error: workspaceError }] =
    await Promise.all([
      supabase.auth.getUser(token),
      supabase.rpc("get_my_test_workspaces"),
    ]);
  if (
    !userData.user ||
    workspaceError ||
    !(workspaces as Workspace[] | null)?.some(
      (item) => item.organization_id === organizationId,
    )
  )
    return NextResponse.json(
      { error: "You do not have access to this organization." },
      { status: 403 },
    );

  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("namedetails", "1");
  endpoint.searchParams.set("countrycodes", "us");
  endpoint.searchParams.set("limit", "12");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      "User-Agent": "RefAssign/1.0 (+https://ref-assign.com)",
      Referer: "https://test.ref-assign.com/",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    return NextResponse.json(
      { error: "The location service is temporarily unavailable." },
      { status: 503 },
    );
  const places = (await response.json()) as NominatimPlace[];
  return NextResponse.json({
    results: places.map((place) => {
      const address = place.address || {};
      const city =
        address.city ||
        address.town ||
        address.village ||
        address.municipality ||
        "";
      const name =
        place.name ||
        address.amenity ||
        address.building ||
        place.display_name.split(",")[0];
      const street = [address.house_number, address.road]
        .filter(Boolean)
        .join(" ");
      return {
        id: `osm-${place.place_id}`,
        name,
        address: street || null,
        city: city || null,
        state: address.state || null,
        postal_code: address.postcode || null,
        latitude: Number(place.lat),
        longitude: Number(place.lon),
        already_connected: false,
        source: "OpenStreetMap",
      };
    }),
  });
}
