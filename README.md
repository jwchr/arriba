# Arriba

An independent NJ Transit bus companion for the Bergen County to Manhattan commute: saved commutes that open to the next bus with zero taps, all-day timetables, Port Authority gates, and (from milestone M3) live tracking of the exact bus you are riding.

> Independent app. Not affiliated with or endorsed by NJ Transit or the Port Authority of New York and New Jersey. The live build shows route 165 times **typed in from NJ Transit's printed timetable**: main timepoints only, no holiday schedules. Check njtransit.com before you rely on it. Add `?demo` to the address for the invented demo data.

- Live build: https://jwchr.github.io/arriba/ (printed route 165 timetable until the real NJ Transit feed is loaded)
- What V1 is: [`docs/V1_CONTRACT.md`](docs/V1_CONTRACT.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Status: [`docs/HANDOFF.md`](docs/HANDOFF.md)

## Develop

```sh
npm ci
npm run dev          # http://localhost:5173/?now=2026-11-04T07:50 pins the clock
npm run verify       # type check, unit tests, build, Playwright
npm run timetable -- --built-at <ISO>   # rebuilds the committed public/data/corridor.json from data/t0165/transcription.json
npm run gtfs -- path/to/bus_data.zip   # M2: writes public/data/corridor.json from NJ Transit's feed instead
```

Once the app runs on NJ Transit's data feed: schedule data was obtained from NJ Transit and is redistributed from Arriba's own server, not an NJ Transit server. This information may not be real time. Where the feed leaves a stop's time blank, the build script fills it in and the app shows it as an estimate (`~7:20 AM`).
