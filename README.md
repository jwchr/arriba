# Arriba

An independent NJ Transit bus companion for the Bergen County to Manhattan commute: saved commutes that open to the next bus with zero taps, all-day timetables, Port Authority gates, and (from milestone M3) live tracking of the exact bus you are riding.

> Independent app. Not affiliated with or endorsed by NJ Transit or the Port Authority of New York and New Jersey. The current build runs on **invented demo data**; do not use it to catch a real bus.

- Live build: https://jwchr.github.io/arriba/ (demo data until the real NJ Transit feed is loaded)
- What V1 is: [`docs/V1_CONTRACT.md`](docs/V1_CONTRACT.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Status: [`docs/HANDOFF.md`](docs/HANDOFF.md)

## Develop

```sh
npm ci
npm run dev          # http://localhost:5173/?now=2026-11-04T07:50 pins the clock
npm run verify       # type check, unit tests, build, Playwright
npm run gtfs -- path/to/bus_data.zip   # writes public/data/corridor.json (not committed)
```

Schedule data was obtained from NJ Transit and is redistributed from Arriba's own server, not an NJ Transit server, under NJ Transit's developer data terms. This information may not be real time. Where the feed leaves a stop's time blank, the build script fills it in and the app shows it as an estimate (`~7:20 AM`).
