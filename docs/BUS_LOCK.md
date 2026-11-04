# Bus Lock and the journey home

Owner-requested refinement, 2026-11-04. Implements BUS-01/02; extends the waiting and riding experience. The selected unit is a departure at a boarding stop on a service date, not every bus carrying the same route number.

## This implementation

- Select a departure and lock it. The route, service date, boarding stop and scheduled time remain fixed. The home screen offers a way back even after that time has passed.
- Start an explicit waiting session. “No bus yet” becomes available at the scheduled time. The report covers only the interval since that rider began the check-in.
- “Bus arrived,” “I boarded,” “Passed without stopping,” and “I left the stop” are distinct observations. Arrival does not imply boarding; leaving does not imply either arrival or cancellation.
- Request screen wake while the waiting view is open, with a visible toggle and the actual browser result. Release when waiting ends. An unsupported, rejected or released wake lock never claims success.
- Show last accepted GPS time, age, vehicle, coordinates and source. Receipt time is separately labeled. The history retains at most 120 accepted observations in memory and does not imply an earlier archive.
- Preserve the last observed location when data ages. A separate, dashed estimate describes timetable progress between listed stops. It is labeled **ESTIMATED FROM TIMETABLE · NOT GPS**.
- Once the selected time has passed and the rider is still waiting, the projection becomes **Overdue · location unknown**. It does not animate a fictional bus past the observer or promise a new ETA.
- Conflicting vehicle identity requires confirmation. A same-trip replacement can be accepted; a different departure requires an explicit new selection.
- Reports are local to the current visit. The UI says that they are not sent to other riders and that no phone location is collected. Refreshing/closing the page can lose this local session. There is no background tracking or live community backend in this slice.
- The printed-timetable build has no live observations or geographic coordinates. Only the explicitly labeled invented demo exposes simulation controls for fresh GPS, time advancing without new signals, and a replacement vehicle.
- An outbound trip to Port Authority also shows the last listed return on the exact selected line to the reverse home stop, one earlier usable option, and the following departure. Calendar dates accompany all times; 165 and 165T are never silently substituted. Opening a return trip preserves any existing Bus Lock until explicitly unlocked.

## Evidence contract

| Evidence | Timestamp | Meaning |
| --- | --- | --- |
| Official vehicle GPS | The vehicle observation time | A reported location of a matched vehicle, with freshness shown |
| Receipt time | When Dale received the record | Transport freshness only; does not make old GPS new |
| Timetable projection | Calculation time plus dated timetable source | Where the schedule would put a trip; no proof of operation |
| No-bus observation | Rider action time plus waiting-since time | This observer has not seen the selected departure during that interval |
| Arrival/boarding report | Rider action time | An observation, not an official assignment or automatic location-sharing consent |
| Presence heartbeat, future backend | Last contact with the client | Contact only; never a new no-bus observation |

An expired GPS report, an overdue timetable and a rider report do not establish cancellation. Only an explicit official cancellation produces that status. Actual observations and estimates remain distinguishable in text, not only color. Missing history remains a gap.

## Downstream sharing, when connected

The pure selector in `src/domain/busLock.ts` is the testable contract, not a deployed sharing service:

1. Match the exact trip instance, including service date. Validate stop membership and sequence on the server.
2. Show a report only at a later stop on that trip. Do not warn opposite-direction or tomorrow's riders.
3. Use a server-validated ephemeral session identifier. Repeat taps update one observation, not multiple votes.
4. Publish the stop, observation type, reported time and covered waiting interval. Do not publish a rider name, device identifier or raw waiting-phone trail.
5. Expire old reports server-side. The current pure helper's ten-minute default is a provisional UI lifetime, not a measured operational confidence rule; calibrate it on real rides.
6. A newer arrival, boarding or pass-up at the same stop supersedes its older no-bus warning. Preserve pass-up reports as a distinct observation. The observer who saw the bus pass cannot then assert "no bus seen" for that departure. Conflicting sources remain distinguishable.
7. A closed or suspended page ends fresh presence. Mobile shutdown events are unreliable, so a backend must use expiring presence rather than rely on a goodbye request.
8. Display one report as unconfirmed. Multiple people at one stop still cannot prove a cancellation. Do not count one person's repeated actions as independent confirmation.

## Optional onboard contribution

This is explicitly requested future functionality, not collection enabled by this patch.

- Waiting-phone GPS can help the rider confirm their stop locally. It is never vehicle GPS.
- Only after “I boarded,” offer a separate “Share this bus's location” choice with a visible stop-sharing control.
- Verify the trip/vehicle match as far as available evidence permits. Label rider-derived positions separately from agency GPS.
- Publish only the bus-trip observation needed by downstream riders. Do not expose a rider identity or journey to/from their home.
- Pause when the page is hidden, permission is lost or the session expires. Do not silently restart sharing after an uncertain interruption.
- Movement away from a stop can mean walking, another bus or bad GPS. Prompt for boarded/left; never silently choose.
- No continuous background geolocation is promised. Server-sent official-bus notifications can be developed independently of collecting phone GPS.

## Owner's additional approved features

### GPS-assisted fare zones

GPS suggests nearby boarding stops. The rider confirms the stop and direction, enters a destination, and Dale selects a compatible trip and applies the authoritative fare table. Distance alone is not a fare rule. Near a zone boundary or ambiguous stop, show the uncertainty and the relevant choice. A precise boundary map requires authoritative usable boundary geometry; the current printed fare illustration does not justify invented geofences.

Implemented (issue #31): stop search offers an opt-in "Stops near me" (`NearMe`, `nearbyStops` in `src/domain/direction.ts`) that asks the browser for one position, lists served stops within 500 m with straight-line distance and the phone's stated accuracy (a warning above 150 m), and lets the rider pick; the direction guard and destination step are unchanged and fares still come from the printed fare table. Only the stop list and accuracy outlive the callback; the position is never stored, logged or sent. Datasets without stop coordinates (the printed route 165 data) get a note instead of the button. Waiting for M2: route 165 stop coordinates. A zone-border map still needs authoritative boundary geometry.

### “Get me the fuck home”

Household-facing rescue action. Search beyond the usual route for compatible arrivals near the saved home destination. Rank by arrival time, walking, transfers and the remaining gap, with clear gates, last boarding times and data freshness. Include walking-only finishes or a separately identified ride from the final stop when available; never imply a near-home result reaches the front door. A straight-line distance is not a verified walking route. Respect the user's chosen walking and transfer limits. Missing data must not be presented as proof that no transport exists.

The present dataset includes only route 165 timepoints. A credible cross-route rescue search needs the wider schedule, coordinates and suitable walking/connection data; availability and freshness of each connection must be shown. Do not invent 166/167/168 options from their route numbers.

### Last-chance return

On an outbound trip into NYC, show the last scheduled return on the selected line that actually reaches the reverse home stop. Include after-midnight service, dates and calendar exceptions. Keep a departure's own timepoint estimate marker where applicable. If service continues beyond the inspected window, do not label the cutoff as the last bus. If the printed data has no holiday schedule or an eligible stop is missing, show an unconfirmed result. The rescue action is a separate fallback, not a reason to conceal a weak last-return claim.

Implemented as `src/domain/lastReturn.ts` and `LastReturnCard`: the card says "last listed" for the selected operating day and always identifies the next listed departure when known. The helper's explicit 5 AM comparison window flags other service days' overnight trips; it never selects the final trip by that cutoff. The following departure is searched through seven later calendar dates. Absence beyond that search or incomplete calendars means unconfirmed, not no service. Printed timetable validity is unknown and is disclosed on the card. Background reminders and cross-route rescue are not part of this patch.

### Capacity and historical patterns

Official MyBus describes light/medium/heavy/no-data occupancy. Availability in the app's authorized feed is still unverified. Accept explicit rider observations such as seats available, standing, appeared full and passed without stopping. Keep observation time, source and trip context. Unknown is not empty; occupancy of an arriving vehicle is not terminal queue length. A historical summary must display sample count and date range and be labeled a past pattern, separately from today's conditions. Do not build or publish a historical dataset until the necessary private storage and collection controls exist.

Implemented locally (issue #33): Bus Lock offers "Seats available", "Standing room only" and "Looked full" to a rider who saw the bus (after "Bus arrived", on board, or after "Passed without stopping"). Each is a timestamped `capacity` report, one per session (a new tap replaces it), kept on the phone for the visit and listed in the rider's observations. It never counts as, or supersedes, a no-bus or pass-up warning. The screen says there is no history of usual crowding and that NJ Transit's crowding data is not connected. Still to do, gated: check whether the authorized NJ Transit feeds carry occupancy (developer access), private storage and validation for shared reports, and dated historical patterns with sample counts.

### Ride mode and get-off guidance

After explicit boarding, show the destination, upcoming actual stops and large 3/2/1-stop warnings, followed by an instruction for when to request the stop and where to get off. At the destination, show a prominent arrival card. Provide English and Spanish, large text, non-color cues and optional sound/vibration where supported. Do not obstruct ticket display or make warnings impossible to dismiss.

Implemented as `src/domain/rideGuide.ts` and `RideMode` (issue #34). The countdown needs GPS that is `tracked` and under two minutes old, within 400 m of the trip's line, unambiguous (no other non-adjacent part of the route within 100 m of the best match), on a dataset that is not a printed transcription; a bus within 60 m of a stop counts as at it. A recent fix (under two minutes) up to 100 m further along absorbs backward jitter in the newest one; a recent fix more than 100 m ahead means the readings disagree, and Dale stops counting until they agree. The end of the line cannot be passed. Limits to check on real rides at M3 (from review): the newest fix is trusted alone, so add a speed check (an along-route jump faster than about 35 m/s since the previous fix should be 'inconsistent'), and before "press now" or "arrived" use the less advanced of two fixes within the jitter allowance; where stops are under about 100 m apart every fix at a stop is ambiguous, so the count comes and goes; a GPS error above about 140 m on parallel streets can still pass the ambiguity check. "Press now" appears only after the bus has left the stop before the rider's; the end of the line gets "the bus stops there" instead; a bus beyond the rider's stop gets "may have passed your stop". Otherwise the view states the reason (no GPS, old GPS, vehicle in question, cancelled, off route, ambiguous, behind the boarding stop, printed timepoints only) and shows scheduled times labeled as timetable. An exact stop count needs the complete trip stop sequence, not only printed timepoints. If GPS or matching becomes uncertain, show that prominently; a timetable estimate must not confidently tell someone to pull the cord at a particular location. Full-screen guidance works while the app is open; background delivery needs the planned supported notification path and actual-phone verification.

## Data and release gates

The existing hold on NJ Transit collection/integration remains in force until developer approval/access is available. No new service, package, credential or paid plan is introduced here. The existing planned Worker is the integration point; its deployed storage, validation and privacy controls are not supplied by a static GitHub Pages build. A geographic map also needs verified geometry and the previously required tile-provider decision.

## Verification

State tests cover stale refetches, invalid/future positions, ordering, identity conflicts, overdue projections, late check-in coverage, leaving versus boarding, report deduplication and downstream expiry. Wake-lock tests cover lifecycle, rejection and request races. Browser flows cover waiting through loss of signal, history, local-only reports, replacement confirmation, returning to a locked trip, printed-data honesty, Spanish and narrow-screen accessibility.

Last-return tests cover the real printed after-midnight trip, distinct 165T service, stop eligibility, overnight continuation, missing calendars, holiday exceptions and unknown printed holiday service. The browser flow checks actual calendar dates and navigation to the correct reverse stop.

Real phone acceptance remains necessary for wake lock, background/resume behavior, and eventual server push and onboard GPS. No simulation substitutes for a measured ride.

## Primary browser references

- [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API): visible-document requirement, rejection and release handling.
- [WebKit Safari 18.4 release](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/): Home Screen web-app wake-lock support from iOS/iPadOS 18.4.
- [W3C Geolocation](https://www.w3.org/TR/geolocation/): permission, observation timestamp/accuracy, visible-document updates and purpose-limited use. Current document is a Candidate Recommendation Draft; verify implementation on actual phones.
- [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): mobile lifecycle and unreliable termination events.

Checked 2026-11-04.
