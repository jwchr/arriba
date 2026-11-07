# Dale live bus relay

Issue #89 / D52. Implementation and deployment procedure: `docs/LIVE_BUS_PILOT.md`.

One free-plan Worker and one private SQLite-backed Durable Object. Canonical G2 static schedule, paced/coalesced vehicle-position and trip-update requests, token reuse, fixed official endpoints, bounded responses and strict trip/date matching. No raw archive, rider reports, phone location, rail polling, automatic deployment or paid plan. Credentials are owner-set secrets, never client configuration. Gates/push/72-hour archive remain later work.

`npm run worker:check` makes a synthetic fixture and verifies the bundle without deployment. The unit suite also exercises the real local Cloudflare/SQLite runtime with an entirely synthetic upstream. Production rejects the synthetic feed version. The manual reviewed-main workflow must prepare the official G2 feed before it can deploy.

Actual live readiness and real-ride acceptance must be checked separately from compilation, tests and merging. See issue #89's deployment evidence for current status.
