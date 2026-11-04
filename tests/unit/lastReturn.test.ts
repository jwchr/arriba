import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoDataset } from '../../src/data/demo';
import { lastReturn } from '../../src/domain/lastReturn';
import { departuresOn } from '../../src/domain/schedule';
import { formatTime12, localYmd } from '../../src/domain/time';
import type { Dataset, Departure } from '../../src/domain/types';

const printed = JSON.parse(readFileSync(join(__dirname, '../../public/data/corridor.json'), 'utf8')) as Dataset;
const TZ = 'America/New_York';
const fmt = (at: number) => formatTime12(at, TZ);
const inbound = (ds: Dataset, routeId = 'R165', date = '20261104', stopId = 'D1'): Departure => {
  const result = departuresOn(ds, { stopId, toStopId: 'PABT', routeIds: [routeId], date }).find((d) => d.serviceDate === date);
  if (!result) throw new Error('missing synthetic inbound test trip');
  return result;
};
const copyDemo = (): Dataset => structuredClone(demoDataset);

describe('last same-line return', () => {
  it('uses the printed weekday service’s 25:10 return and separately shows the next 5:22 AM departure', () => {
    const out = inbound(printed, 'R165', '20261104', 'N19');
    const plan = lastReturn(printed, out, 'PABT');
    expect(plan.status).toBe('available');
    expect(plan.returnLeg).toEqual({ fromStopId: 'PABT', toStopId: 'W19' });
    expect(plan.lastForServiceDay?.serviceDate).toBe('20261104');
    expect(fmt(plan.lastForServiceDay!.departs)).toBe('1:10 AM');
    expect(localYmd(plan.lastForServiceDay!.departs, TZ)).toBe('20261105');
    expect(fmt(plan.previous!.departs)).toBe('12:32 AM');
    expect(fmt(plan.nextAfterLast!.departs)).toBe('5:22 AM');
    expect(plan.nextAfterLast?.serviceDate).toBe('20261105');
    expect(plan.limitations).toContain('printed_validity_unconfirmed');
    expect(plan.limitations).toContain('service_day_boundary');
  });

  it('keeps the 165T route ID separate from later local 165 departures', () => {
    const out = inbound(printed, 'R165T', '20261104', 'N19');
    const plan = lastReturn(printed, out, 'PABT');
    expect(plan.status).toBe('available');
    expect(plan.lastForServiceDay?.route.id).toBe('R165T');
    expect(fmt(plan.lastForServiceDay!.departs)).toBe('11:05 PM');
    expect(plan.nextAfterLast?.route.id).toBe('R165T');
    expect(plan.limitations).toContain('same_line_only');
  });

  it('only returns trips that actually reach the reverse home stop', () => {
    const ds = copyDemo();
    ds.patterns.push({ id: 'short-return', routeId: 'R165', directionId: 1, headsign: 'Short turn', stopIds: ['PABT', 'D4B'] });
    ds.trips.push({ id: 'short-late', patternId: 'short-return', serviceId: 'WKDY', times: [25 * 3600, 25 * 3600 + 600] });
    const plan = lastReturn(ds, inbound(ds, 'R165', '20261104', 'D2'), 'PABT');
    expect(plan.returnLeg?.toStopId).toBe('D2B');
    expect(plan.lastForServiceDay?.tripId).not.toBe('short-late');
    expect(plan.lastForServiceDay?.pattern.stopIds).toContain('D2B');
  });

  it('reports missing reverse-stop knowledge instead of guessing a home location', () => {
    const ds = copyDemo();
    ds.stops = ds.stops.map((s) => ({ ...s, lat: undefined, lon: undefined, twin: undefined }));
    const plan = lastReturn(ds, inbound(ds, 'R165', '20261104', 'D2'), 'PABT');
    expect(plan.status).toBe('unconfirmed');
    expect(plan.limitations).toContain('no_reverse_stop');
    expect(plan.lastForServiceDay).toBeUndefined();
  });

  it('does not treat a service-day boundary as a last chance when departures continue overnight', () => {
    const ds = copyDemo();
    ds.trips.push({ id: 'overnight-return', patternId: 'L1', serviceId: 'WKDY', times: [1800, 2160, 2640, 3240, 5100] });
    const plan = lastReturn(ds, inbound(ds), 'PABT');
    expect(plan.status).toBe('continues_overnight');
    expect(fmt(plan.lastForServiceDay!.departs)).toBe('12:00 AM');
    expect(fmt(plan.nextAfterLast!.departs)).toBe('12:30 AM');
    expect(plan.nextAfterLast?.serviceDate).toBe('20261105');
    expect(plan.nextAfterLast!.departs).toBeLessThan(plan.window!.overnightEndsAt);
  });

  it('still exposes the next departure beyond the comparison window, rather than calling the cutoff final service', () => {
    const ds = copyDemo();
    ds.trips.push({ id: 'early-next-return', patternId: 'L1', serviceId: 'WKDY', times: [5 * 3600 + 60, 5 * 3600 + 420, 5 * 3600 + 900, 5 * 3600 + 1500, 5 * 3600 + 3360] });
    const plan = lastReturn(ds, inbound(ds), 'PABT');
    expect(fmt(plan.window!.overnightEndsAt)).toBe('5:00 AM');
    expect(fmt(plan.nextAfterLast!.departs)).toBe('5:01 AM');
    expect(plan.nextAfterLast!.departs).toBeGreaterThan(plan.window!.overnightEndsAt);
    expect(plan.limitations).toContain('service_day_boundary');
  });

  it('keeps printed holiday results unconfirmed rather than treating ordinary weekday times as reliable', () => {
    const out = inbound(printed, 'R165', '20261111', 'N19');
    const plan = lastReturn(printed, out, 'PABT');
    expect(plan.status).toBe('unconfirmed');
    expect(plan.limitations).toContain('holiday_schedule_missing');
    expect(plan.lastForServiceDay).toBeDefined(); // still useful as explicitly unconfirmed information
  });

  it('respects actual GTFS calendar exceptions instead of overriding them with a guessed holiday schedule', () => {
    const ds = copyDemo();
    const plan = lastReturn(ds, inbound(ds, 'R165', '20261126'), 'PABT');
    expect(plan.lastForServiceDay?.tripId).toContain('SUN');
    expect(plan.limitations).not.toContain('holiday_schedule_missing');
    expect(plan.limitations).toContain('demo_schedule');
  });

  it('does not infer final service from a truncated calendar', () => {
    const ds = copyDemo();
    for (const cal of Object.values(ds.calendars)) { cal.end = '20261104'; cal.added = []; }
    const plan = lastReturn(ds, inbound(ds), 'PABT');
    expect(plan.status).toBe('unconfirmed');
    expect(plan.limitations).toContain('schedule_coverage_missing');
    expect(plan.limitations).toContain('following_departure_unknown');
  });

  it('makes a missing referenced calendar an explicit uncertainty', () => {
    const ds = copyDemo();
    ds.trips.push({ id: 'missing-calendar', patternId: 'L1', serviceId: 'ABSENT', times: [80000, 80400, 81000, 81600, 83000] });
    const plan = lastReturn(ds, inbound(ds), 'PABT');
    expect(plan.status).toBe('unconfirmed');
    expect(plan.limitations).toContain('calendar_missing');
  });

  it('flags an interpolated last departure so it cannot become a precise deadline', () => {
    const ds = copyDemo();
    const last = ds.trips.find((t) => t.id === 'L1-WKDY-1440')!;
    last.estimated = [0];
    const plan = lastReturn(ds, inbound(ds), 'PABT');
    expect(plan.status).toBe('unconfirmed');
    expect(plan.lastForServiceDay?.estimated).toBe(true);
    expect(plan.limitations).toContain('estimated_departure');
  });

  it('warns when scheduled outbound arrival is already after the last same-line return', () => {
    const ds = copyDemo();
    ds.trips.push({ id: 'late-outbound', patternId: 'X0', serviceId: 'WKDY', times: [23 * 3600, 23 * 3600 + 360, 23 * 3600 + 2400] });
    const out = departuresOn(ds, { stopId: 'D1', toStopId: 'PABT', date: '20261104', routeIds: ['R165T'] }).find((d) => d.tripId === 'late-outbound')!;
    const plan = lastReturn(ds, out, 'PABT');
    expect(plan.status).toBe('no_return_listed');
    expect(plan.limitations).toContain('outbound_arrives_after_last');
    expect(plan.previous).toBeUndefined();
    expect(plan.firstReturn!.departs).toBeGreaterThan(plan.window!.from);
  });

  it('only applies to outbound journeys whose selected destination is PABT', () => {
    const out = inbound(demoDataset);
    expect(lastReturn(demoDataset, out, 'D3').status).toBe('not_applicable');
    const back = departuresOn(demoDataset, { stopId: 'PABT', toStopId: 'D1', date: '20261104' })[0]!;
    expect(lastReturn(demoDataset, back, 'D1').status).toBe('not_applicable');
  });
});
