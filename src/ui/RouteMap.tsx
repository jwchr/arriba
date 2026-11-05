// The ride on a street map (owner decision 2026-11-04: self-hosted OpenStreetMap). Everything is served
// from Dale's own site: the North Jersey and Manhattan map file (Protomaps build of OpenStreetMap data,
// ODbL), the fonts (Noto, OFL) and icons (MIT); no tile company sees what the rider looks at.
// Loaded on demand (it is large), and only where stops have coordinates.
import { layers, namedFlavor } from '@protomaps/basemaps';
import { addProtocol, Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// The map draws in a background worker; Vite builds it as its own module file next to the app.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { useEffect, useRef } from 'react';

/** The map file: its name carries the OpenStreetMap build date, so a new build is a new file. */
export const MAP_FILE = 'map/nj-nyc-20261104.pmtiles';
/** What the file covers; the map cannot be panned far outside it. */
const COVERS: [number, number, number, number] = [-74.25, 40.7, -73.9, 41.1];

export interface MapStop { lat: number; lon: number; name: string; state: 'passed' | 'next' | 'alight' | 'ahead' }
interface Props { stops: MapStop[]; bus?: { lat: number; lon: number }; dark: boolean; label: string }

let protocolAdded = false;

export default function RouteMap({ stops, bus, dark, label }: Props) {
  const el = useRef<HTMLElement>(null);
  const map = useRef<MapLibreMap | undefined>(undefined);
  const latest = useRef({ stops, bus });
  latest.current = { stops, bus };

  useEffect(() => {
    if (!el.current) return;
    if (!protocolAdded) { setWorkerUrl(workerUrl); addProtocol('pmtiles', new Protocol().tile); protocolAdded = true; }
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    const flavor = dark ? 'dark' : 'light';
    const lons = stops.map((s) => s.lon), lats = stops.map((s) => s.lat);
    const m = new MapLibreMap({
      container: el.current,
      style: {
        version: 8,
        glyphs: `${base}map/fonts/{fontstack}/{range}.pbf`,
        sprite: `${base}map/sprites/${flavor}`,
        sources: {
          protomaps: {
            type: 'vector', url: `pmtiles://${base}${MAP_FILE}`,
            attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
      },
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      fitBoundsOptions: { padding: 36, maxZoom: 15 },
      maxBounds: [[COVERS[0] - 0.08, COVERS[1] - 0.06], [COVERS[2] + 0.08, COVERS[3] + 0.06]],
      maxZoom: 17,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: routeData(latest.current.stops) });
      m.addSource('stops', { type: 'geojson', data: stopData(latest.current.stops) });
      m.addSource('bus', { type: 'geojson', data: busData(latest.current.bus) });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#000000', 'line-width': 9, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#ffb02e', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({
        id: 'stops', type: 'circle', source: 'stops',
        paint: {
          'circle-radius': ['match', ['get', 'state'], 'alight', 9, 'next', 8, 6],
          'circle-color': ['match', ['get', 'state'], 'passed', '#6b7280', 'next', '#ffb02e', 'alight', '#ff5a4f', '#ffffff'],
          'circle-stroke-color': ['match', ['get', 'state'], 'alight', '#ffffff', '#111111'],
          'circle-stroke-width': 2,
        },
      });
      m.addLayer({
        id: 'stop-names', type: 'symbol', source: 'stops',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': dark ? '#f2f4f7' : '#111827', 'text-halo-color': dark ? '#000000' : '#ffffff', 'text-halo-width': 1.6 },
      });
      m.addLayer({ id: 'bus-glow', type: 'circle', source: 'bus', paint: { 'circle-radius': 16, 'circle-color': '#ffb02e', 'circle-opacity': 0.3, 'circle-blur': 0.6 } });
      m.addLayer({ id: 'bus', type: 'circle', source: 'bus', paint: { 'circle-radius': 7, 'circle-color': '#ffd36e', 'circle-stroke-color': '#111111', 'circle-stroke-width': 3 } });
    });
    map.current = m;
    return () => { m.remove(); map.current = undefined; };
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // New progress moves the dots and the bus without rebuilding the map.
  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;
    (m.getSource('stops') as GeoJSONSource | undefined)?.setData(stopData(stops));
    (m.getSource('bus') as GeoJSONSource | undefined)?.setData(busData(bus));
  }, [stops, bus]);

  // A labelled region, not an image: it holds the zoom buttons and the attribution link.
  return <section className="route-map" ref={el} aria-label={label} />;
}

function routeData(stops: MapStop[]): Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: stops.map((s) => [s.lon, s.lat]) } };
}
function stopData(stops: MapStop[]): FeatureCollection {
  return { type: 'FeatureCollection', features: stops.map((s) => ({ type: 'Feature', properties: { name: s.name, state: s.state }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}
function busData(bus?: { lat: number; lon: number }): FeatureCollection {
  return { type: 'FeatureCollection', features: bus ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [bus.lon, bus.lat] } }] : [] };
}
