// Missed-stop and wrong-bus recovery (issue #60): the rider says what went wrong and where they are
// now; Dale lists scheduled ways back to the stop they meant to get off at. Manual only: without
// live data Dale cannot detect a missed stop or see where the rider is, and it never changes the lock.
import { rescueOptions, type RescueResult } from './rescue';
import type { Dataset, Departure } from './types';

export type RecoveryKind = 'missed' | 'passed' | 'wrong_bus';

/**
 * Stops the rider may be at now. Missed or passed: the stops of this trip after theirs. Wrong bus:
 * every stop the route serves in either direction except the destination, by name, since the bus
 * they are on may not be the trip Dale has.
 */
export function recoveryStops(ds: Dataset, dep: Departure, alightIndex: number, kind: RecoveryKind): string[] {
  const dest = dep.pattern.stopIds[alightIndex];
  if (kind !== 'wrong_bus') return [...new Set(dep.pattern.stopIds.slice(alightIndex + 1))];
  const ids = new Set(ds.patterns.filter((p) => p.routeId === dep.route.id).flatMap((p) => p.stopIds));
  ids.delete(dest ?? '');
  const name = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  return [...ids].sort((a, b) => name(a).localeCompare(name(b)));
}

/** Scheduled ways from where the rider is (or across the street) back to their own stop (or across from it). */
export function recoveryOptions(ds: Dataset, atStopId: string, destStopId: string, now: number): RescueResult {
  return rescueOptions(ds, atStopId, destStopId, now, undefined, 6);
}
