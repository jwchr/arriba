import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { twinOf } from '../../src/domain/direction';
import { recoveryOptions, recoveryStops } from '../../src/domain/recovery';
import { nextDepartures } from '../../src/domain/schedule';
import { zonedWallTime } from '../../src/domain/time';
import type { Dataset } from '../../src/domain/types';

const ds = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8')) as Dataset;
const TZ = ds.meta.timezone;
const pabt = ds.stops.find((s) => s.terminal)!;
const home = ds.stops.find((s) => s.id === 'W8')!; // a mid-route stop toward Westwood, with stops after it
const now = zonedWallTime(2026, 11, 4, 18, 0, TZ);
const dep = nextDepartures(ds, { stopId: pabt.id, toStopId: home.id, routeIds: [] }, now, 1)[0]!;
const alight = dep.pattern.stopIds.indexOf(home.id);

describe('missed stop and wrong bus (issue #60)', () => {
  it('offers the stops after yours for a missed stop, and every route stop for a wrong bus', () => {
    expect(alight).toBeGreaterThan(dep.stopIndex);
    expect(recoveryStops(ds, dep, alight, 'missed')).toEqual([...new Set(dep.pattern.stopIds.slice(alight + 1))]);
    expect(recoveryStops(ds, dep, alight, 'passed')).toEqual(recoveryStops(ds, dep, alight, 'missed'));
    const wrong = recoveryStops(ds, dep, alight, 'wrong_bus');
    expect(wrong).not.toContain(home.id);
    expect(wrong).toContain(pabt.id);
    // Both directions of the route are listed, since the rider may be on a bus going the other way.
    expect(wrong.some((id) => /\(to New York\)/.test(ds.stops.find((s) => s.id === id)!.name))).toBe(true);
    const last = dep.pattern.stopIds.length - 1;
    expect(recoveryStops(ds, dep, last, 'missed')).toEqual([]);
  });

  it('lists scheduled ways back to your stop (or across from it), boarding where you are or across the street', () => {
    const later = recoveryStops(ds, dep, alight, 'missed');
    let found = 0;
    for (const at of later) {
      const r = recoveryOptions(ds, at, home.id, dep.arrivesEnd);
      for (const o of r.options) {
        found++;
        expect([at, twinOf(ds, ds.stops.find((s) => s.id === at)!)?.id]).toContain(o.boardStopId);
        expect([home.id, twinOf(ds, home)?.id]).toContain(o.alightStopId);
        expect(o.dep.departs).toBeGreaterThanOrEqual(dep.arrivesEnd - 60_000);
        expect(o.arrives).toBeGreaterThan(o.dep.departs);
      }
      expect(r.limitations).toContain('no_walking_or_transfers');
    }
    expect(found).toBeGreaterThan(0);
  });

  it('says the gap is in its data, not that there is no way back, where it has no stop for the other direction', () => {
    // Missing W19 on an outbound 165 leaves W20 (end of the line), whose inbound stop is a different place.
    const out = nextDepartures(ds, { stopId: pabt.id, toStopId: 'W19', routeIds: [] }, now, 5).find((d) => d.pattern.stopIds.includes('W20'))!;
    const w19 = out.pattern.stopIds.indexOf('W19');
    expect(recoveryStops(ds, out, w19, 'missed')).toEqual(['W20']);
    const r = recoveryOptions(ds, 'W20', 'W19', out.arrivesEnd);
    expect(r.options).toEqual([]);
    expect(r.otherSideUnknown).toBe(true);
    // A stop with a twin and buses back is not flagged.
    expect(recoveryOptions(ds, 'W12', 'W8', out.arrivesEnd).otherSideUnknown).toBe(false);
  });
});
