# Arriba V1 contract

The canonical, short definition of V1. Source: master spec v1.3 (archive) as amended by the independent review of 2026-10-31 and the owner's approvals the same day (`docs/DECISIONS.md`). Each issue links to the requirement ID it serves.

## Who and where
Household tool for Jeff and Diego. Bergen County corridor to and from Port Authority Bus Terminal. QA routes 163, 164, 165, 165T, both directions. Other NJ Transit bus data may load but is not QA'd.

## V1 must do
| ID | Capability | Milestone |
| --- | --- | --- |
| UX-01/02 | Zero-tap home: saved commutes in the rider's order, next 3 or 5 departures, one-tap reverse | M1 ✅ demo, M2 real |
| UX-03 | Stop search by name or code; wrong-side-of-street guard | M1 ✅ demo |
| UX-04 | All-day timetable, 7 days, holidays, after-midnight trips, DST-safe, 12-hour times | M1 ✅ demo, M2 real |
| BUS-01/02 | Exact-bus lock keyed to trip + service date; tracked / not tracked / not reporting / needs confirmation states | M1 ✅ logic, M3 live |
| GATE-01/03 | Port Authority gate and door per departure from NJ Transit DepartureVision; usual gate before posting; gate-change push | M1 ✅ logic, M3 live |
| UX-10 | Stop alerts 3, 2 and 1 stops before getting off, sent by the server from the locked bus (Web Push) | M3 |
| UX-09 | Ticket-before-boarding warning at Port Authority; Tap & Ride guidance in NJ; zone count only from a real fare table | M1 ✅ PABT warning, M4 rest |
| UX-07 | First-time-rider guide, English and Spanish | M1 ✅ languages, M4 guide |
| GATE-02 | Gate cards (floor, gate, door, nearest escalator or elevator, photo) for corridor gates | M4 |
| MAP-01/02 | Geographic map (MapLibre + OpenStreetMap); Clean, dark, Turnpike styles | M3-M4 |
| OFF-01 | Offline: last known schedule with its age | M1 ✅ service worker, M4 ✅ network timeout and saved-copy age |

## Not in V1
Native app, widgets, watch, Live Activities; personal location sharing; Smart ETA model; 511 incidents; indoor live dot; Parkway, subway and atlas skins; personal stats; Casting Director bridge; e-ink display; public launch.

## Done means
Tests prove it (`npm run verify`), the Pages build shows it, and for live features the owner's real rides confirm it (M3 acceptance in the review doc).
