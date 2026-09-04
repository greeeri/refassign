export type Coordinates = { latitude: number; longitude: number };

let venueQueue: Promise<void> = Promise.resolve();
let lastVenueRequest = 0;

async function geocodeGoogle(query: string): Promise<Coordinates> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) throw new Error("Google Maps geocoding is not configured.");

  const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  endpoint.searchParams.set("address", query.trim());
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Google Maps address service unavailable.");

  const data = (await response.json()) as {
    status?: string;
    error_message?: string;
    results?: Array<{
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  const point = data.results?.[0]?.geometry?.location;
  if (data.status !== "OK" || point?.lat == null || point.lng == null)
    throw new Error(
      data.error_message || `Google Maps could not locate: ${query.trim()}`,
    );
  return { latitude: Number(point.lat), longitude: Number(point.lng) };
}

export async function geocodeUSAddress(address: string): Promise<Coordinates> {
  const cleaned = address.trim();
  if (!cleaned || cleaned.length > 300)
    throw new Error("Enter a valid U.S. address.");

  if (process.env.GOOGLE_MAPS_API_KEY?.trim()) {
    try {
      return await geocodeGoogle(cleaned);
    } catch {
      // Continue to the free Census lookup when Google has no match or is unavailable.
    }
  }

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

  const query = cleanedAddress || `${cleanedName}, United States`;
  if (process.env.GOOGLE_MAPS_API_KEY?.trim()) {
    try {
      return await geocodeGoogle(query);
    } catch {
      // Fall through to the existing free providers.
    }
  }

  if (cleanedAddress) {
    try {
      return await geocodeUSAddress(cleanedAddress);
    } catch {
      if (cleanedName) {
        try {
          return await geocodeOpenStreetMap(
            `${cleanedName}, ${cleanedAddress}, United States`,
          );
        } catch {
          return geocodeOpenStreetMap(`${cleanedName}, United States`);
        }
      }
      return geocodeOpenStreetMap(cleanedAddress);
    }
  }
  return geocodeOpenStreetMap(`${cleanedName}, United States`);
}
