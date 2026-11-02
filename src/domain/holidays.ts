// NJ Transit's "Holiday Service Guide", printed on its bus timetables (route 165, issued 7/1/26): the days
// on which NJ Transit may run a different schedule. The printed timetable lists the days but not their
// times, so a dataset typed in from it can only warn on these days. A GTFS feed carries its own holiday calendar.
import { addDays, parseYmd, weekdayIndex } from './time';

const ymd = (y: number, m: number, d: number) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

/** The n-th weekday `wd` (0 = Monday .. 6 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = ymd(y, m, 1);
    return addDays(first, ((wd - weekdayIndex(first) + 7) % 7) + 7 * (n - 1));
  }
  const last = addDays(m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1), -1);
  return addDays(last, -((weekdayIndex(last) - wd + 7) % 7));
}

/** The last Friday strictly before a date. */
const fridayBefore = (d: string) => addDays(d, -((weekdayIndex(d) - 4 + 7) % 7 || 7));

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return ymd(y, Math.floor(n / 31), (n % 31) + 1);
}

/** Every day on NJ Transit's printed holiday list in calendar year `y`, as YYYYMMDD. */
export function njtHolidaysIn(y: number): string[] {
  const memorial = nthWeekday(y, 5, 0, -1);
  const labor = nthWeekday(y, 9, 0, 1);
  const thanksgiving = nthWeekday(y, 11, 3, 4);
  return [
    ymd(y, 1, 1), ymd(y, 1, 2), // New Year's Day, Day After New Year's
    nthWeekday(y, 1, 0, 3), nthWeekday(y, 2, 0, 3), // Martin Luther King Jr. Day, Presidents Day
    addDays(easter(y), -2), // Good Friday
    fridayBefore(memorial), memorial, ymd(y, 6, 19), // Friday Before Memorial Day, Memorial Day, Juneteenth
    fridayBefore(ymd(y, 7, 4)), ymd(y, 7, 3), ymd(y, 7, 4), ymd(y, 7, 5), // Independence Day and the days around it
    fridayBefore(labor), labor, nthWeekday(y, 10, 0, 2), ymd(y, 11, 11), // Friday Before Labor Day, Labor Day, Columbus Day, Veterans Day
    addDays(thanksgiving, -1), thanksgiving, addDays(thanksgiving, 1), // Wednesday Before, Thanksgiving, Friday After
    fridayBefore(ymd(y, 12, 25)), ymd(y, 12, 24), ymd(y, 12, 25), ymd(y, 12, 26), // Friday Before Christmas, Christmas Eve, Day, Day After
    fridayBefore(ymd(y + 1, 1, 1)), ymd(y, 12, 31), // Friday Before New Year's, New Year's Eve
  ];
}

/** Is this service date on NJ Transit's printed holiday list? */
export function isNjtHoliday(date: string): boolean {
  return njtHolidaysIn(parseYmd(date)[0]).includes(date);
}
