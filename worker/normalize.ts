import bindings from 'gtfs-realtime-bindings';
import { isServiceActive } from '../src/domain/schedule';
import { validServiceDate, validVehicleId, LIVE_MAX_AGE_MS, type LiveFeed, type LivePrediction } from '../src/domain/liveBus';
import { tripInstanceId, type Dataset, type Pattern } from '../src/domain/types';
import type { VehicleObservation } from '../src/domain/lock';
type Descriptor = bindings.transit_realtime.ITripDescriptor;
export interface NormalizedUpdate { tripInstanceId: string; observedAt: number; cancelled: boolean; predictions: LivePrediction[]; skippedStops: number[] }
export interface FeedDiagnostics { entities: number; knownTrips: number; corridorRoutes: number; missingServiceDates: number; missingObservationTimes: number }
export interface NormalizedFeed { diagnostics?: FeedDiagnostics; feed: LiveFeed; observations: VehicleObservation[]; updates: NormalizedUpdate[] }
const seconds = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n * 1000 : undefined; };

export function createNormalizer(ds: Dataset) {
  const trips = new Map(ds.trips.map((t) => [t.id, t])), patterns = new Map(ds.patterns.map((p) => [p.id, p]));
  const routes = new Map(ds.routes.map((r) => [r.id, r]));
  function identify(d: Descriptor | null | undefined): { id: string; pattern: Pattern } | undefined {
    if (!d?.tripId || !d.startDate || !validServiceDate(d.startDate)) return;
    const trip = trips.get(d.tripId), pattern = trip && patterns.get(trip.patternId), route = pattern && routes.get(pattern.routeId);
    if (!trip || !pattern || !route || !isServiceActive(ds.calendars[trip.serviceId], d.startDate)) return;
    if (d.routeId && d.routeId !== (route.feedRouteId ?? route.id)) return;
    if (d.directionId != null && Object.hasOwn(d, 'directionId') && d.directionId !== pattern.directionId) return;
    // Missing service dates, added/duplicated/unscheduled trips and mismatched variants are unknown, not guessed.
    return { id: tripInstanceId(trip.id, d.startDate), pattern };
  }
  return function normalize(bytes: Uint8Array, kind: 'vehicles' | 'updates', now: number): NormalizedFeed {
    const empty: NormalizedFeed = { feed: { state: 'invalid' }, observations: [], updates: [] };
    try {
      const data = bindings.transit_realtime.FeedMessage.decode(bytes), at = seconds(data.header.timestamp);
      if (!at || at > now || data.header.incrementality === 1) return empty;
      const diagnostics: FeedDiagnostics = { entities: data.entity.length, knownTrips: 0, corridorRoutes: 0, missingServiceDates: 0, missingObservationTimes: 0 };
      const feedRoutes = new Set(ds.routes.map((r) => r.feedRouteId ?? r.id));
      const output: NormalizedFeed = { diagnostics, feed: { state: now - at > LIVE_MAX_AGE_MS ? 'stale' : 'ok', timestamp: at }, observations: [], updates: [] };
      for (const entity of data.entity) {
        if (entity.isDeleted) continue;
        const report = kind === 'vehicles' ? entity.vehicle : entity.tripUpdate;
        if (report?.trip) {
          if (feedRoutes.has(report.trip.routeId ?? '')) diagnostics.corridorRoutes++;
          if (trips.has(report.trip.tripId ?? '')) {
            diagnostics.knownTrips++;
            if (!report.trip.startDate) diagnostics.missingServiceDates++;
            if (!seconds(report.timestamp)) diagnostics.missingObservationTimes++;
          }
        }
        if (kind === 'vehicles' && entity.vehicle) {
          const vehicle = entity.vehicle, match = identify(vehicle.trip), observedAt = seconds(vehicle.timestamp), pos = vehicle.position;
          if (!match || !observedAt || observedAt > now || !validVehicleId(vehicle.vehicle?.id) || !pos
            || !Object.hasOwn(pos, 'latitude') || !Object.hasOwn(pos, 'longitude') || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)
            || Math.abs(pos.latitude) > 90 || Math.abs(pos.longitude) > 180 || (vehicle.trip?.scheduleRelationship ?? 0) !== 0) continue;
          output.observations.push({ tripInstanceId: match.id, vehicleId: vehicle.vehicle.id, observedAt, lat: pos.latitude, lon: pos.longitude });
        }
        if (kind === 'updates' && entity.tripUpdate) {
          const update = entity.tripUpdate, match = identify(update.trip), observedAt = seconds(update.timestamp);
          if (!match || !observedAt || observedAt > now || ![0, 3].includes(update.trip.scheduleRelationship ?? 0)) continue;
          const normalized: NormalizedUpdate = { tripInstanceId: match.id, observedAt, cancelled: update.trip.scheduleRelationship === 3, predictions: [], skippedStops: [] };
          for (const stop of update.stopTimeUpdate ?? []) {
            const candidates = match.pattern.stopIds.flatMap((id, i) => (!stop.stopId || stop.stopId === id)
              && (!Object.hasOwn(stop, 'stopSequence') || stop.stopSequence === match.pattern.stopSequences?.[i]) ? [i] : []);
            if (candidates.length !== 1) continue;
            const stopIndex = candidates[0]!;
            if (stop.scheduleRelationship === 1) { normalized.skippedStops.push(stopIndex); continue; }
            if (stop.scheduleRelationship === 2 || normalized.cancelled) continue;
            for (const key of ['arrival', 'departure'] as const) {
              const prediction = stop[key], time = prediction && seconds(prediction.time);
              if (time) normalized.predictions.push({ stopIndex, at: time, observedAt, kind: key });
            }
          }
          output.updates.push(normalized);
        }
      }
      return new TextEncoder().encode(JSON.stringify(output)).byteLength <= 700_000 ? output : empty;
    } catch { return empty; }
  };
}
