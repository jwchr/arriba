# Penn Station pilot: guidance and schedule boundaries

Owner approval: D48/D49, 2026-11-05. First implementation: #79. Scheduled comparison: #80. No new paid service, automatic booking, location sharing or live collection.

The guide starts at the destination: New York Penn. Train options use Anderson Street or Essex Street (PVL, Hackensack), change at Secaucus, and include the reverse journey. Bus options use 165T, 163/164 at Summit & Essex, and 165 local with the final Port Authority–Penn leg. 144 is eligible for the supplied-timetable follow-up only where it serves that same corridor stop. Do not expand to 162/145/148 merely because they share the PDFs.

## Behavior

- Rehearsal and travelling modes are explicitly manual checklists. Changing origin, direction or mode restarts at step 1. Returning from an external ticketing page or restarting Dale preserves the saved checklist, never activates a ticket or declares a trip started. Demo choices never read or write the real checklist.
- Five steps explain planning, ticket purchase/activation, boarding, Secaucus fare gates and the connecting train, and arrival/return. The rider buys the complete origin–New York Penn rail journey via Secaucus, with a separate valid return journey. The guide does not promise cross-honoring on buses, subway, PATH or rideshare.
- Walking minutes are optional user notes, 0–120 per location, saved on this phone. No inferred home address, walking route or catchable connection.
- Missing/old vehicle GPS yields an obvious signal-loss warning only if a fix was previously received. The title does not diagnose a whole-agency outage. Source and age remain separate; demo loss is marked DEMO. Fresh phone/manual evidence is still distinguishable.
- A schedule marker continues to move under ESTIMATED POSITION ONLY. Actual reached stops, arrival, ahead/behind and get-off guidance never come from that marker. An overdue wait still says actual location unknown; the exact selected bus remains fixed.
- Show alternatives after signal loss, a due/unconfirmed wait, pass-up or official cancellation. Opening the guide, another scheduled trip, or a provider link does not replace the lock. Uber/Lyft receive no location or prefilled personal trip from Dale, and supply their own availability/quotes after the rider opens them.

## Guidance sources checked 2026-11-05

| Fact | Official source |
| --- | --- |
| Pascack Valley to Hoboken; transfer at Secaucus for New York Penn | https://www.njtransit.com/getting-new-york-train |
| Buying/activating before boarding, current track displays, conductor checks, short platforms | https://www.njtransit.com/ride-rail |
| One continuous journey between the ticket's stations | https://www.njtransit.com/tickets/rail-tickets |
| Barcode at Secaucus; expired-after-delay ticket details shown to staff | https://www.njtransit.com/web_ticketing_faqs |
| Mobile tickets and official app handoff | https://www.njtransit.com/app |
| Anderson Street (Pascack Valley) | https://www.njtransit.com/station/anderson-street-station |
| Essex Street (PVL, Hackensack), distinct from Jersey City's light rail stop | https://www.njtransit.com/station/essex-street-station-pvl |
| Destination/zone planning and distinct fares | https://www.njtransit.com/fares/ |
| Ticket before boarding at Port Authority; final NYC Transit fare separate | https://www.njtransit.com/tickets-and-fares |
| Live information checked by rider, no scraped integration | https://www.njtransit.com/trip-planner-to and https://www.njtransit.com/travel-alerts-to |
| Rider-initiated pickup handoffs | https://m.uber.com/ and https://www.lyft.com/rider |

The bus guide already in the app remains the source for detailed 165 payment instructions. The new guide makes no fixed platform, price, transfer guarantee or travel-time claim. Guidance is bundled for offline use; external ticketing and current information require connectivity. Recheck these sources when the guide changes.

## Supplied timetable inspection (not yet transcribed into production)

- `T1162.pdf`: two image-only pages, issued 9/5/26, routes 162/163 with limited 164 information. Weekday, Saturday and Sunday tables, both directions. Relevant timepoint: Hackensack, Summit Avenue & Essex Street. AM lightface, PM boldface; service variants and dashes must be preserved.
- `T1148.pdf`: two image-only pages, issued 9/5/26, routes 144/145/148/164. Includes 144 weekday and 164 weekday/weekend tables. Cross-check overlapping 164 entries with T1162 rather than adding duplicate departures. Do not infer 144 weekend service from an absent table.
- `PV-combined.pdf`: four text/table pages, regular timetable as of 8/30/26. Some trains skip one or both Hackensack stations. It includes printed Secaucus–Penn connections and special last-trip conditions; preserve the difference between a train and its connection.
- Known override: https://www.njtransit.com/portalcutover publishes temporary schedules effective 10/11–11/14/26. The provided regular Penn connection rows differ. A planned return to regular service is not confirmation. #80 must handle this before offering a current train-versus-bus arrival ranking.
- Bus holiday instructions refer the rider to the website; they do not provide all holiday departure times. Do not invent them. All printed schedules need a source/issued-date notice and an explicit unknown end date when absent.

Original documents and personal paths are not committed. Publication of a checked transcription is the bounded D49 exception; API credentials, live recordings and private backend work remain held.
