/**
 * A trip's suggested miles and drive time: home, through the stops, and home
 * again, on real roads. Free services, called only when Lukas presses
 * "Estimate" (a handful a day, well inside their usage policies):
 * OpenStreetMap's Nominatim to find each stop, and the public OSRM router for
 * the drive. The result fills the form; it's never saved without him seeing it.
 */

const USER_AGENT = "LeadFinder/1.0 (Hahn Media mileage log)";

export interface RouteEstimate {
  miles: number;
  driveMinutes: number;
  /** Stops the map didn't know by street address, routed to their town instead. */
  approximate: string[];
}

/** [lon, lat] of a place, or null when OpenStreetMap doesn't know it. Also used by src/lib/airspace.ts. */
export async function geocode(place: string): Promise<[number, number] | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", place);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const [hit] = (await res.json()) as { lat: string; lon: string }[];
  return hit ? [Number(hit.lon), Number(hit.lat)] : null;
}

export async function estimateRoute(home: string, stops: string[]): Promise<RouteEstimate | { error: string }> {
  const points: [number, number][] = [];
  const approximate: string[] = [];
  // Nominatim asks for at most one request a second.
  const pause = () => new Promise((r) => setTimeout(r, 1100));
  for (const place of [home, ...stops]) {
    if (points.length > 0) await pause();
    let point = await geocode(place);
    // A street OpenStreetMap doesn't have: route to the town instead.
    const town = place.includes(",") ? place.slice(place.indexOf(",") + 1).trim() : null;
    if (!point && town) {
      await pause();
      point = await geocode(town);
      if (point) approximate.push(place);
    }
    if (!point) return { error: `Couldn't find "${place}" on the map. Try a simpler address or just the town.` };
    points.push(point);
  }
  points.push(points[0]);

  const coords = points.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return { error: "The route service didn't answer. Enter the miles by hand." };
  const data = (await res.json()) as { routes?: { distance: number; duration: number }[] };
  const route = data.routes?.[0];
  if (!route) return { error: "No driving route found between those stops." };
  return { miles: Math.round((route.distance / 1609.344) * 10) / 10, driveMinutes: Math.round(route.duration / 60), approximate };
}
