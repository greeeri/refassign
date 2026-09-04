import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { geocodeUSAddress, geocodeVenue } from "../../../lib/geocode";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const address = request.nextUrl.searchParams.get("address")?.trim();
  const venueName = (
    request.nextUrl.searchParams.get("venueName") ||
    request.nextUrl.searchParams.get("name")
  )?.trim();
  const isVenue =
    request.nextUrl.searchParams.get("type") === "venue" || Boolean(venueName);

  if (
    (!isVenue && !address) ||
    (isVenue && !address && !venueName) ||
    (address?.length || 0) > 300 ||
    (venueName?.length || 0) > 300
  )
    return NextResponse.json(
      { error: "Enter a valid U.S. address or venue name." },
      { status: 400 },
    );

  try {
    return NextResponse.json(
      isVenue
        ? await geocodeVenue(address || "", venueName)
        : await geocodeUSAddress(address || ""),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The address could not be located right now.",
      },
      { status: 422 },
    );
  }
}
