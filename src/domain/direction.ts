import type { Dataset, Stop } from './types';

/** Great-circle distance in meters. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Does any pattern serve `from` and later `to`? */
export function reaches(ds: Dataset, fromStopId: string, toStopId: string, routeIds?: string[]): boolean {
  return ds.patterns.some((p) => {
    if (routeIds && routeIds.length && !routeIds.includes(p.routeId)) return false;
    const i = p.stopIds.indexOf(fromStopId);
    const j = p.stopIds.indexOf(toStopId);
    return i >= 0 && j > i;
  });
}

export type DirectionCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong-side'; useStop: Stop; distanceM: number }
  | { ok: false; reason: 'not-served' };

/**
 * Wrong-direction guard. If buses at `stopId` never reach `toStopId`, look for a nearby stop
 * (normally across the street) whose buses do, so the rider is sent to the right side.
 */
export function checkDirection(
  ds: Dataset,
  stopId: string,
  toStopId: string,
  routeIds?: string[],
  radiusM = 250,
): DirectionCheck {
  if (reaches(ds, stopId, toStopId, routeIds)) return { ok: true };
  const here = ds.stops.find((s) => s.id === stopId);
  if (!here) return { ok: false, reason: 'not-served' };
  const candidates = ds.stops
    .filter((s) => s.id !== stopId)
    .map((s) => ({ s, d: distanceM(here, s) }))
    .filter(({ s, d }) => d <= radiusM && reaches(ds, s.id, toStopId, routeIds))
    .sort((a, b) => a.d - b.d);
  const best = candidates[0];
  return best ? { ok: false, reason: 'wrong-side', useStop: best.s, distanceM: Math.round(best.d) } : { ok: false, reason: 'not-served' };
}

/**
 * For a trip from `fromStopId` toward `toStopId`, the stop to get off at: `toStopId` itself if buses
 * reach it, else the nearest stop within `radiusM` of it that they do reach (the return-side twin of a
 * home stop across the street). Undefined if neither.
 */
export function alightingStopFor(ds: Dataset, fromStopId: string, toStopId: string, routeIds?: string[], radiusM = 250): Stop | undefined {
  const target = ds.stops.find((s) => s.id === toStopId);
  if (!target) return undefined;
  if (reaches(ds, fromStopId, toStopId, routeIds)) return target;
  return ds.stops
    .filter((s) => s.id !== toStopId && reaches(ds, fromStopId, s.id, routeIds))
    .map((s) => ({ s, d: distanceM(target, s) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d)[0]?.s;
}

/** Case- and accent-insensitive stop search by name or exact stop code. */
export function searchStops(ds: Dataset, query: string, limit = 20): Stop[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  return ds.stops
    .filter((s) => s.code === query.trim() || words.every((w) => norm(s.name).includes(w)))
    .sort((a, b) => Number(b.code === query.trim()) - Number(a.code === query.trim()) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
