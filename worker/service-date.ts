import { isServiceActive, tripTimeAt } from '../src/domain/schedule';
import { addDays, localYmd } from '../src/domain/time';
import { validServiceDate } from '../src/domain/liveBus';
import type { Dataset, ServiceCalendar, Trip } from '../src/domain/types';

/** Prove one date across the WHOLE published calendar, never choose today's/nearest date. */
export function uniqueCalendarDate(cal: ServiceCalendar): string | undefined {
  const dates = new Set(cal.added.filter((date) => validServiceDate(date) && isServiceActive(cal, date)));
  if (dates.size > 1) return;
  if (cal.days.some(Boolean) && cal.start <= cal.end) {
    if (!validServiceDate(cal.start) || !validServiceDate(cal.end)) return;
    let date = cal.start, checked = 0;
    while (date <= cal.end) {
      // Unsupported long calendars fail closed; no unbounded Worker CPU scan.
      if (checked++ >= 366) return;
      if (isServiceActive(cal, date)) dates.add(date);
      if (dates.size > 1) return;
      date = addDays(date, 1);
    }
  }
  return dates.size === 1 ? [...dates][0] : undefined;
}

/** A unique calendar date is usable only on the actual trip's local operating day(s). */
export function dateContainsReport(ds: Dataset, trip: Trip, date: string, observedAt: number): boolean {
  const day = localYmd(observedAt, ds.meta.timezone);
  return day >= localYmd(tripTimeAt(ds, trip, date, 0), ds.meta.timezone)
    && day <= localYmd(tripTimeAt(ds, trip, date, trip.times.length - 1), ds.meta.timezone);
}
