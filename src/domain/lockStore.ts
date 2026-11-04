// Bus Lock on this phone across a refresh or a closed app (issue #53). The saved lock keeps its
// original timestamps, so a report from 8:10 still reads 8:10 after reopening, and GPS ages honestly.
// A saved lock is only offered back (never resumed silently) and only while it still matches the
// loaded schedule, its trip, and its day. The invented demo is never saved.
import type { BusSession } from './busLock';
import type { Dataset, Departure } from './types';

export const LOCK_KEY = 'arriba.lock.v1';
/** A lock is offered back until this long after its trip's scheduled end. */
export const RESUME_AFTER_END_MS = 2 * 3600_000;

export interface SavedLock<L> {
  v: 1;
  feedVersion: string;
  savedAt: number;
  dep: Departure;
  leg: L;
  session: BusSession;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;

export function saveLock<L>(store: Store, ds: Dataset, lock: { dep: Departure; leg: L; session: BusSession } | undefined, now: number): void {
  try {
    if (!lock || ds.meta.demo || lock.session.phase === 'left' || lock.session.phase === 'ended') { store?.removeItem(LOCK_KEY); return; }
    const saved: SavedLock<L> = { v: 1, feedVersion: ds.meta.feedVersion, savedAt: now, dep: lock.dep, leg: lock.leg, session: lock.session };
    store?.setItem(LOCK_KEY, JSON.stringify(saved));
  } catch { /* storage full or blocked: the lock simply is not kept */ }
}

/** The saved lock, if it is still valid for this dataset and time; otherwise undefined (and forgotten). */
export function loadLock<L>(store: Store, ds: Dataset, now: number): SavedLock<L> | undefined {
  let saved: SavedLock<L> | undefined;
  try { saved = JSON.parse(store?.getItem(LOCK_KEY) ?? 'null') as SavedLock<L> | undefined; } catch { saved = undefined; }
  if (!saved) return undefined;
  const ok = saved.v === 1 && !ds.meta.demo && saved.feedVersion === ds.meta.feedVersion && validFor(ds, saved, now);
  if (!ok) { forgetLock(store); return undefined; }
  return saved;
}

export function forgetLock(store: Store): void {
  try { store?.removeItem(LOCK_KEY); } catch { /* nothing to forget */ }
}

function validFor<L>(ds: Dataset, s: SavedLock<L>, now: number): boolean {
  const dep = s.dep;
  const session = s.session;
  if (!dep || !session || typeof dep.tripId !== 'string' || !Number.isFinite(dep.departs) || !Number.isFinite(dep.arrivesEnd)) return false;
  // Same trip, same pattern, same boarding stop as the schedule now loaded.
  const trip = ds.trips.find((t) => t.id === dep.tripId);
  const pattern = ds.patterns.find((p) => p.id === dep.pattern?.id);
  if (!trip || !pattern || trip.patternId !== pattern.id || pattern.stopIds.join() !== dep.pattern.stopIds.join()) return false;
  if (pattern.stopIds[dep.stopIndex] === undefined || session.departure?.tripInstanceId !== dep.tripInstanceId) return false;
  if (session.phase === 'left' || session.phase === 'ended') return false;
  // Not before it was made (a clock set back), and not long after the trip's scheduled end.
  if (!(now >= session.lock.lockedAt) || now > dep.arrivesEnd + RESUME_AFTER_END_MS) return false;
  return true;
}
