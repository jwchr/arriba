// Favorites are an ordered list the rider controls. Order is never changed by proximity or time
// of day (owner decision D26); suggestions may highlight but must not reorder or overwrite.
import { cleanLeavePlan, type LeavePlan } from './leaveBy';

export interface Favorite {
  id: string;
  label: string;
  /** Boarding stop for the outbound direction. */
  fromStopId: string;
  /** Where the rider is going; used for direction and reverse. */
  toStopId: string;
  /** Empty = every route that serves the pair. */
  routeIds: string[];
  /** Walking time, spare minutes and arrive-by for each direction (issue #54); kept on this phone only. */
  leave?: { out?: LeavePlan; back?: LeavePlan };
}

/** Set or clear (`undefined`) the leave plan for one direction of a commute. */
export function setLeavePlan(list: Favorite[], id: string, dir: 'out' | 'back', plan: LeavePlan | undefined): Favorite[] {
  return list.map((x) => {
    if (x.id !== id) return x;
    const leave = { ...x.leave };
    if (plan) leave[dir] = plan; else delete leave[dir];
    const { leave: _old, ...rest } = x;
    return leave.out || leave.back ? { ...rest, leave } : rest;
  });
}

export function addFavorite(list: Favorite[], f: Favorite): Favorite[] {
  if (list.some((x) => x.id === f.id)) return list;
  return [...list, f];
}

export function removeFavorite(list: Favorite[], id: string): Favorite[] {
  return list.filter((x) => x.id !== id);
}

export function renameFavorite(list: Favorite[], id: string, label: string): Favorite[] {
  const clean = label.trim();
  if (!clean) return list;
  return list.map((x) => (x.id === id ? { ...x, label: clean } : x));
}

/** Move one favorite up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveFavorite(list: Favorite[], id: string, delta: -1 | 1): Favorite[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  const a = next[i]!;
  next[i] = next[j]!;
  next[j] = a;
  return next;
}

/** The same commute in the other direction; the return boarding stop is chosen by the caller (see direction.ts). */
export function reversed(f: Favorite): Pick<Favorite, 'fromStopId' | 'toStopId' | 'routeIds'> {
  return { fromStopId: f.toStopId, toStopId: f.fromStopId, routeIds: f.routeIds };
}

// Storage keys keep the app's first name (Arriba) so saved commutes survive the rename to Dale.
const KEY = 'arriba.favorites.v1';

/** Browser storage can be missing or throw (private mode); favorites then live for the session only. */
export function loadFavorites(storage: Pick<Storage, 'getItem'> | undefined): Favorite[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Favorite[]).filter((f) => f && typeof f.id === 'string').map((f) => {
      // A damaged leave plan is dropped on its own; the commute itself is kept.
      const { leave, ...rest } = f;
      const out = cleanLeavePlan(leave?.out);
      const back = cleanLeavePlan(leave?.back);
      return out || back ? { ...rest, leave: { ...(out ? { out } : {}), ...(back ? { back } : {}) } } : rest;
    });
  } catch {
    return [];
  }
}

export function saveFavorites(storage: Pick<Storage, 'setItem'> | undefined, list: Favorite[]): void {
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}
