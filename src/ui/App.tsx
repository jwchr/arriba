import { useEffect, useMemo, useState } from 'react';
import { demoDataset, demoUsualGates } from '../data/demo';
import { alightingStopFor, checkDirection, searchStops } from '../domain/direction';
import { addFavorite, loadFavorites, moveFavorite, removeFavorite, renameFavorite, saveFavorites, type Favorite } from '../domain/favorites';
import { gateFor, type GateAnswer } from '../domain/gate';
import { isNjtHoliday } from '../domain/holidays';
import { createLock, type TripLock } from '../domain/lock';
import { departuresOn, nextDepartures, tripStopTimes } from '../domain/schedule';
import { addDays, formatTime12, localYmd, weekdayIndex, zonedWallTime } from '../domain/time';
import type { Dataset, Departure, Stop } from '../domain/types';
import { strings, type Lang, type Strings } from './i18n';
import { TicketGuide } from './TicketGuide';

type Theme = 'system' | 'light' | 'dark';
interface Settings { lang: Lang; theme: Theme; count: 3 | 5 }
interface Leg { fromStopId: string; toStopId: string; routeIds: string[] }
type Screen =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'timetable'; leg: Leg; title: string }
  | { name: 'departure'; dep: Departure; leg: Leg }
  | { name: 'settings' };

const store = (() => { try { return window.localStorage; } catch { return undefined; } })();
const readSettings = (): Settings => {
  try {
    const s = JSON.parse(store?.getItem('arriba.settings.v1') ?? '{}') as Partial<Settings>;
    return { lang: s.lang === 'es' ? 'es' : 'en', theme: s.theme ?? 'system', count: s.count === 5 ? 5 : 3 };
  } catch { return { lang: 'en', theme: 'system', count: 3 }; }
};

/** `?now=2026-11-04T07:50` pins the clock (New York wall time) for demos and tests. */
function useNow(tz: string): number {
  const pinned = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('now') ?? '');
    return m ? zonedWallTime(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz) : undefined;
  }, [tz]);
  const [now, setNow] = useState(() => pinned ?? Date.now());
  useEffect(() => {
    if (pinned !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [pinned]);
  return pinned ?? now;
}

function useDataset(): Dataset {
  const [ds, setDs] = useState<Dataset>(demoDataset);
  useEffect(() => {
    if (new URLSearchParams(location.search).has('demo')) return;
    fetch(`${import.meta.env.BASE_URL}data/corridor.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Dataset>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (d && Array.isArray(d.trips) && d.trips.length) setDs(d); })
      .catch(() => { /* no real dataset published yet: stay on the labeled demo */ });
  }, []);
  return ds;
}

export function App() {
  const ds = useDataset();
  const tz = ds.meta.timezone;
  const now = useNow(tz);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites(store));
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [lock, setLock] = useState<TripLock | undefined>();
  const [reversedIds, setReversedIds] = useState<Set<string>>(() => new Set());
  const toggleReversed = (id: string) => setReversedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const t = strings[settings.lang];

  useEffect(() => saveFavorites(store, favorites), [favorites]);
  useEffect(() => {
    try { store?.setItem('arriba.settings.v1', JSON.stringify(settings)); } catch { /* ignore */ }
    document.documentElement.lang = settings.lang;
    if (settings.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  const stopName = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  const ctx: Ctx = { ds, tz, now, t, lang: settings.lang, stopName };

  return (
    <div className="app">
      <header className="top">
        {screen.name !== 'home' ? (
          <button className="icon-btn" onClick={() => setScreen({ name: 'home' })} aria-label={t.back}>‹</button>
        ) : <span className="wordmark" role="img" aria-label="Arriba">ARRIBA<span className="bang" aria-hidden="true">!</span></span>}
        <button className="icon-btn" onClick={() => setScreen({ name: 'settings' })} aria-label={t.settings}>⚙</button>
      </header>
      {ds.meta.demo && <div className="demo-banner" role="note">{t.demoBanner}</div>}
      {ds.meta.transcribed && <div className="data-banner" role="note">{t.transcribedBanner(fmtYmd(ds.meta.transcribed.issued))}</div>}
      <FeedStatus ctx={ctx} />
      {ds.meta.transcribed && isNjtHoliday(localYmd(now, tz)) && <p className="status-line" data-level="warn" role="note">{t.holidayToday}</p>}
      <main>
        {screen.name === 'home' && (
          <Home ctx={ctx} favorites={favorites} count={settings.count} setFavorites={setFavorites} reversedIds={reversedIds} toggleReversed={toggleReversed}
            onSearch={() => setScreen({ name: 'search' })}
            onAllDay={(leg, title) => setScreen({ name: 'timetable', leg, title })}
            onDeparture={(dep, leg) => setScreen({ name: 'departure', dep, leg })} />
        )}
        {screen.name === 'search' && (
          <Search ctx={ctx} onSave={(f) => { setFavorites((l) => addFavorite(l, f)); setScreen({ name: 'home' }); }} />
        )}
        {screen.name === 'timetable' && (
          <Timetable ctx={ctx} leg={screen.leg} title={screen.title} onDeparture={(dep) => setScreen({ name: 'departure', dep, leg: screen.leg })} />
        )}
        {screen.name === 'departure' && (
          <DepartureDetail ctx={ctx} dep={screen.dep} leg={screen.leg}
            lock={lock?.tripInstanceId === screen.dep.tripInstanceId ? lock : undefined}
            onLock={() => setLock(createLock(screen.dep.tripInstanceId, now))}
            onUnlock={() => setLock(undefined)} />
        )}
        {screen.name === 'settings' && <SettingsScreen ctx={ctx} settings={settings} setSettings={setSettings} />}
      </main>
      <footer className="foot">
        <p>{t.notAffiliated}</p>
        <p>{dataNotice(ds, t)}</p>
      </footer>
    </div>
  );
}

const fmtYmd = (d: string) => `${+d.slice(4, 6)}/${+d.slice(6, 8)}/${d.slice(0, 4)}`;

interface Ctx { ds: Dataset; tz: string; now: number; t: Strings; lang: Lang; stopName: (id: string) => string }

/** Offline state and schedule validity, so a stale or expired feed is never mistaken for "no buses". */
function FeedStatus({ ctx }: { ctx: Ctx }) {
  const { ds, t, now, tz } = ctx;
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  const validThrough = Object.values(ds.calendars).reduce((m, c) => [c.end, ...c.added].reduce((a, b) => (b > a ? b : a), m), '00000000');
  const expired = localYmd(now, tz) > validThrough;
  const built = Date.parse(ds.meta.builtAt);
  if (!Object.keys(ds.calendars).length) return null;
  if (expired) return <p className="status-line" data-level="warn" role="alert">{t.feedExpired(fmtYmd(validThrough))}</p>;
  if (!online) return <p className="status-line" data-level="warn" role="status">{t.offline(fmtYmd(Number.isNaN(built) ? validThrough : localYmd(built, tz)))}</p>;
  return null;
}

function RouteBadge({ ds, routeId }: { ds: Dataset; routeId: string }) {
  const r = ds.routes.find((x) => x.id === routeId);
  return <span className="route-badge" data-express={r?.shortName.endsWith('T') ? 'true' : undefined}>{r?.shortName ?? '?'}</span>;
}

function minutesUntil(now: number, at: number) { return Math.round((at - now) / 60_000); }

/** "7:20 AM", or "~7:20 AM" when the time is Arriba's estimate rather than one NJ Transit published; screen readers hear "estimated" instead of the "~". */
function TimeText({ ctx, at, estimated }: { ctx: Ctx; at: number; estimated: boolean }) {
  const s = formatTime12(at, ctx.tz, ctx.lang);
  if (!estimated) return <>{s}</>;
  return <><span aria-hidden="true">~</span>{s}<span className="sr-only">, {ctx.t.estimatedWord}</span></>;
}

/** NJ Transit developer terms: the data came from NJ Transit via Arriba's own server and may not be real time. The demo is not NJ Transit data. */
function dataNotice(ds: Dataset, t: Strings): string {
  return ds.meta.demo || ds.meta.transcribed ? t.notRealTime : `${t.dataObtained} ${t.notRealTime}`;
}

function arrivalAt(ds: Dataset, d: Departure, stopId: string): { at: number; estimated: boolean } | undefined {
  const i = d.pattern.stopIds.indexOf(stopId);
  return i > d.stopIndex ? tripStopTimes(ds, d)[i] : undefined;
}

function legFor(ds: Dataset, f: Favorite, reversedView: boolean): Leg | undefined {
  if (!reversedView) return { fromStopId: f.fromStopId, toStopId: f.toStopId, routeIds: f.routeIds };
  // Return trip: board where we got off; get off at the home stop or its twin across the street.
  const back = alightingStopFor(ds, f.toStopId, f.fromStopId, f.routeIds);
  return back ? { fromStopId: f.toStopId, toStopId: back.id, routeIds: f.routeIds } : undefined;
}

function Home({ ctx, favorites, count, setFavorites, reversedIds, toggleReversed, onSearch, onAllDay, onDeparture }: {
  ctx: Ctx; favorites: Favorite[]; count: number; setFavorites: (fn: (l: Favorite[]) => Favorite[]) => void;
  reversedIds: Set<string>; toggleReversed: (id: string) => void;
  onSearch: () => void; onAllDay: (leg: Leg, title: string) => void; onDeparture: (d: Departure, leg: Leg) => void;
}) {
  const { t } = ctx;
  const [editing, setEditing] = useState(false);
  if (!favorites.length) {
    return (
      <section className="card hero-empty">
        <h1>{t.noFavoritesTitle}</h1>
        <p>{t.noFavoritesBody}</p>
        <button className="primary" onClick={onSearch}>{t.findStop}</button>
      </section>
    );
  }
  return (
    <>
      <div className="row-between">
        <button className="ghost" onClick={onSearch}>＋ {t.findStop}</button>
        <button className="ghost" onClick={() => setEditing((e) => !e)}>{editing ? t.done : t.edit}</button>
      </div>
      <ol className="fav-list">
        {favorites.map((f, i) => (
          <li key={f.id}>
            <FavoriteCard ctx={ctx} fav={f} count={count} editing={editing} rev={reversedIds.has(f.id)} onReverse={() => toggleReversed(f.id)} first={i === 0} last={i === favorites.length - 1}
              onMove={(dlt) => setFavorites((l) => moveFavorite(l, f.id, dlt))}
              onRemove={() => setFavorites((l) => removeFavorite(l, f.id))}
              onRename={(name) => setFavorites((l) => renameFavorite(l, f.id, name))}
              onAllDay={onAllDay} onDeparture={onDeparture} />
          </li>
        ))}
      </ol>
    </>
  );
}

function FavoriteCard({ ctx, fav, count, editing, rev, onReverse, first, last, onMove, onRemove, onRename, onAllDay, onDeparture }: {
  ctx: Ctx; fav: Favorite; count: number; editing: boolean; rev: boolean; onReverse: () => void; first: boolean; last: boolean;
  onMove: (d: -1 | 1) => void; onRemove: () => void; onRename: (s: string) => void;
  onAllDay: (leg: Leg, title: string) => void; onDeparture: (d: Departure, leg: Leg) => void;
}) {
  const { ds, t, now, stopName } = ctx;
  const leg = legFor(ds, fav, rev);
  const deps = leg ? nextDepartures(ds, { stopId: leg.fromStopId, toStopId: leg.toStopId, routeIds: leg.routeIds }, now, count) : [];
  const rows = deps.map((d) => ({ d, arr: leg ? arrivalAt(ds, d, leg.toStopId) : undefined }));
  const anyEstimated = rows.some((r) => r.d.estimated || r.arr?.estimated);
  const title = leg ? `${stopName(leg.fromStopId)} → ${stopName(leg.toStopId)}` : '';
  return (
    <article className="card fav" aria-label={fav.label}>
      <div className="row-between">
        {editing ? (
          <label className="rename">{t.rename}
            <input defaultValue={fav.label} onBlur={(e) => onRename(e.currentTarget.value)} />
          </label>
        ) : <h2>{fav.label}</h2>}
        <button className="chip" aria-pressed={rev} onClick={onReverse}>⇄ {t.reverse}</button>
      </div>
      {leg && title !== fav.label && <p className="leg">{title}</p>}
      {!leg && !editing ? <p className="warn" role="alert">{t.noReturnStop}</p> : editing ? (
        <div className="edit-row">
          <button onClick={() => onMove(-1)} disabled={first}>↑ {t.moveUp}</button>
          <button onClick={() => onMove(1)} disabled={last}>↓ {t.moveDown}</button>
          <button className="danger" onClick={onRemove}>{t.remove}</button>
        </div>
      ) : (
        <>
          {!leg ? null : deps.length === 0 ? <p className="muted">{t.noMoreToday}</p> : (
            <ul className="deps">
              {rows.map(({ d, arr }, i) => (
                <li key={d.tripInstanceId}>
                  <button className={`dep ${i === 0 ? 'dep-next' : ''}`} onClick={() => onDeparture(d, leg)}>
                    <RouteBadge ds={ds} routeId={d.route.id} />
                    <span className="dep-main">
                      <span className="dep-time"><TimeText ctx={ctx} at={d.departs} estimated={d.estimated} /></span>
                      <span className="dep-sub">{arr ? <>{t.arrives} <TimeText ctx={ctx} at={arr.at} estimated={arr.estimated} /></> : d.pattern.headsign}</span>
                    </span>
                    <span className="dep-right">
                      <span className="dep-min">{t.inMin(minutesUntil(now, d.departs))}</span>
                      <span className="badge-sched">{t.scheduledOnly}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {anyEstimated && <p className="muted small">{t.estimatedNote}</p>}
          {leg && <button className="link" onClick={() => onAllDay(leg, title)}>{t.allDay} →</button>}
        </>
      )}
    </article>
  );
}

function Search({ ctx, onSave }: { ctx: Ctx; onSave: (f: Favorite) => void }) {
  const { ds, t, stopName } = ctx;
  const [q, setQ] = useState('');
  const [stop, setStop] = useState<Stop | undefined>();
  const [dest, setDest] = useState<string | undefined>();
  const results = useMemo(() => searchStops(ds, q), [ds, q]);
  const destinations = useMemo(() => {
    const ends = new Set(ds.patterns.map((p) => p.stopIds[p.stopIds.length - 1]!));
    return ds.stops.filter((s) => ends.has(s.id) && s.id !== stop?.id);
  }, [ds, stop]);
  const headsigns = stop ? [...new Set(ds.patterns.filter((p) => p.stopIds.slice(0, -1).includes(stop.id)).map((p) => p.headsign))] : [];
  const check = stop && dest ? checkDirection(ds, stop.id, dest) : undefined;

  if (!stop) {
    return (
      <section>
        <h1>{t.findStop}</h1>
        <input className="search" autoFocus type="search" value={q} placeholder={t.searchPlaceholder} aria-label={t.findStop}
          onChange={(e) => setQ(e.currentTarget.value)} />
        <ul className="results">
          {results.map((s) => (
            <li key={s.id}><button onClick={() => setStop(s)}><strong>{s.name}</strong>{s.code && <span className="muted"> #{s.code}</span>}</button></li>
          ))}
          {q && !results.length && <li className="muted">{t.noResults}</li>}
        </ul>
      </section>
    );
  }
  return (
    <section>
      <h1>{stop.name}</h1>
      {headsigns.length > 0 && <p className="muted">{t.busesHereGoTo}: {headsigns.join(' · ')}</p>}
      <h2>{t.whereTo}</h2>
      <div className="choice-list">
        {destinations.map((s) => (
          <button key={s.id} className="chip" aria-pressed={dest === s.id} onClick={() => setDest(s.id)}>{s.name}</button>
        ))}
      </div>
      {check && !check.ok && check.reason === 'wrong-side' && (
        <div className="warn" role="alert">
          <p>{check.distanceM === undefined ? t.wrongSideNoDistance(check.useStop.name) : t.wrongSide(check.useStop.name, check.distanceM)}</p>
          <button className="primary" onClick={() => setStop(check.useStop)}>{t.useThatStop}</button>
        </div>
      )}
      {check && !check.ok && check.reason === 'not-served' && <div className="warn" role="alert">{t.notServed}</div>}
      {check?.ok && dest && (
        <button className="primary" onClick={() => onSave({
          id: `${stop.id}>${dest}`, label: `${stopName(stop.id)} → ${stopName(dest)}`, fromStopId: stop.id, toStopId: dest, routeIds: [],
        })}>{t.saveFavorite}</button>
      )}
    </section>
  );
}

function Timetable({ ctx, leg, title, onDeparture }: { ctx: Ctx; leg: Leg; title: string; onDeparture: (d: Departure) => void }) {
  const { ds, t, tz, now, lang } = ctx;
  const today = localYmd(now, tz);
  const [date, setDate] = useState(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const list = departuresOn(ds, { stopId: leg.fromStopId, toStopId: leg.toStopId, routeIds: leg.routeIds, date });
  const rows = list.map((d) => ({ d, arr: arrivalAt(ds, d, leg.toStopId) }));
  const anyEstimated = rows.some((r) => r.d.estimated || r.arr?.estimated);
  const dayLabel = (d: string, i: number) => i === 0 ? t.today : i === 1 ? t.tomorrow :
    new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))));
  return (
    <section>
      <h1>{t.timetableTitle}</h1>
      <p className="leg">{title}</p>
      <div className="choice-list" role="tablist">
        {days.map((d, i) => (
          <button key={d} role="tab" className="chip" aria-selected={d === date} data-selected={d === date ? 'true' : undefined} onClick={() => setDate(d)}
            data-weekend={weekdayIndex(d) >= 5 ? 'true' : undefined}>{dayLabel(d, i)}</button>
        ))}
      </div>
      {ds.meta.transcribed && isNjtHoliday(date) && <p className="warn small" role="note">{t.holidayOn}</p>}
      <table className="timetable">
        <thead><tr><th>{t.departs}</th><th>{t.route}</th><th>{t.arrives}</th></tr></thead>
        <tbody>
          {rows.map(({ d, arr }) => (
            <tr key={d.tripInstanceId} className={d.departs < now ? 'past' : ''}>
              <td className="tt-time"><button className="link-cell" onClick={() => onDeparture(d)}><TimeText ctx={ctx} at={d.departs} estimated={d.estimated} /></button></td>
              <td><RouteBadge ds={ds} routeId={d.route.id} /></td>
              <td>{arr ? <TimeText ctx={ctx} at={arr.at} estimated={arr.estimated} /> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {anyEstimated && <p className="muted small">{t.estimatedNote}</p>}
      {!list.length && <p className="muted">{t.noBusesThisDay}</p>}
    </section>
  );
}

function DepartureDetail({ ctx, dep, leg, lock, onLock, onUnlock }: {
  ctx: Ctx; dep: Departure; leg: Leg; lock?: TripLock; onLock: () => void; onUnlock: () => void;
}) {
  const { ds, t, stopName } = ctx;
  const times = tripStopTimes(ds, dep);
  const alightIndex = dep.pattern.stopIds.indexOf(leg.toStopId);
  const boardStop = ds.stops.find((s) => s.id === dep.pattern.stopIds[dep.stopIndex]);
  const alightStop = alightIndex > dep.stopIndex ? ds.stops.find((s) => s.id === dep.pattern.stopIds[alightIndex]) : undefined;
  const atPabt = boardStop?.terminal === 'PABT';
  // Usual-gate windows use service-day minutes (a 24:00 trip is 1440, not 0) and the service date's day type.
  const localMin = Math.round((ds.trips.find((x) => x.id === dep.tripId)?.times[dep.stopIndex] ?? 0) / 60);
  const wd = weekdayIndex(dep.serviceDate);
  const gate: GateAnswer | undefined = atPabt
    ? gateFor(dep.tripInstanceId, dep.pattern.id, localMin, wd === 5 ? 'saturday' : wd === 6 ? 'sunday' : 'weekday', [], ds.meta.demo ? demoUsualGates : [], ds.publishedGates, dep.pattern.variant)
    : undefined;
  return (
    <section>
      {/* A printed timetable gives no sign text, so a transcribed dataset's headsign is Arriba's own route-and-destination label, not what the sign reads. */}
      <div className="sign" aria-label={`${ds.meta.transcribed ? t.routeAndDirection : t.checkSign}: ${dep.pattern.headsign}`}>
        <span className="sign-label">{ds.meta.transcribed ? t.routeAndDirection : t.checkSign}</span>
        <span className="sign-led">{dep.pattern.headsign}</span>
      </div>
      {dep.pattern.variant && t.variantNotes[dep.pattern.variant] && <p className="muted small">{t.variantNotes[dep.pattern.variant]}</p>}
      {boardStop?.noteId && t.stopNotes[boardStop.noteId] && <p className="muted small" role="note">{t.stopNotes[boardStop.noteId]}</p>}
      {alightStop?.noteId && t.stopNotes[alightStop.noteId] && <p className="warn small" role="note">{t.stopNotes[alightStop.noteId]}</p>}
      {ds.meta.transcribed && isNjtHoliday(dep.serviceDate) && <p className="warn small" role="note">{t.holidayOn}</p>}
      <div className="card trip-ticket">
        <p className="trip-ticket-label">{t.tripCard}</p>
        <div className="row-between">
          <div><span className="muted">{t.departs}</span><div className="big-time"><TimeText ctx={ctx} at={dep.departs} estimated={dep.estimated} /></div></div>
          {alightIndex > dep.stopIndex && (
            <div className="right"><span className="muted">{t.arrivesLabel}</span><div className="big-time"><TimeText ctx={ctx} at={times[alightIndex]!.at} estimated={times[alightIndex]!.estimated} /></div></div>
          )}
        </div>
        <p className="badge-sched block">{t.scheduledOnly}</p>
        <p className="muted small">{t.scheduledOnlyHelp}</p>
        {(dep.estimated || (alightIndex > dep.stopIndex && times[alightIndex]?.estimated)) && <p className="muted small">{t.estimatedNote}</p>}
      </div>

      {gate && (
        <div className="card gate-card" data-status={gate.status}>
          <h2>{t.gateTitle}</h2>
          {gate.status === 'posted' && <p className="gate-big">{t.gatePosted(gate.gate, gate.door)}</p>}
          {gate.status === 'usual' && <><p className="gate-big">{t.gateUsual(gate.gate, gate.door)}</p><p className="muted small">{t.gateUsualNote(gate.samples)}</p></>}
          {gate.status === 'published' && <><p className="gate-big">{t.gatePublished(gate.gate, gate.door)}</p><p className="muted small">{t.gatePublishedNote(fmtYmd(gate.effective))}</p></>}
          {gate.status === 'unknown' && <p className="gate-big">{t.gateUnknown}</p>}
          <p className="small">{t.gateConfirm}</p>
          <p className="warn small" role="note">{t.ticketWarning}</p>
          <a className="link" href="https://www.njtransit.com/app" target="_blank" rel="noreferrer">{t.buyTicket} ↗</a>
        </div>
      )}

      <TicketGuide t={t} defaultOpen={atPabt} />

      <div className="card">
        {lock ? (
          <>
            <h2>{t.lockedTitle}</h2>
            <p className="lock-status" data-status={lock.status}>{t.lockStatus[lock.status]}</p>
            <button onClick={onUnlock}>{t.unlockBus}</button>
          </>
        ) : <button className="primary wide" onClick={onLock}>{t.lockBus}</button>}
      </div>

      <h2>{t.stops}</h2>
      <ol className="stop-list">
        {dep.pattern.stopIds.map((id, i) => (
          <li key={`${id}-${i}`} data-role={i === dep.stopIndex ? 'board' : i === alightIndex ? 'alight' : i < dep.stopIndex ? 'before' : undefined}>
            <span className="stop-time"><TimeText ctx={ctx} at={times[i]!.at} estimated={times[i]!.estimated} /></span>
            <span className="stop-name">{stopName(id)}</span>
            {i === dep.stopIndex && <span className="tag">{t.boardHere}</span>}
            {i === alightIndex && <span className="tag tag-alight">{t.getOffHere}</span>}
          </li>
        ))}
      </ol>
      {times.some((x) => x.estimated) && <p className="muted small">{t.estimatedNote}</p>}
    </section>
  );
}

function SettingsScreen({ ctx, settings, setSettings }: { ctx: Ctx; settings: Settings; setSettings: (s: Settings) => void }) {
  const { t, ds } = ctx;
  const opt = <K extends keyof Settings>(k: K, v: Settings[K], label: string) => (
    <button className="chip" aria-pressed={settings[k] === v} onClick={() => setSettings({ ...settings, [k]: v })}>{label}</button>
  );
  return (
    <section>
      <h1>{t.settings}</h1>
      <h2>{t.language}</h2>
      <div className="choice-list">{opt('lang', 'en', 'English')}{opt('lang', 'es', 'Español')}</div>
      <h2>{t.theme}</h2>
      <div className="choice-list">{opt('theme', 'system', t.themeSystem)}{opt('theme', 'light', t.themeLight)}{opt('theme', 'dark', t.themeDark)}</div>
      <h2>{t.departuresShown}</h2>
      <div className="choice-list">{opt('count', 3, '3')}{opt('count', 5, '5')}</div>
      <h2>{t.dataSource}</h2>
      <p className="small">{ds.meta.source} · {ds.meta.feedVersion}</p>
      <p className="small muted">{dataNotice(ds, t)}</p>
      <p className="small muted">{t.appTagline}</p>
    </section>
  );
}
