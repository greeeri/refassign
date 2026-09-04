export async function coordinatesFor(address: string) {
  const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
  const result = (await response.json()) as {
    latitude?: number;
    longitude?: number;
    error?: string;
  };
  if (!response.ok || result.latitude == null || result.longitude == null)
    throw new Error(result.error || `Could not locate ${address}.`);
  return { latitude: result.latitude, longitude: result.longitude };
}

export async function coordinatesForVenue(address: string, venueName: string) {
  const params = new URLSearchParams({
    address,
    venueName,
    type: "venue",
  });
  const response = await fetch(`/api/geocode?${params.toString()}`);
  const result = (await response.json()) as {
    latitude?: number;
    longitude?: number;
    error?: string;
  };
  if (!response.ok || result.latitude == null || result.longitude == null)
    throw new Error(result.error || `Could not locate ${venueName || address}.`);
  return { latitude: result.latitude, longitude: result.longitude };
}
