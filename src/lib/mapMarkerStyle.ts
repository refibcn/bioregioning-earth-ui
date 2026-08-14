// Shared glowing-LED marker + case-study "scope circle" logic for the map, used by both
// EarthMap.astro's and HomeEarthMap.astro's client-side <script> blocks. Centralized here (like
// .field-control/.filter-dropdown/.detail-side-panel in Layout.astro's global styles this
// session) so the two map components can't drift into two different marker designs the way
// other shared UI in this codebase already has.
//
// Client-safe only — no Astro/Node-only imports (import.meta.env, fs, etc.).

export interface MapMarkerLike {
  id: string;
  lat: number;
  lng: number;
  caseStudy: string | null;
  scopeRadiusKm?: number;
}

const STANDARD_COLOR_VAR = '--map-marker-standard';
const CASE_STUDY_COLOR_VAR = '--map-marker-case-study';

// Both marker categories are one uniform color each — standard (blue) and case-study (lime).
export function colorVarForMarker(m: MapMarkerLike): string {
  return m.caseStudy === 'Y' ? CASE_STUDY_COLOR_VAR : STANDARD_COLOR_VAR;
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

export function buildScopeCirclesGeoJSON(markers: MapMarkerLike[]) {
  const color = getComputedStyle(document.documentElement).getPropertyValue(CASE_STUDY_COLOR_VAR).trim() || '#8FE84A';
  return {
    type: 'FeatureCollection' as const,
    features: markers
      .filter((m) => m.caseStudy === 'Y')
      .map((m) => {
        const radiusKm = m.scopeRadiusKm ?? 10;
        const r0 = radiusPxAtZ0(radiusKm, m.lat);
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
export function addScopeCirclesLayer(map: any, markers: MapMarkerLike[]) {
  const data = buildScopeCirclesGeoJSON(markers);
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
