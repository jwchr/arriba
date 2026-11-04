# Dale V1 contract

The canonical, short definition of V1. Source: master spec v1.3 (archive) as amended by the independent review of 2026-10-31 and the owner's approvals the same day (`docs/DECISIONS.md`). Each issue links to the requirement ID it serves.

## Who and where
Household tool for Jeff and Diego. Bergen County corridor to and from Port Authority Bus Terminal. QA routes 163, 164, 165, 165T, both directions. Other NJ Transit bus data may load but is not QA'd.

## V1 must do
| ID | Capability | Milestone |
| --- | --- | --- |
| UX-01/02 | Zero-tap home: saved commutes in the rider's order, next 3 or 5 departures, one-tap reverse | M1 ✅ demo, ✅ printed route 165 (D42) with the Port Authority gate on rows that board there, M2 real |
| UX-03 | Stop search by name or code; wrong-side-of-street guard | M1 ✅ demo, ✅ printed route 165: town-first search, every reachable stop, guard through named twins, reverse from across the street |
| UX-04 | All-day timetable, 7 days, holidays, after-midnight trips, DST-safe, 12-hour times | M1 ✅ demo, ✅ printed route 165 (after-midnight, DST as printed with notes, holiday warning: the print has no holiday times), M2 real |
| BUS-01/02 | Exact-bus lock keyed to trip + service date + boarding stop; signal age/history, explicit estimates, waiting reports and foreground screen wake (`docs/BUS_LOCK.md`) | Local UI/domain slice; M3 live + shared reports |
| GATE-01/03 | Port Authority gate and door per departure from NJ Transit DepartureVision; usual gate before posting; gate-change push | M1 ✅ logic, M3 live |
| UX-10 | Stop alerts 3, 2 and 1 stops before getting off, sent by the server from the locked bus (Web Push) | M3 |
| UX-09 | Ticket-before-boarding warning at Port Authority; Tap & Ride guidance in NJ; zone count only from a real fare table | M1 ✅ PABT warning, M4 ✅ printed route 165 cash fare and zone count, ✅ Tap & Ride steps in the guide |
| UX-07 | First-time-rider guide, English and Spanish | M1 ✅ languages, M4 ✅ route 165 first-ride guide |
| GATE-02 | Gate cards (floor, gate, door, nearest escalator or elevator, photo) for corridor gates | M4: needs owner photos and notes from Port Authority (no official source found for floors and escalators) |
| MAP-01/02 | Geographic map (MapLibre + OpenStreetMap); Clean, dark, Turnpike styles | M3-M4: needs stop coordinates (M2 feed; the print has none) and an owner choice of map tile provider |
| OFF-01 | Offline: last known schedule with its age | M1 ✅ service worker, M4 ✅ network timeout and saved-copy age |

## Not in V1
Native app, widgets, watch, Live Activities; personal identity/location sharing (D44 permits only future separate opt-in to contribute a bus-trip location); Smart ETA model; 511 incidents; indoor live dot; Parkway, subway and atlas skins; personal stats; Casting Director bridge; e-ink display; public launch.

## Owner additions, 2026-11-04

D45 adds GPS-assisted fare zones, a near-home rescue search, last same-line return guidance, capacity observations/history and full-screen get-off guidance. `docs/BUS_LOCK.md` defines the behavior and dependency boundaries. Printed timepoints alone cannot supply route geography, fare boundary polygons, nearby alternatives, exact intermediate-stop counts or current capacity. These additions do not lift the existing live-data/collection hold.

## Done means
Tests prove it (`npm run verify`), the Pages build shows it, and for live features the owner's real rides confirm it (M3 acceptance in the review doc).
