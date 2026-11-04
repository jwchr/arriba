import { describe, expect, it } from 'vitest';
import { icsEvent, untilParts } from '../../src/domain/calendar';

describe('last-bus calendar reminder (issue #58)', () => {
  const start = Date.UTC(2026, 10, 5, 4, 58); // 11:58 PM in New York, Nov 4
  const ics = icsEvent({ uid: 'T@20261104@dale', start, minutes: 15, alarmMinutes: 30, now: Date.UTC(2026, 10, 4, 23, 0),
    summary: 'Last listed 165 home: 11:58 PM from New York - Port Authority Bus Terminal', description: 'Scheduled time; check, then go.' });
  it('is a valid single event with a 30-minute alert, in UTC, with CRLF lines', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261105T045800Z');
    expect(ics).toContain('DTEND:20261105T051300Z');
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('escapes commas and semicolons in text', () => {
    expect(ics.replace(/\r\n /g, '')).toContain('DESCRIPTION:Scheduled time\; check\\, then go.');
  });
  it('counts down in hours and minutes, and stops once the time has passed', () => {
    expect(untilParts(start - (2 * 60 + 10) * 60_000, start)).toEqual({ h: 2, m: 10 });
    expect(untilParts(start - 30_000, start)).toEqual({ h: 0, m: 1 });
    expect(untilParts(start, start)).toBeUndefined();
  });
});
