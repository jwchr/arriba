// Core transit types. IDs are the feed's own strings; never a route label like "165" alone.

export interface Dataset {
  meta: DatasetMeta;
  routes: Route[];
  stops: Stop[];
  patterns: Pattern[];
  trips: Trip[];
  calendars: Record<string, ServiceCalendar>;
}

export interface DatasetMeta {
  /** True for the invented demo dataset. The UI must show a DEMO banner whenever this is true. */
  demo: boolean;
  source: string;
  feedVersion: string;
  builtAt: string;
  timezone: string; // agency timezone, e.g. America/New_York
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
  lat: number;
  lon: number;
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
}

export interface Trip {
  id: string;
  patternId: string;
  serviceId: string;
  /** Departure seconds after the service day's noon-minus-12h, aligned to pattern.stopIds. May exceed 86400. */
  times: number[];
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
  /** Scheduled arrival at the pattern's last stop (epoch ms). */
  arrivesEnd: number;
}
