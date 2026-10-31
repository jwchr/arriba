# Handoff: current state

Updated 2026-10-31. Keep this short; replace stale lines rather than appending.

## Built and tested
- M1 prototype on invented demo data (`src/data/demo.ts`, DEMO banner): home with ordered saved commutes and one-tap reverse, stop search with wrong-side guard, 7-day all-day timetable, departure detail with front-sign, stop list, Port Authority gate card (usual gate), ticket warning, exact-bus lock (scheduled-only until M3), English/Spanish, light/dark, offline service worker.
- Domain logic: GTFS service-day time with DST and after-midnight trips, calendars and holiday exceptions, departures, direction guard, favorites, trip lock state machine, gate parsing/selection/change detection. 31 unit tests.
- `scripts/build-gtfs.mjs`: real NJ Transit GTFS zip to `public/data/corridor.json` (corridor routes only); tested on a synthetic mini feed. When that file is present the app uses it instead of the demo.
- 3 Playwright flows on a Pixel 7 viewport.

## Not yet done / blocked
- Real schedule (M2): needs the NJ Transit bus GTFS zip. This environment's network cannot reach njtransit.com; owner either allows the domains or drops the zip into a connected folder.
- Live data (M0 spike, M3): needs NJ Transit developer credentials (BUSDATA and GTFS-BUS APIs) stored as secrets by the owner.
- Not yet opened on Jeff's Galaxy S26 Ultra or Diego's phone.

## Known gaps (from independent review, 2026-10-31)
- DST: GTFS times 00:00-02:59 on DST dates follow the spec's noon-minus-12h rule literally; check how NJ Transit encodes them before real data ships (M2 gate).
- Age of cached data shows only when the browser reports offline; flaky tunnel signal needs a fetch timeout and age line (M4).
- `filterCsvByColumn` does not handle a quoted field containing a newline in stop_times (rare); add a warning.

## Next actions
1. M0: record 72 h of vehicle positions, trip updates, alerts and DepartureVision for Port Authority and the boarding stop; one-page go/no-go.
2. M2: build `corridor.json` from the real feed; compare 163/164/165/165T against published timetables (weekday, Saturday, Sunday, one holiday).
3. Owner usability test of the M1 build (5 scripted tasks each).
