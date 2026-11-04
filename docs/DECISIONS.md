# Decision log

Owner decisions D01-D29 live in master spec v1.3 (archive). Entries below are new or amend them; superseded items are kept, not deleted.

| ID | Date | Decision | Amends |
| --- | --- | --- | --- |
| D30 | 2026-10-31 | Owner reconciled the Claude and ChatGPT reviews and approved Claude's 12 recommendations as written ("Arriba v1.3 Independent Review", Claude Docs). | - |
| D31 | 2026-10-31 | Household first (Jeff and Diego), designed to go public later after NJ Transit's written permission. | D16, D19 |
| D32 | 2026-10-31 | Public GitHub repository `jwchr/arriba` (free Actions minutes; no secrets or recorded data committed). | D29 |
| D33 | 2026-10-31 | Owner reports NJ Transit's OK for archiving; archive starts when credentials work, corridor-only and private. | D10, P0-03 |
| D34 | 2026-10-31 | Web app (PWA) with server-sent Web Push for V1; native wrapper (Capacitor) decided at V1.5 from measured push latency. | D03 |
| D35 | 2026-10-31 | Gate source is NJ Transit's API, not the Port Authority. Gate cards replace the indoor routing graph in V1; live indoor dot dropped unless the Port Authority deploys positioning. | D23, D24 |
| D36 | 2026-10-31 | V1 skins: Clean, dark, Turnpike. Parkway, subway variants and atlas move to V2. | D17, D27 |
| D37 | 2026-10-31 | Delay charts: default plain sentence plus strip; A/B/C behind a tap; add day-by-time heatmap. | D11, D18 |
| D38 | 2026-10-31 | Arriba uses a non-author Claude reviewer; Codex review quota stays with VPM and Life Dashboard except security PRs. | D29 |
| D39 | 2026-10-31 | Interactive sessions build M0-M2; an unattended Arriba steward only after Life Dashboard #13 closes. | D15 |
| D40 | 2026-10-31 | Canonical working documents are `docs/V1_CONTRACT.md` and the issue backlog; master spec v1.3 is the archive. | 20.4 rule 1 |
| D41 | 2026-10-31 | Cloudflare Workers paid plan only if the free 10 ms CPU limit fails in the spike. GitHub Pages hosts the web app meanwhile. | 9.2 |
| D42 | 2026-11-01 | Until the NJ Transit GTFS arrives, the app is populated from the owner-supplied printed route 165 timetable (typed in, clearly labeled, timepoints only). Printed gate rules are shown as "published" gates, never as this bus's posted gate. This is not M2 and starts no data collection. | D35 |
| D43 | 2026-11-04 | The app is called Dale (was Arriba). Rider-facing name, docs and data source line change; storage keys, cache and header names keep `arriba` so saved commutes and offline copies survive; the repository moved to `jwchr/dale` and the site to https://jwchr.github.io/dale/ the same day, on the owner's word (no home-screen installs yet; the old `/arriba/` address no longer works). | D32 |
| D44 | 2026-11-04 | Owner requests Bus Lock now: selected departure/stop, actual position history and signal age, explicit schedule estimates on GPS loss, screen wake during waiting, no-bus/arrival/leaving reports and future downstream contribution. Build the local waiting/evidence slice now; live data and shared reporting remain gated by access and the planned private backend. Optional future onboard bus-location contribution requires separate consent; personal identity/location sharing is still excluded. See `docs/BUS_LOCK.md`. | BUS-01/02, V1 location-sharing exclusion only as specified |
| D45 | 2026-11-04 | Owner requests GPS-assisted zone calculation, a near-home rescue action (household label “Get me the fuck home”), a last same-line return shown on outbound trips, capacity reports/history, and prominent 3/2/1-stop get-off guidance. Use authoritative data and explicit uncertainty; do not infer fare borders, walking routes or intermediate stops from the limited print. See `docs/BUS_LOCK.md` for behavior and data gates. | UX-09, UX-10, return planning |
| D46 | 2026-11-04 | Owner asks for the Turnpike, Parkway and NYC styles now and for bigger From/To signs and richer graphics. Styles: Turnpike (default), Parkway, NYC subway, Clean (light/dark); each has its own background scene, signs, route badges and departure rows, chosen in Settings. Original artwork only: no official shields, logos or sign designs (NJ Turnpike Authority, Garden State Parkway, MTA, NJ Transit, Port Authority). Text is never drawn straight on a scene (panels behind it); reduced transparency and forced colors drop the scenes. | D36 (Parkway and subway brought into V1) |
