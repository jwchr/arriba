// Core transit types. IDs are the feed's own strings; never a route label like "165" alone.

export interface Dataset {
  meta: DatasetMeta;
  routes: Route[];
  stops: Stop[];
  patterns: Pattern[];
  trips: Trip[];
  calendars: Record<string, ServiceCalendar>;
  /** NJ Transit's published Port Authority gate rules (from a printed timetable), when no live gate is known. */
  publishedGates?: PublishedGates;
}

/** Gate rules NJ Transit prints by service type and time of day. A rule applies by the departure's clock time at the terminal. */
export interface PublishedGates {
  /** Where the rules were read, shown to the rider. */
  source: string;
  /** YYYYMMDD the printed gate change took effect. */
  effective: string;
  rules: PublishedGateRule[];
}

export interface PublishedGateRule {
  /** "local" for unmarked trips, else the timetable's trip marker (T, P, R, RF...). */
  service: string;
  dayTypes: ('weekday' | 'saturday' | 'sunday')[];
  /** Inclusive wall-clock minutes after midnight; toMin < fromMin wraps past midnight. Omitted = all day. */
  fromMin?: number;
  toMin?: number;
  gate: string;
  door?: string;
}

export interface DatasetMeta {
  /** True for the invented demo dataset. The UI must show a DEMO banner whenever this is true. */
  demo: boolean;
  source: string;
  feedVersion: string;
  builtAt: string;
  timezone: string; // agency timezone, e.g. America/New_York
  /** Set when the data was typed in from a printed timetable rather than built from NJ Transit's data feed. The UI must say so. */
  transcribed?: { issued: string; documentId: string };
}

export interface Route {
  id: string;
  shortName: string; // "165T"
  longName: string;
  color?: string;
}

export interface Stop {
  id: string;
  code?: string; // NJ Transit five-digit stop code when published
  name: string;
  /** Absent in datasets transcribed from printed timetables, which carry no coordinates. */
  lat?: number;
  lon?: number;
  /** The stop for the opposite direction at the same place (across the street), when the source says so. Both stops point at each other. */
  twin?: string;
  /** Key of a note the UI shows to riders boarding here (see i18n `stopNotes`). */
  noteId?: string;
  /** Terminal id when this stop is a terminal with gates, e.g. "PABT". */
  terminal?: string;
}

/** One ordered stop sequence for a route and direction (a "service pattern"; 165T is its own pattern). */
export interface Pattern {
  id: string;
  routeId: string;
  directionId: 0 | 1;
  headsign: string;
  stopIds: string[];
  /** The printed timetable's trip marker for this pattern (T, P, R, RF, F, FP); absent for unmarked local trips. */
  variant?: string;
}

export interface Trip {
  id: string;
  patternId: string;
  serviceId: string;
  /** Departure seconds after the service day's noon-minus-12h, aligned to pattern.stopIds. May exceed 86400. */
  times: number[];
  /** Indices into `times` the build script filled in because the feed left them blank: Arriba's estimates, not NJ Transit data. Omitted when none. */
  estimated?: number[];
}

export interface ServiceCalendar {
  /** Monday..Sunday */
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  start: string; // YYYYMMDD
  end: string;
  added: string[];
  removed: string[];
}

/** A scheduled trip on a specific service date: the unit we lock onto. */
export type TripInstanceId = string; // `${tripId}@${serviceDate}`

export function tripInstanceId(tripId: string, serviceDate: string): TripInstanceId {
  return `${tripId}@${serviceDate}`;
}

export interface Departure {
  tripInstanceId: TripInstanceId;
  tripId: string;
  serviceDate: string;
  route: Route;
  pattern: Pattern;
  stopIndex: number;
  /** Scheduled departure at the chosen stop (epoch ms). */
  departs: number;
  /** True when `departs` is Arriba's estimate (see Trip.estimated), so the UI must label it. */
  estimated: boolean;
  /** Scheduled arrival at the pattern's last stop (epoch ms). */
  arrivesEnd: number;
}
