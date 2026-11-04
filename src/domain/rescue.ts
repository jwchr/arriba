// "Get me the fuck home" (issue #32, D45): when the usual bus is late, missing or full, list every
// scheduled way Dale's data knows from here (or the stop across the street) to home (or the stop
// across from it), ranked by arrival. Coverage is stated, never implied: routes outside Dale's data
// are unknown, not absent, and there is no walking or transfer data, so none is suggested.
import { twinOf } from './direction';
import { departuresOn, tripStopTimes } from './schedule';
import { addDays, localYmd, parseYmd, zonedWallTime } from './time';
import type { Dataset, Departure } from './types';

export interface RescueOption {
  dep: Departure;
  /** Where to board: the rider's stop, or the stop across the street. */
  boardStopId: string;
  acrossFromBoard: boolean;
  /** Where it gets off: home, or the stop across from home. */
  alightStopId: string;
  acrossFromHome: boolean;
  arrives: number;
  arrivesEstimated: boolean;
  /** The same route as the rider's usual bus. */
  sameLine: boolean;
  /** The last departure listed tonight (through 4 AM) on the rider's line that reaches home. */
  lastOnLine: boolean;
}

export type RescueLimitation = 'schedule_only' | 'routes_in_data_only' | 'no_walking_or_transfers' | 'printed_timepoints_only' | 'demo_schedule';

export interface RescueResult {
  options: RescueOption[];
  /** Short names of the routes Dale's data has: the only ones searched. */
  routesSearched: string[];
  searchedUntil: number;
  limitations: RescueLimitation[];
}

export const RESCUE_HORIZON_MS = 4 * 3600_000;

/**
 * Scheduled options from `fromStopId` to `homeStopId` departing between `now` and the horizon, nearest
 * arrival first. `usualRouteId` marks same-line options, and the line's last listed trip home today is
 * kept even when later than the horizon or the limit, so a "last chance" is never hidden.
 */
export function rescueOptions(ds: Dataset, fromStopId: string, homeStopId: string, now: number, usualRouteId?: string, limit = 6, horizonMs = RESCUE_HORIZON_MS): RescueResult {
  const tz = ds.meta.timezone;
  const stop = (id: string) => ds.stops.find((s) => s.id === id);
  const from = stop(fromStopId);
  const home = stop(homeStopId);
  const limitations: RescueLimitation[] = ['schedule_only', 'routes_in_data_only', 'no_walking_or_transfers'];
  if (ds.meta.transcribed) limitations.push('printed_timepoints_only');
  if (ds.meta.demo) limitations.push('demo_schedule');
  const routesSearched = [...new Set(ds.routes.map((r) => r.shortName))].sort();
  const until = now + horizonMs;
  const base = { routesSearched, searchedUntil: until, limitations };
  if (!from || !home) return { ...base, options: [] };

  const boards = [from, twinOf(ds, from)].filter((s): s is NonNullable<typeof s> => !!s);
  const homes = [home, twinOf(ds, home)].filter((s): s is NonNullable<typeof s> => !!s);
  const today = localYmd(now, tz);
  // Tonight's service runs past midnight: the last trip home can leave as late as 4 AM tomorrow.
  const [ty, tm, td] = parseYmd(addDays(today, 1));
  const nightEnds = zonedWallTime(ty, tm, td, 4, 0, tz);
  const found = new Map<string, RescueOption>();
  let lastOnLine: RescueOption | undefined;

  for (const board of boards) {
    for (const date of [today, addDays(today, 1)]) {
      for (const dep of departuresOn(ds, { stopId: board.id, date })) {
        const ids = dep.pattern.stopIds;
        const alightIndex = ids.findIndex((id, i) => i > dep.stopIndex && homes.some((h) => h.id === id));
        if (alightIndex < 0) continue;
        const at = tripStopTimes(ds, dep)[alightIndex];
        if (!at) continue;
        const option: RescueOption = {
          dep, boardStopId: board.id, acrossFromBoard: board.id !== from.id,
          alightStopId: ids[alightIndex]!, acrossFromHome: ids[alightIndex] !== home.id,
          arrives: at.at, arrivesEstimated: at.estimated,
          sameLine: dep.route.id === usualRouteId, lastOnLine: false,
        };
        // The line's last listed trip home tonight (through 4 AM), wherever it falls.
        if (option.sameLine && dep.departs >= now - 60_000 && dep.departs < nightEnds && (!lastOnLine || dep.departs > lastOnLine.dep.departs)) lastOnLine = option;
        if (dep.departs < now - 60_000 || dep.departs > until) continue;
        // One entry per trip: prefer boarding at the rider's own stop over the one across the street.
        const prev = found.get(dep.tripInstanceId);
        if (!prev || (prev.acrossFromBoard && !option.acrossFromBoard)) found.set(dep.tripInstanceId, option);
      }
    }
  }

  let options = [...found.values()].sort((a, b) => a.arrives - b.arrives || a.dep.departs - b.dep.departs).slice(0, limit);
  if (lastOnLine) {
    const last = { ...lastOnLine, lastOnLine: true };
    options = options.some((o) => o.dep.tripInstanceId === last.dep.tripInstanceId)
      ? options.map((o) => (o.dep.tripInstanceId === last.dep.tripInstanceId ? { ...o, lastOnLine: true } : o))
      : [...options, last];
  }
  return { ...base, options };
}
