export type Coordinates = { latitude: number; longitude: number };

export async function geocodeUSAddress(address: string): Promise<Coordinates> {
  const cleaned = address.trim();
  if (!cleaned || cleaned.length > 300)
    throw new Error("Enter a valid U.S. address.");

  const endpoint = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
  );
  endpoint.searchParams.set("address", cleaned);
  endpoint.searchParams.set("benchmark", "Public_AR_Current");
  endpoint.searchParams.set("format", "json");

  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Address service unavailable.");
  const data = (await response.json()) as {
    result?: {
      addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }>;
    };
  };
  const coordinates = data.result?.addressMatches?.[0]?.coordinates;
  if (coordinates?.x == null || coordinates.y == null)
    throw new Error(`Address not found: ${cleaned}`);
  return {
    latitude: Number(coordinates.y),
    longitude: Number(coordinates.x),
  };
}
