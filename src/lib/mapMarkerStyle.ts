// Shared glowing-LED marker + case-study "scope circle" logic for the map, used by both
// EarthMap.astro's and HomeEarthMap.astro's client-side <script> blocks. Centralized here (like
// .field-control/.filter-dropdown/.detail-side-panel in Layout.astro's global styles this
// session) so the two map components can't silently re-diverge into two different marker designs
// the way other shared UI in this codebase already has.
//
// Client-safe only — no Astro/Node-only imports (import.meta.env, fs, etc.) — this module also
// gets pulled into scripts/generate-thumbnails.ts's build-time context indirectly via geo.ts, so
// it needs to stay portable.

export interface MapMarkerLike {
  id: string;
  lat: number;
  lng: number;
  caseStudy: string | null;
  scopeRadiusKm?: number;
}

// One per hue family in Layout.astro's full 10-family Color Library, minus blue (reserved for
// the standard-marker color) and gray (too desaturated to read as a glow) — see Layout.astro's
// --map-marker-case-study-* comment for the full reasoning.
const CASE_STUDY_COLOR_VARS = [
  '--map-marker-case-study-1',
  '--map-marker-case-study-2',
  '--map-marker-case-study-3',
  '--map-marker-case-study-4',
  '--map-marker-case-study-5',
  '--map-marker-case-study-6',
  '--map-marker-case-study-7',
  '--map-marker-case-study-8',
] as const;

const STANDARD_COLOR_VAR = '--map-marker-default';

// "Close together" at a country/region-level zoom — a starting point, adjust by eye once real
// org clustering is visible on the live map.
const NEARBY_THRESHOLD_KM = 300;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius, km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Greedy color assignment: process case-study markers in a fixed, deterministic order (by id,
// so the assignment doesn't reshuffle between rebuilds/reloads for the same data), and for each
// one pick whichever palette color has the fewest already-assigned *nearby* conflicts (0 if
// possible). Not a perfect graph-coloring solver, but bounded and good enough for "avoid
// same-color collisions among pins that are actually close together" — with only 4 case-study
// colors, a cluster of 5+ mutually-close case-study orgs will necessarily reuse one; this picks
// the least-conflicting reuse rather than a fixed round-robin that could land on the worst case.
export function assignCaseStudyColors(markers: MapMarkerLike[]): Map<string, string> {
  const caseStudyMarkers = markers
    .filter((m) => m.caseStudy === 'Y')
    .sort((a, b) => a.id.localeCompare(b.id));

  const colorVarById = new Map<string, string>();

  for (const m of caseStudyMarkers) {
    const conflictCounts = CASE_STUDY_COLOR_VARS.map(() => 0);
    for (const other of caseStudyMarkers) {
      if (other.id === m.id) continue;
      const otherVar = colorVarById.get(other.id);
      if (!otherVar) continue;
      if (haversineKm(m.lat, m.lng, other.lat, other.lng) < NEARBY_THRESHOLD_KM) {
        const idx = CASE_STUDY_COLOR_VARS.indexOf(otherVar as (typeof CASE_STUDY_COLOR_VARS)[number]);
        if (idx >= 0) conflictCounts[idx]++;
      }
    }
    const bestIdx = conflictCounts.indexOf(Math.min(...conflictCounts));
    colorVarById.set(m.id, CASE_STUDY_COLOR_VARS[bestIdx]);
  }

  return colorVarById;
}

// Resolves which CSS var a given marker should use — case-study orgs get their assigned color,
// everything else gets the one shared standard color.
export function colorVarForMarker(m: MapMarkerLike, colorVarById: Map<string, string>): string {
  if (m.caseStudy === 'Y') return colorVarById.get(m.id) ?? CASE_STUDY_COLOR_VARS[0];
  return STANDARD_COLOR_VAR;
}

export function createLedMarkerElement(colorVar: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'map-led-marker';
  el.style.setProperty('--marker-color', `var(${colorVar})`);
  return el;
}

// circle-radius in a MapLibre `circle` layer is screen-pixels, not real-world meters. The
// standard Web-Mercator formula metersPerPixel(lat, zoom) = 156543.03392 * cos(lat*PI/180) / 2^zoom
// means pixel-radius-at-zoom is exactly C * 2^zoom (C depends only on lat + the real-world
// radius) — MapLibre's ["interpolate", ["exponential", 2], ["zoom"], z0, v0, z1, v1] reconstructs
// that curve exactly between any two stops on it, so precomputing just zoom 0 and zoom 22
// (MapLibre's max) per org is sufficient; no need for a dense stop list.
function radiusPxAtZ0(radiusKm: number, lat: number): number {
  return (radiusKm * 1000) / (156543.03392 * Math.cos((lat * Math.PI) / 180));
}

export function buildScopeCirclesGeoJSON(markers: MapMarkerLike[], colorVarById: Map<string, string>) {
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    type: 'FeatureCollection' as const,
    features: markers
      .filter((m) => m.caseStudy === 'Y')
      .map((m) => {
        const radiusKm = m.scopeRadiusKm ?? 10;
        const r0 = radiusPxAtZ0(radiusKm, m.lat);
        const colorVar = colorVarById.get(m.id) ?? CASE_STUDY_COLOR_VARS[0];
        // MapLibre paint values can't consume var(--x) references directly — resolve to an
        // actual color string once here, from the exact same token the marker's own glow uses,
        // so the two never fall out of sync.
        const color = rootStyle.getPropertyValue(colorVar).trim() || '#F0A030';
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
          properties: {
            radiusPxAtZ0: r0,
            radiusPxAtZ22: r0 * 2 ** 22,
            color,
          },
        };
      }),
  };
}

// Adds (or replaces) the scope-circles source/layer on an already-loaded map. Safe to call
// multiple times (e.g. on data refresh) — removes any prior instance first.
export function addScopeCirclesLayer(map: any, markers: MapMarkerLike[], colorVarById: Map<string, string>) {
  const data = buildScopeCirclesGeoJSON(markers, colorVarById);
  if (data.features.length === 0) return;

  if (map.getLayer('scope-circles')) map.removeLayer('scope-circles');
  if (map.getSource('scope-circles')) map.removeSource('scope-circles');

  map.addSource('scope-circles', { type: 'geojson', data });
  map.addLayer({
    id: 'scope-circles',
    type: 'circle',
    source: 'scope-circles',
    paint: {
      'circle-radius': [
        'interpolate', ['exponential', 2], ['zoom'],
        0, ['get', 'radiusPxAtZ0'],
        22, ['get', 'radiusPxAtZ22'],
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.16,
      // Fade at the edges, no stroke/line layer ever added — this is the entire "no border"
      // mechanism, in one paint property.
      'circle-blur': 0.85,
    },
  });
}
