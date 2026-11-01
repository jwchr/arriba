# Worker (milestone M3, not built yet)

One Cloudflare Worker: polls NJ Transit (GTFS-RT vehicle positions, trip updates, alerts; BUSDV2 DepartureVision for Port Authority and corridor stops), serves a small read API, sends Web Push for locked trips, and writes the corridor-only archive to R2. Credentials come from Worker secrets set by the owner. Built after the M0 data spike decides polling intervals and the free-plan CPU question.
