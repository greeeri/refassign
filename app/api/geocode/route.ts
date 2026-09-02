import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || address.length > 300)
    return NextResponse.json(
      { error: "Enter a valid U.S. address." },
      { status: 400 },
    );
  const endpoint = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
  );
  endpoint.searchParams.set("address", address);
  endpoint.searchParams.set("benchmark", "Public_AR_Current");
  endpoint.searchParams.set("format", "json");
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Address service unavailable");
    const data = (await response.json()) as {
      result?: {
        addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }>;
      };
    };
    const coordinates = data.result?.addressMatches?.[0]?.coordinates;
    if (coordinates?.x == null || coordinates.y == null)
      return NextResponse.json(
        { error: `Address not found: ${address}` },
        { status: 404 },
      );
    return NextResponse.json({
      latitude: Number(coordinates.y),
      longitude: Number(coordinates.x),
    });
  } catch {
    return NextResponse.json(
      { error: "The address could not be located right now." },
      { status: 502 },
    );
  }
}
