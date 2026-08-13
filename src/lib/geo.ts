// Shared coordinate-resolution helper — previously duplicated verbatim in
// src/pages/[section]/index.astro, src/components/EarthMap.astro, and
// src/components/HomeEarthMap.astro. Any org/record without a resolvable lat/lng here gets
// silently dropped from every map view (see Work Item A: the "missing orgs on map" bug was
// actually this, not a Notion export issue).
export interface Coords {
  lat: number;
  lng: number;
}

export function getCoords(props: Record<string, any>): Coords | null {
  // 1. Try Notion "location" / "place" type property (uses lat/lon)
  for (const key of Object.keys(props)) {
    const val = props[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const lat = val.latitude != null ? Number(val.latitude) : val.lat != null ? Number(val.lat) : null;
      const lng = val.longitude != null ? Number(val.longitude) : val.lon != null ? Number(val.lon) : null;
      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  }
  // 2. Fall back to raw number properties
  const lat = Number(
    props['Lat'] ?? props['lat'] ?? props['Latitude'] ?? props['latitude'] ??
    props['location_lat'] ?? props['location_Lat'] ?? props['Location_Lat']
  );
  const lng = Number(
    props['Lng'] ?? props['lng'] ?? props['Longitude'] ?? props['longitude'] ??
    props['location_lng'] ?? props['location_Lng'] ?? props['Location_Lng']
  );
  if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) return { lat, lng };
  return null;
}

export function hasCoords(props: Record<string, any>): boolean {
  return getCoords(props) !== null;
}

// Case-study "scope circle" radius on the map — no structured location-shape data exists in
// Notion (only free text), so this is a manually-set optional override, falling back to one
// flat default for every case-study org until dialed in per-org. Add a Number property named
// "Scope Radius (km)" to the Organizations database in Notion to override a specific org.
export const DEFAULT_SCOPE_RADIUS_KM = 10; // placeholder starting point — tune once real orgs are visible

export function getScopeRadiusKm(props: Record<string, any>): number {
  const raw = props['Scope Radius (km)'] ?? props['Scope Radius'];
  const n = Number(raw);
  return raw != null && !isNaN(n) && n > 0 ? n : DEFAULT_SCOPE_RADIUS_KM;
}

// Given a list of records, return which ones resolved a coordinate and which didn't — used to
// surface the "N organizations not shown (missing coordinates)" diagnostic (Work Item A) instead
// of silently filtering them out.
export function splitByCoords<T extends { properties: Record<string, any> }>(
  records: T[]
): { withCoords: Array<T & { coords: Coords }>; missing: T[] } {
  const withCoords: Array<T & { coords: Coords }> = [];
  const missing: T[] = [];
  for (const r of records) {
    const coords = getCoords(r.properties);
    if (coords) {
      withCoords.push({ ...r, coords });
    } else {
      missing.push(r);
    }
  }
  return { withCoords, missing };
}
