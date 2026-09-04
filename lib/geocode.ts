export type Coordinates = { latitude: number; longitude: number };

let venueQueue: Promise<void> = Promise.resolve();
let lastVenueRequest = 0;

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

async function geocodeOpenStreetMap(query: string): Promise<Coordinates> {
  let release!: () => void;
  const previous = venueQueue;
  venueQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const wait = Math.max(0, 1100 - (Date.now() - lastVenueRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastVenueRequest = Date.now();

    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("countrycodes", "us");
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        "User-Agent": "RefAssign/1.0 (https://refassign-chi.vercel.app)",
        Referer: "https://refassign-chi.vercel.app/",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Venue address service unavailable.");
    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const latitude = Number(data[0]?.lat);
    const longitude = Number(data[0]?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      throw new Error(`Venue not found: ${query}`);
    return { latitude, longitude };
  } finally {
    release();
  }
}

export async function geocodeVenue(
  address: string,
  venueName?: string,
): Promise<Coordinates> {
  const cleanedAddress = address.trim();
  const cleanedName = venueName?.trim() || "";
  if (
    (!cleanedAddress && !cleanedName) ||
    /^tbd$/i.test(cleanedAddress) ||
    /^tbd$/i.test(cleanedName)
  )
    throw new Error("Enter a valid venue name or U.S. address.");

  if (cleanedAddress) {
    try {
      return await geocodeUSAddress(cleanedAddress);
    } catch {
      return geocodeOpenStreetMap(cleanedAddress);
    }
  }
  return geocodeOpenStreetMap(`${cleanedName}, United States`);
}
