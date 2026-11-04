// A single calendar event with a reminder, as an iCalendar (.ics) file the rider saves to their own
// calendar (issue #58). Built on the phone; nothing is sent anywhere. Times are UTC instants.

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** RFC 5545 text escaping: backslash, semicolon, comma and line breaks. */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold content lines longer than 75 octets (continuations start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export interface CalendarEvent {
  uid: string;
  start: number;
  minutes: number;
  summary: string;
  description: string;
  /** Minutes before the start that the calendar should alert. */
  alarmMinutes: number;
  now: number;
}

export function icsEvent(e: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dale//Last bus reminder//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${text(e.uid)}`,
    `DTSTAMP:${stamp(e.now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.start + e.minutes * 60_000)}`,
    `SUMMARY:${text(e.summary)}`,
    `DESCRIPTION:${text(e.description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.summary)}`, `TRIGGER:-PT${Math.max(0, Math.round(e.alarmMinutes))}M`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** "2 h 10 min" style parts for a countdown; undefined once the time has passed. */
export function untilParts(now: number, at: number): { h: number; m: number } | undefined {
  if (!(at > now)) return undefined;
  const mins = Math.ceil((at - now) / 60_000);
  return { h: Math.floor(mins / 60), m: mins % 60 };
}
