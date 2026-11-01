// INVENTED demo data. Stop names, coordinates, times and gates are fictional and must never be
// mistaken for NJ Transit service. The real dataset comes from scripts/build-gtfs.mjs (M2).

import type { UsualGate } from '../domain/gate';
import type { Dataset, Pattern, Stop, Trip } from '../domain/types';

const S = (id: string, name: string, lat: number, lon: number, extra: Partial<Stop> = {}): Stop => ({ id, name, lat, lon, ...extra });

// Opposite-side pairs sit about 25 m apart so the wrong-direction guard can be exercised.
const stops: Stop[] = [
  S('D1', 'Demo Terminal', 40.8800, -74.0450, { code: '90001' }),
  S('D2', 'Maple Ave & Main St (to NYC)', 40.8700, -74.0400, { code: '90002' }),
  S('D2B', 'Maple Ave & Main St (to Demo Terminal)', 40.87022, -74.04005, { code: '90012' }),
  S('D3', 'Oak St & River Rd (to NYC)', 40.8550, -74.0300, { code: '90003' }),
  S('D3B', 'Oak St & River Rd (to Demo Terminal)', 40.85522, -74.03005, { code: '90013' }),
  S('D4', 'Park & Ride (to NYC)', 40.8200, -74.0200, { code: '90004' }),
  S('D4B', 'Park & Ride (to Demo Terminal)', 40.82022, -74.02005, { code: '90014' }),
  S('PABT', 'Port Authority Bus Terminal', 40.7570, -73.9910, { terminal: 'PABT', code: '90000' }),
];

const patterns: Pattern[] = [
  { id: 'L0', routeId: 'R165', directionId: 0, headsign: '165 NEW YORK', stopIds: ['D1', 'D2', 'D3', 'D4', 'PABT'] },
  { id: 'L1', routeId: 'R165', directionId: 1, headsign: '165 DEMO TERMINAL', stopIds: ['PABT', 'D4B', 'D3B', 'D2B', 'D1'] },
  { id: 'X0', routeId: 'R165T', directionId: 0, headsign: '165T NEW YORK EXPRESS', stopIds: ['D1', 'D2', 'PABT'] },
  { id: 'X1', routeId: 'R165T', directionId: 1, headsign: '165T DEMO TERMINAL EXPRESS', stopIds: ['PABT', 'D2B', 'D1'] },
];

const LOCAL_OFFSETS = [0, 6, 14, 24, 55].map((m) => m * 60);
const EXPRESS_OFFSETS = [0, 6, 40].map((m) => m * 60);

function trips(patternId: string, serviceId: string, startMin: number, endMin: number, everyMin: number, offsets: number[]): Trip[] {
  const out: Trip[] = [];
  for (let m = startMin; m <= endMin; m += everyMin) {
    out.push({ id: `${patternId}-${serviceId}-${m}`, patternId, serviceId, times: offsets.map((o) => m * 60 + o) });
  }
  return out;
}

const h = (x: number) => x * 60;

export const demoDataset: Dataset = {
  meta: { demo: true, source: 'Invented demo data', feedVersion: 'demo-1', builtAt: '2026-10-31T00:00:00Z', timezone: 'America/New_York' },
  routes: [
    { id: 'R165', shortName: '165', longName: 'Demo Terminal - New York (local, demo)', color: '1F6F43' },
    { id: 'R165T', shortName: '165T', longName: 'Demo Terminal - New York (express, demo)', color: 'F2B705' },
  ],
  stops,
  patterns,
  trips: [
    // Weekdays: local every 30 min 5:00 AM to 11:30 PM plus one after-midnight trip (24:15 = 12:15 AM).
    ...trips('L0', 'WKDY', h(5), h(23) + 30, 30, LOCAL_OFFSETS),
    ...trips('L0', 'WKDY', h(24) + 15, h(24) + 15, 30, LOCAL_OFFSETS),
    ...trips('L1', 'WKDY', h(6), h(24), 30, LOCAL_OFFSETS),
    ...trips('X0', 'WKDY', h(6), h(9), 20, EXPRESS_OFFSETS),
    ...trips('X1', 'WKDY', h(16), h(19), 20, EXPRESS_OFFSETS),
    // Saturday and Sunday: hourly local only.
    ...trips('L0', 'SAT', h(6), h(23), 60, LOCAL_OFFSETS),
    ...trips('L1', 'SAT', h(7), h(24), 60, LOCAL_OFFSETS),
    ...trips('L0', 'SUN', h(7), h(22), 60, LOCAL_OFFSETS),
    ...trips('L1', 'SUN', h(8), h(23), 60, LOCAL_OFFSETS),
  ],
  calendars: {
    // Thanksgiving 2026 (Nov 26) runs the Sunday schedule in this demo.
    WKDY: { days: [true, true, true, true, true, false, false], start: '20260901', end: '20270430', added: [], removed: ['20261126'] },
    SAT: { days: [false, false, false, false, false, true, false], start: '20260901', end: '20270430', added: [], removed: [] },
    SUN: { days: [false, false, false, false, false, false, true], start: '20260901', end: '20270430', added: ['20261126'], removed: [] },
  },
};

export const demoUsualGates: UsualGate[] = [
  { patternId: 'L1', dayType: 'weekday', fromMin: 0, toMin: 22 * 60, gate: '212', door: '2', samples: 40 },
  { patternId: 'L1', dayType: 'weekday', fromMin: 22 * 60 + 1, toMin: 24 * 60, gate: '312', samples: 12 },
  { patternId: 'X1', dayType: 'weekday', fromMin: 0, toMin: 24 * 60, gate: '214', door: '3', samples: 25 },
  { patternId: 'L1', dayType: 'saturday', fromMin: 0, toMin: 24 * 60, gate: '212', door: '2', samples: 8 },
  { patternId: 'L1', dayType: 'sunday', fromMin: 0, toMin: 24 * 60, gate: '212', door: '2', samples: 3 },
];
