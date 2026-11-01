// Port Authority gate for one exact departure. Sources, best first:
//   posted  - NJ Transit DepartureVision assignment for this trip instance (lanegate / manual_lane_gate)
//   usual   - the gate this route pattern used at this time on comparable days, learned from history
//   unknown - nothing reliable; the UI says "Gate not confirmed" and links to the official board
// A gate is never inferred from the route number alone.

import type { TripInstanceId } from './types';

export interface GatePosting {
  tripInstanceId: TripInstanceId;
  gate: string;
  door?: string;
  observedAt: number;
  source: 'njt-departurevision' | 'demo';
}

export interface UsualGate {
  patternId: string;
  /** Inclusive local minutes after midnight. */
  fromMin: number;
  toMin: number;
  dayType: 'weekday' | 'saturday' | 'sunday';
  gate: string;
  door?: string;
  /** How many observed departures support this, for honesty in the UI. */
  samples: number;
}

export type GateAnswer =
  | { status: 'posted'; gate: string; door?: string; observedAt: number; source: GatePosting['source'] }
  | { status: 'usual'; gate: string; door?: string; samples: number }
  | { status: 'unknown' };

/** Parse NJ Transit's lane/gate string. Inbound buses report "..", which means no gate. */
export function parseLaneGate(raw: string | undefined | null): { gate: string; door?: string } | null {
  const s = (raw ?? '').trim();
  if (!s || /^\.+$/.test(s)) return null;
  const m = /^(\d{1,3})(?:\s*[-/]\s*(\d{1,2}))?$/.exec(s);
  if (!m) return { gate: s };
  return m[2] ? { gate: m[1]!, door: m[2] } : { gate: m[1]! };
}

export function gateFor(
  tripId: TripInstanceId,
  patternId: string,
  localMinutes: number,
  dayType: UsualGate['dayType'],
  postings: GatePosting[],
  usual: UsualGate[],
): GateAnswer {
  const posted = postings
    .filter((p) => p.tripInstanceId === tripId)
    .sort((a, b) => b.observedAt - a.observedAt)[0];
  if (posted) return { status: 'posted', gate: posted.gate, door: posted.door, observedAt: posted.observedAt, source: posted.source };
  const u = usual
    .filter((x) => x.patternId === patternId && x.dayType === dayType && localMinutes >= x.fromMin && localMinutes <= x.toMin)
    .sort((a, b) => b.samples - a.samples)[0];
  if (u && u.samples >= 5) return { status: 'usual', gate: u.gate, door: u.door, samples: u.samples };
  return { status: 'unknown' };
}

/** A change worth a notification: a new posting for the same trip with a different gate or door. */
export function gateChanged(prev: GateAnswer, next: GateAnswer): boolean {
  if (next.status !== 'posted') return false;
  if (prev.status === 'posted') return prev.gate !== next.gate || (prev.door ?? '') !== (next.door ?? '');
  if (prev.status === 'usual') return prev.gate !== next.gate;
  return false;
}
