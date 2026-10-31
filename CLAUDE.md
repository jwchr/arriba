# Arriba: development rules for Claude

**Goal:** the most useful, trustworthy North Jersey to Manhattan NJ Transit bus app with the least engineering.
Read `docs/V1_CONTRACT.md` (what V1 is) and `docs/HANDOFF.md` (where things stand) at the start of every session and after compaction. The 805-line master spec v1.3 is an archive; do not load it unless an issue links to a section of it.

## Product rules (owner decisions; see docs/DECISIONS.md)
- Household tool first (Jeff and Diego), built so it could go public later. No accounts in V1.
- Never invent live data. Every live bus, gate, zone or estimate carries its source and age; unknown is a valid answer. A bus that stops reporting is "not reporting", never "cancelled", unless NJ Transit says so.
- Exact-bus lock never switches buses silently (`src/domain/lock.ts`). Favorites keep the rider's order. A gate is never inferred from a route number.
- English and Spanish for every string (`src/ui/i18n.ts`); 12-hour times in both.
- Demo data must show the DEMO banner (`meta.demo`). Real data comes only from NJ Transit feeds via `scripts/build-gtfs.mjs` and, from M3, the Worker.
- Independent app: never use NJ Transit or Port Authority logos, or imply endorsement.

## Data and privacy
- NJ Transit data terms apply (server-side storage, 40,000 requests/day per API, attribution, latency disclosure). The owner reported NJ Transit's OK for archiving on 2026-10-31; keep the archive corridor-only and private.
- This repository is public. Never commit NJ Transit credentials, tokens, recorded feed responses, rider locations or personal data. Credentials live only in repository or Cloudflare secrets set by the owner.

## Engineering
- Smallest working, tested vertical slice first. One web app (`src/`) and, from M3, one Worker (`worker/`); no new packages until two real consumers exist.
- Domain logic is pure TypeScript in `src/domain/` with unit tests in `tests/unit/`; UI flows in `tests/e2e/` (Playwright, Pixel 7, pinned `?now=`).
- Run `npm run verify` locally before every push and batch related fixes into one push. CI runs on pull requests and main only.
- Use standard libraries (GTFS-Realtime bindings, MapLibre) over custom parsers when the need arrives; record license and version.

## Autonomous development (copied from VPM and Life Dashboard policy, 2026-10-30/31)
- **Safety holds:** pause only the affected operation on a credible security, privacy, cost, irreversible-action or data-integrity concern; one `🚨 ACTION REQUIRED — SAFETY HOLD` note naming the single owner decision needed; a new run never clears a hold by itself.
- **Merging:** a PR merges only with green CI on the exact head and a clean review of that head by a reviewer that did not write it. For Arriba the reviewer is a separate Claude session or subagent; Codex review quota is reserved for VPM and Life Dashboard except PRs labeled `security`. Every finding is fixed or answered. Squash merge with the expected head SHA. A merge is not a deployment claim; check the Pages URL separately.
- **Queue:** at most one implementation PR in flight. Never create an issue just to fill an empty queue, never duplicate an issue that already has a branch or PR, and claim before building (one issue comment).
- **Models:** Sonnet/high for docs, tests and mechanical changes (`routine-sonnet` subagent); Opus/high for data pipeline, lock, gate, privacy and architecture. No paid credits or new services without the owner.
- **Unattended runs:** none yet. A scheduled Arriba steward starts only after Life Dashboard issue #13 proves a full unattended cycle (owner decision 10).
- State plainly what is built, tested, deployed and unverified. Owner wants short, plain answers; escalate only real blockers (credentials, money, device testing, product decisions).
