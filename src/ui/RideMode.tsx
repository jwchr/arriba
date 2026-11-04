// Ride mode (issue #34): shown after the rider says "I boarded". Big get-off guidance when Dale can
// honestly count stops (every stop listed, fresh unambiguous bus GPS); otherwise a plain statement of
// what it cannot know, with scheduled times labeled as timetable. Foreground only: no background alerts.
import { useEffect, useState } from 'react';
import type { BusSession, BusSessionEvent } from '../domain/busLock';
import { rideGuide, STAGE_RANK, type RideStage } from '../domain/rideGuide';
import { tripStopTimes } from '../domain/schedule';
import { formatTime12 } from '../domain/time';
import type { Dataset } from '../domain/types';
import type { Lang, Strings } from './i18n';

interface Props {
  ds: Dataset;
  session: BusSession;
  alightIndex: number;
  now: number;
  t: Strings;
  lang: Lang;
  onEvent: (event: BusSessionEvent) => void;
  /** Invented demo only: moves the demo clock, so each simulated position is newer than the last. */
  onAdvanceDemo: (minutes: number) => void;
}

// Per-viewer conveniences only; the page works the same when storage is unavailable.
const PREFS = 'arriba.ride.v1';
const readPrefs = (): { large: boolean; vibrate: boolean } => {
  try {
    const p = JSON.parse(window.localStorage.getItem(PREFS) ?? '{}') as { large?: boolean; vibrate?: boolean };
    return { large: p.large !== false, vibrate: p.vibrate === true };
  } catch { return { large: true, vibrate: false }; }
};
/** Highest alert stage already given per Bus Lock session, so jitter or a remount never repeats one. */
const alerted = new Map<string, number>();
const URGENT: RideStage[] = ['one', 'request', 'last_next', 'arrived', 'passed'];

export function RideMode({ ds, session, alightIndex, now, t, lang, onEvent, onAdvanceDemo }: Props) {
  const r = t.ride;
  const dep = session.departure;
  const stopName = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  const clock = (at: number) => formatTime12(at, ds.meta.timezone, lang);
  const [prefs, setPrefs] = useState(readPrefs);
  const setPref = (p: Partial<typeof prefs>) => setPrefs((old) => {
    const next = { ...old, ...p };
    try { window.localStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* not saved */ }
    return next;
  });
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const hasDestination = alightIndex > dep.stopIndex;
  const guide = hasDestination ? rideGuide(ds, dep.pattern.stopIds, dep.stopIndex, alightIndex, session.lock, now, session.history) : undefined;
  const times = tripStopTimes(ds, dep);
  const dest = hasDestination ? stopName(dep.pattern.stopIds[alightIndex]!) : '';
  const stage = guide?.basis === 'gps' ? guide.stage : undefined;

  // Vibrate only when the countdown moves forward to 3, 2, 1 or "ask now", once each, if turned on.
  useEffect(() => {
    if (!stage) return;
    const rank = STAGE_RANK[stage];
    const before = alerted.get(session.id) ?? -1;
    if (rank <= before) return;
    alerted.set(session.id, rank);
    if (prefs.vibrate && canVibrate && rank >= 1 && rank <= 4 && before >= 0) navigator.vibrate([200, 100, 200]);
  }, [stage, session.id, prefs.vibrate, canVibrate]);

  if (!hasDestination || !guide) return <p className="small">{r.noDestination}</p>;

  const message = guide.basis === 'gps'
    ? guide.stage === 'arrived' ? r.arrived(dest)
      : guide.stage === 'passed' ? r.passed(dest)
        : guide.stage === 'request' ? r.request(dest)
          : guide.stage === 'last_next' ? r.lastNext(dest)
            : guide.stage === 'one' ? r.one(dest)
              : r.stopsTo(guide.stopsAway, dest)
    : guide.basis === 'timetable_only' ? r.timetableOnly : r.uncertain[guide.reason];
  const after = guide.basis === 'gps' ? guide.reachedIndex : dep.stopIndex;
  const upcoming = times.map((x, i) => ({ ...x, i })).filter((x) => x.i > after && x.i <= alightIndex);

  // Invented demo only: a minute later, the simulated bus reports from the next stop's coordinates.
  function demoNextStop() {
    if (!ds.meta.demo) return;
    const next = guide && guide.basis === 'gps' ? guide.reachedIndex + 1 : dep.stopIndex + 1;
    const stop = ds.stops.find((s) => s.id === dep.pattern.stopIds[Math.min(next, alightIndex)]);
    if (stop?.lat === undefined || stop.lon === undefined) return;
    const later = now + 60_000;
    onAdvanceDemo(1);
    onEvent({ type: 'observation', obs: { tripInstanceId: dep.tripInstanceId, vehicleId: session.lock.vehicleId ?? 'DEMO-BUS', observedAt: later, lat: stop.lat, lon: stop.lon }, source: 'demo', receivedAt: later });
  }

  return (
    <div className="ride-mode" data-large={prefs.large ? 'true' : undefined} data-stage={stage ?? guide.basis}>
      <h3>{r.title(dest)}</h3>
      <p className="ride-message" aria-live={stage && URGENT.includes(stage) ? 'assertive' : 'polite'}>{message}</p>
      {guide.basis === 'gps' && <p className="small">{session.history.at(-1)?.source === 'demo' ? r.demoGps : r.fromGps(clock(guide.observedAt), Math.max(0, Math.floor((now - guide.observedAt) / 1000)))}</p>}
      {guide.basis !== 'gps' && times[alightIndex] && <p className="small">{r.scheduledAt(`${times[alightIndex]!.estimated ? '~' : ''}${clock(times[alightIndex]!.at)}`)}</p>}
      <div className="row-between ride-controls">
        <button className="ghost" onClick={() => setPref({ large: !prefs.large })}>{prefs.large ? r.smaller : r.larger}</button>
        <label className="lock-toggle"><input type="checkbox" checked={prefs.vibrate} disabled={!canVibrate} onChange={(e) => setPref({ vibrate: e.target.checked })} />{r.vibrate}</label>
      </div>
      {!canVibrate && <p className="muted small">{r.vibrateUnsupported}</p>}
      <h4>{guide.basis === 'timetable_only' ? r.upcomingListed : r.upcoming}</h4>
      <ol className="stop-list ride-stops">
        {upcoming.map((x) => (
          <li key={`${x.stopId}-${x.i}`} data-role={x.i === alightIndex ? 'alight' : undefined}>
            <span className="stop-time">{x.estimated ? '~' : ''}{clock(x.at)}</span>
            <span className="stop-name">{stopName(x.stopId)}</span>
            {x.i === alightIndex && <span className="tag tag-alight">{t.getOffHere}</span>}
          </li>
        ))}
      </ol>
      <p className="muted small">{r.ticket}</p>
      <p className="muted small">{r.foreground}</p>
      {ds.meta.demo && guide.basis !== 'timetable_only' && <button onClick={demoNextStop}>{r.demoNext}</button>}
    </div>
  );
}
