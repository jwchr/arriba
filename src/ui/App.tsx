import { useEffect, useMemo, useState } from 'react';
import { demoDataset, demoUsualGates } from '../data/demo';
import { checkDirection, destinationsFrom, returnLeg, searchStops } from '../domain/direction';
import { addFavorite, loadFavorites, moveFavorite, removeFavorite, renameFavorite, saveFavorites, type Favorite } from '../domain/favorites';
import { fareBetween } from '../domain/fare';
import { gateFor, type GateAnswer } from '../domain/gate';
import { isNjtHoliday } from '../domain/holidays';
import { createBusSession, reduceBusSession, type BusSession, type BusSessionEvent } from '../domain/busLock';
import { departuresOn, nextDepartures, tripStopTimes } from '../domain/schedule';
import { addDays, clockChangeBetween, formatTime12, localYmd, weekdayIndex, zonedWallTime } from '../domain/time';
import type { Dataset, Departure, Stop } from '../domain/types';
import { strings, type Lang, type Strings } from './i18n';
import { NearMe } from './NearMe';
import { RiderGuide } from './RiderGuide';
import { TicketGuide } from './TicketGuide';
import { BusLockPanel } from './BusLockPanel';
import { LastReturnCard } from './LastReturnCard';

type Theme = 'system' | 'light' | 'dark';
interface Settings { lang: Lang; theme: Theme; count: 3 | 5 }
interface Leg { fromStopId: string; toStopId: string; routeIds: string[] }
interface ActiveLock { dep: Departure; leg: Leg; session: BusSession }
type Screen =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'timetable'; leg: Leg; title: string }
  | { name: 'departure'; dep: Departure; leg: Leg }
  | { name: 'settings' }
  | { name: 'guide' };

const store = (() => { try { return window.localStorage; } catch { return undefined; } })();
const readSettings = (): Settings => {
  try {
    const s = JSON.parse(store?.getItem('arriba.settings.v1') ?? '{}') as Partial<Settings>;
    return { lang: s.lang === 'es' ? 'es' : 'en', theme: s.theme ?? 'system', count: s.count === 5 ? 5 : 3 };
  } catch { return { lang: 'en', theme: 'system', count: 3 }; }
};

/** `?now=2026-11-04T07:50` pins the clock (New York wall time) for demos and tests. */
function useNow(tz: string, intervalMs = 30_000): number {
  const pinned = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('now') ?? '');
    return m ? zonedWallTime(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz) : undefined;
  }, [tz]);
  const [now, setNow] = useState(() => pinned ?? Date.now());
  useEffect(() => {
    if (pinned !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [pinned, intervalMs]);
  return pinned ?? now;
}

type DatasetState =
  | { status: 'loading' }
  | { status: 'error' }
  /** `fromCache` when the service worker answered from its saved copy; `savedAt` (ms) when it knows when that copy was saved. */
  | { status: 'ready'; ds: Dataset; fromCache?: boolean | undefined; savedAt?: number | undefined };

/** The app gives up on a load after this long even without a service worker (first visit, slow tunnel). */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Loads the published schedule. The invented demo is used only with `?demo` or when no real dataset is
 * published (404); a slow or failed load is an error with a retry, never silently the demo.
 */
function useDataset(): [DatasetState, () => void] {
  const demo = useMemo(() => new URLSearchParams(location.search).has('demo'), []);
  const [state, setState] = useState<DatasetState>(demo ? { status: 'ready', ds: demoDataset } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (demo) return;
    let live = true;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
    setState({ status: 'loading' });
    fetch(`${import.meta.env.BASE_URL}data/corridor.json`, { signal: ctl.signal })
      .then(async (r): Promise<DatasetState> => {
        if (r.status === 404) return { status: 'ready', ds: demoDataset };
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Dataset;
        if (!d || !Array.isArray(d.trips) || !d.trips.length) throw new Error('empty dataset');
        const fromCache = r.headers.get('x-arriba-from-cache') === '1';
        // Copies saved by older service workers have no x-arriba-saved-at; the server's Date header is the next best.
        const raw = r.headers.get('x-arriba-saved-at');
        const at = raw ? Number(raw) : Date.parse(r.headers.get('date') ?? '');
        return { status: 'ready', ds: d, fromCache, savedAt: fromCache && Number.isFinite(at) && at > 0 ? at : undefined };
      })
      .then((s) => { if (live) setState(s); })
      .catch(() => { if (live) setState({ status: 'error' }); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; ctl.abort(); clearTimeout(timer); };
  }, [demo, attempt]);
  return [state, () => setAttempt((n) => n + 1)];
}

export function App() {
  const [data, retry] = useDataset();
  if (data.status !== 'ready') return <LoadScreen failed={data.status === 'error'} onRetry={retry} />;
  return <Main ds={data.ds} fromCache={data.fromCache} savedAt={data.savedAt} />;
}

function LoadScreen({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const t = strings[readSettings().lang];
  return (
    <div className="app">
      <header className="top"><span className="wordmark" role="img" aria-label="Dale">DALE<span className="bang" aria-hidden="true">!</span></span></header>
      <main>
        {failed ? (
          <div className="warn" role="alert">
            <p>{t.loadFailed}</p>
            <button className="primary" onClick={onRetry}>{t.retry}</button>
          </div>
        ) : <p className="muted" role="status">{t.loading}</p>}
      </main>
    </div>
  );
}

function Main({ ds, fromCache, savedAt }: { ds: Dataset; fromCache?: boolean | undefined; savedAt?: number | undefined }) {
  const tz = ds.meta.timezone;
  const [activeLock, setActiveLock] = useState<ActiveLock | undefined>();
  const [demoAdvanceMs, setDemoAdvanceMs] = useState(0);
  const [keepAwake, setKeepAwake] = useState(true);
  const now = useNow(tz, activeLock ? 1000 : 30_000);
  const lockNow = now + (ds.meta.demo ? demoAdvanceMs : 0);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites(store));
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [reversedIds, setReversedIds] = useState<Set<string>>(() => new Set());
  const toggleReversed = (id: string) => setReversedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const t = strings[settings.lang];

  const lockOnScreen = screen.name === 'departure' && activeLock?.dep.tripInstanceId === screen.dep.tripInstanceId && activeLock.dep.stopIndex === screen.dep.stopIndex;
  const lockEvent = (event: BusSessionEvent) => setActiveLock((current) => current ? { ...current, session: reduceBusSession(current.session, event) } : current);
  useEffect(() => {
    setActiveLock((current) => {
      if (!current) return current;
      const session = reduceBusSession(current.session, { type: 'tick', now: lockNow });
      return session === current.session ? current : { ...current, session };
    });
  }, [lockNow]);

  useEffect(() => saveFavorites(store, favorites), [favorites]);
  useEffect(() => {
    try { store?.setItem('arriba.settings.v1', JSON.stringify(settings)); } catch { /* ignore */ }
    document.documentElement.lang = settings.lang;
    if (settings.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  const stopName = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  const ctx: Ctx = { ds, tz, now, t, lang: settings.lang, stopName, fromCache, savedAt };

  return (
    <div className="app">
      <header className="top">
        {screen.name !== 'home' ? (
          <button className="icon-btn" onClick={() => setScreen({ name: 'home' })} aria-label={t.back}>‹</button>
        ) : <span className="wordmark" role="img" aria-label="Dale">DALE<span className="bang" aria-hidden="true">!</span></span>}
        <button className="icon-btn" onClick={() => setScreen({ name: 'settings' })} aria-label={t.settings}>⚙</button>
      </header>
      {ds.meta.demo && <div className="demo-banner" role="note">{t.demoBanner}</div>}
      {ds.meta.transcribed && <div className="data-banner" role="note">{t.transcribedBanner(fmtYmd(ds.meta.transcribed.issued, settings.lang))}</div>}
      <FeedStatus ctx={ctx} />
      {ds.meta.transcribed && isNjtHoliday(localYmd(now, tz)) && <p className="status-line" data-level="warn" role="note">{t.holidayToday}</p>}
      <main>
        {activeLock && !lockOnScreen && <aside className="lock-return">
          <button className="primary wide" onClick={() => setScreen({ name: 'departure', dep: activeLock.dep, leg: activeLock.leg })}>
            {t.busLock.resume} · {activeLock.dep.route.shortName} · {formatTime12(activeLock.dep.departs, tz, settings.lang)}
          </button>
        </aside>}
        {screen.name === 'home' && (
          <Home ctx={ctx} favorites={favorites} count={settings.count} setFavorites={setFavorites} reversedIds={reversedIds} toggleReversed={toggleReversed}
            onSearch={() => setScreen({ name: 'search' })}
            onGuide={() => setScreen({ name: 'guide' })}
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
            busSession={lockOnScreen ? activeLock?.session : undefined} anotherLock={!!activeLock && !lockOnScreen}
            lockNow={lockNow} keepAwake={keepAwake} onKeepAwake={setKeepAwake} onLockEvent={lockEvent}
            onAdvanceDemo={(minutes) => { if (ds.meta.demo) setDemoAdvanceMs((value) => value + minutes * 60_000); }}
            onLock={() => { if (!activeLock) setActiveLock({ dep: screen.dep, leg: screen.leg, session: createBusSession(screen.dep, lockNow) }); }}
            onReturn={(dep, leg) => setScreen({ name: 'departure', dep, leg })}
            onUnlock={() => { setActiveLock(undefined); setDemoAdvanceMs(0); }} />
        )}
        {screen.name === 'settings' && <SettingsScreen ctx={ctx} settings={settings} setSettings={setSettings} onGuide={() => setScreen({ name: 'guide' })} />}
        {screen.name === 'guide' && <RiderGuide t={t} />}
      </main>
      <footer className="foot">
        <p>{t.notAffiliated}</p>
        <p>{dataNotice(ds, t)}</p>
      </footer>
    </div>
  );
}

/** YYYYMMDD as month/day/year in English and day/month/year in Spanish, as each reader expects. */
const fmtYmd = (d: string, lang: Lang) =>
  lang === 'es' ? `${+d.slice(6, 8)}/${+d.slice(4, 6)}/${d.slice(0, 4)}` : `${+d.slice(4, 6)}/${+d.slice(6, 8)}/${d.slice(0, 4)}`;

/** Cents as dollars; a range when the zone count is uncertain. Same format in both languages. */
const money = (c: { min: number; max: number }) => {
  const d = (n: number) => `$${(n / 100).toFixed(2)}`;
  return c.min === c.max ? d(c.min) : `${d(c.min)}–${d(c.max)}`;
};

interface Ctx { ds: Dataset; tz: string; now: number; t: Strings; lang: Lang; stopName: (id: string) => string; fromCache?: boolean | undefined; savedAt?: number | undefined }

/** Offline state and schedule validity, so a stale or expired feed is never mistaken for "no buses". */
function FeedStatus({ ctx }: { ctx: Ctx }) {
  const { ds, t, now, tz, lang, fromCache, savedAt } = ctx;
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
  if (expired) return <p className="status-line" data-level="warn" role="alert">{t.feedExpired(fmtYmd(validThrough, lang))}</p>;
  if (!online) return <p className="status-line" data-level="warn" role="status">{t.offline(fmtYmd(Number.isNaN(built) ? validThrough : localYmd(built, tz), lang))}</p>;
  // Online as far as the browser knows, but the service worker gave up on a slow or failed network and used its saved copy.
  if (fromCache) {
    const line = savedAt !== undefined ? t.savedCopy(fmtYmd(localYmd(savedAt, tz), lang), formatTime12(savedAt, tz, lang)) : t.savedCopyUnknown;
    return <p className="status-line" data-level="warn" role="status">{line}</p>;
  }
  return null;
}

function RouteBadge({ ds, routeId }: { ds: Dataset; routeId: string }) {
  const r = ds.routes.find((x) => x.id === routeId);
  return <span className="route-badge" data-express={r?.shortName.endsWith('T') ? 'true' : undefined}>{r?.shortName ?? '?'}</span>;
}

function minutesUntil(now: number, at: number) { return Math.round((at - now) / 60_000); }

/** "7:20 AM", or "~7:20 AM" when the time is Dale's estimate rather than one NJ Transit published; screen readers hear "estimated" instead of the "~". */
function TimeText({ ctx, at, estimated }: { ctx: Ctx; at: number; estimated: boolean }) {
  const s = formatTime12(at, ctx.tz, ctx.lang);
  if (!estimated) return <>{s}</>;
  return <><span aria-hidden="true">~</span>{s}<span className="sr-only">, {ctx.t.estimatedWord}</span></>;
}

/** NJ Transit developer terms: the data came from NJ Transit via Dale's own server and may not be real time. The demo is not NJ Transit data. */
function dataNotice(ds: Dataset, t: Strings): string {
  return ds.meta.demo || ds.meta.transcribed ? t.notRealTime : `${t.dataObtained} ${t.notRealTime}`;
}

function arrivalAt(ds: Dataset, d: Departure, stopId: string): { at: number; estimated: boolean } | undefined {
  const i = d.pattern.stopIds.indexOf(stopId);
  return i > d.stopIndex ? tripStopTimes(ds, d)[i] : undefined;
}

function legFor(ds: Dataset, f: Favorite, reversedView: boolean): Leg | undefined {
  if (!reversedView) return { fromStopId: f.fromStopId, toStopId: f.toStopId, routeIds: f.routeIds };
  // Return trip: board where we got off, or across the street; get off at home or its twin.
  const back = returnLeg(ds, f.fromStopId, f.toStopId, f.routeIds);
  return back ? { ...back, routeIds: f.routeIds } : undefined;
}

function Home({ ctx, favorites, count, setFavorites, reversedIds, toggleReversed, onSearch, onGuide, onAllDay, onDeparture }: {
  ctx: Ctx; favorites: Favorite[]; count: number; setFavorites: (fn: (l: Favorite[]) => Favorite[]) => void;
  reversedIds: Set<string>; toggleReversed: (id: string) => void;
  onSearch: () => void; onGuide: () => void; onAllDay: (leg: Leg, title: string) => void; onDeparture: (d: Departure, leg: Leg) => void;
}) {
  const { t } = ctx;
  const [editing, setEditing] = useState(false);
  if (!favorites.length) {
    return (
      <section className="card hero-empty">
        <h1>{t.noFavoritesTitle}</h1>
        <p>{t.noFavoritesBody}</p>
        <button className="primary" onClick={onSearch}>{t.findStop}</button>
        <p><button className="ghost" onClick={onGuide}>{t.guideOpen}</button></p>
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
      <button className="ghost" onClick={onGuide}>{t.guideOpen}</button>
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
                      {(() => { const g = departureGate(ds, d); return g && <span className="dep-gate" data-status={g.status}>{gateLine(t, g)}</span>; })()}
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
  const destinations = useMemo(() => (stop ? destinationsFrom(ds, stop.id) : []), [ds, stop]);
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
        {!q && <NearMe ds={ds} t={t} onPick={setStop} />}
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
      {/* Destinations list only what buses from here (or across the street) reach; say so when Port Authority is not among them. */}
      {!stop.terminal && !destinations.some((s) => s.terminal) && <p className="warn small" role="note">{t.noTerminalFromHere}</p>}
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
  // Same rule as the trip screen, per row: a listed bus already running when the clocks change shows the new
  // clock time. Only then is there anything to explain; other rows read exactly as printed.
  const dayClockChange = rows.map(({ d, arr }) => {
    const first = tripStopTimes(ds, d)[0];
    return first ? clockChangeBetween(first.at, arr?.at ?? d.departs, tz) : undefined;
  }).find(Boolean);
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
      {dayClockChange && <p className="warn small" role="note">{dayClockChange === 'back' ? t.clockBackDay : t.clockAheadDay}</p>}
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

/** The Port Authority gate answer for a departure boarding there (same answer on home and the trip screen); undefined elsewhere. */
function departureGate(ds: Dataset, dep: Departure): GateAnswer | undefined {
  const boardStop = ds.stops.find((s) => s.id === dep.pattern.stopIds[dep.stopIndex]);
  if (boardStop?.terminal !== 'PABT') return undefined;
  // Usual-gate windows use service-day minutes (a 24:00 trip is 1440, not 0) and the service date's day type.
  const localMin = Math.round((ds.trips.find((x) => x.id === dep.tripId)?.times[dep.stopIndex] ?? 0) / 60);
  const wd = weekdayIndex(dep.serviceDate);
  return gateFor(dep.tripInstanceId, dep.pattern.id, localMin, wd === 5 ? 'saturday' : wd === 6 ? 'sunday' : 'weekday', [], ds.meta.demo ? demoUsualGates : [], ds.publishedGates, dep.pattern.variant);
}

/**
 * One-line gate for a home departure row, always saying what kind of answer it is. Postings are always
 * empty until M3; when DepartureVision is wired in, the posted line must also say how old the posting is.
 */
const gateLine = (t: Strings, g: GateAnswer) =>
  g.status === 'posted' ? t.gatePosted(g.gate, g.door)
    : g.status === 'usual' ? t.gateUsual(g.gate, g.door)
      : g.status === 'published' ? `${t.gatePublished(g.gate, g.door)} · ${t.gateRuleTag}`
        : t.gateUnknown;

function DepartureDetail({ ctx, dep, leg, busSession, anotherLock, lockNow, keepAwake, onKeepAwake, onLockEvent, onAdvanceDemo, onLock, onUnlock, onReturn }: {
  ctx: Ctx; dep: Departure; leg: Leg; busSession?: BusSession; anotherLock: boolean; lockNow: number;
  keepAwake: boolean; onKeepAwake: (value: boolean) => void; onLockEvent: (event: BusSessionEvent) => void;
  onAdvanceDemo: (minutes: number) => void; onLock: () => void; onUnlock: () => void;
  onReturn: (dep: Departure, leg: Leg) => void;
}) {
  const { ds, t, stopName } = ctx;
  const times = tripStopTimes(ds, dep);
  // Search after the boarding stop: on a loop pattern the destination can also appear earlier.
  const alightIndex = dep.pattern.stopIds.indexOf(leg.toStopId, dep.stopIndex + 1);
  const boardStop = ds.stops.find((s) => s.id === dep.pattern.stopIds[dep.stopIndex]);
  const alightStop = alightIndex > dep.stopIndex ? ds.stops.find((s) => s.id === dep.pattern.stopIds[alightIndex]) : undefined;
  // The printed Park/Ride note is about Parkway express (P, FP) trips only; other trips stop there as usual.
  const alightNote = alightStop?.noteId && (alightStop.noteId !== 'parkride-request' || ['P', 'FP'].includes(dep.pattern.variant ?? '')) ? t.stopNotes[alightStop.noteId] : undefined;
  const atPabt = boardStop?.terminal === 'PABT';
  const fare = boardStop && alightStop ? fareBetween(ds, boardStop.id, alightStop.id) : undefined;
  const gate = departureGate(ds, dep);
  // From the trip's first stop (read as printed) to where the rider gets off: a change before boarding
  // still shifts the rider's times, a change after getting off does not.
  const rideEnd = times[alightIndex > dep.stopIndex ? alightIndex : times.length - 1];
  const clockChange = rideEnd && times[0] ? clockChangeBetween(times[0].at, rideEnd.at, ctx.tz) : undefined;
  return (
    <section>
      {/* A printed timetable gives no sign text, so a transcribed dataset's headsign is Dale's own route-and-destination label, not what the sign reads. */}
      <div className="sign" aria-label={`${ds.meta.transcribed ? t.routeAndDirection : t.checkSign}: ${dep.pattern.headsign}`}>
        <span className="sign-label">{ds.meta.transcribed ? t.routeAndDirection : t.checkSign}</span>
        <span className="sign-led">{dep.pattern.headsign}</span>
      </div>
      {dep.pattern.variant && t.variantNotes[dep.pattern.variant] && <p className="muted small">{t.variantNotes[dep.pattern.variant]}</p>}
      {boardStop?.noteId && t.stopNotes[boardStop.noteId] && <p className="muted small" role="note">{t.stopNotes[boardStop.noteId]}</p>}
      {alightNote && <p className="warn small" role="note">{alightNote}</p>}
      {ds.meta.transcribed && isNjtHoliday(dep.serviceDate) && <p className="warn small" role="note">{t.holidayOn}</p>}
      {clockChange && <p className="warn small" role="note">{clockChange === 'back' ? t.clockBackTrip : t.clockAheadTrip}</p>}
      {busSession && <BusLockPanel ds={ds} session={busSession} alightIndex={alightIndex} now={lockNow} t={t} lang={ctx.lang}
        keepAwake={keepAwake} onKeepAwake={onKeepAwake} onEvent={onLockEvent} onAdvanceDemo={onAdvanceDemo} onUnlock={onUnlock} />}
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

      {!busSession && <div className="card">
        {anotherLock ? <p className="small">{t.busLock.anotherLock}</p> : <button className="primary wide" onClick={onLock}>{t.lockBus}</button>}
      </div>}

      <LastReturnCard ds={ds} outbound={dep} toStopId={leg.toStopId} t={t} lang={ctx.lang} onOpen={onReturn} />

      {fare && ds.publishedFares && (
        <div className="card fare-card">
          <h2>{t.fareTitle} · {t.fareZones(fare.zones.min, fare.zones.max)}</h2>
          <div className="row-between"><span>{t.fareAdult}</span><strong>{money(fare.adult)}</strong></div>
          <div className="row-between"><span>{t.fareReduced}</span><strong>{money(fare.reduced)}</strong></div>
          {fare.zones.min !== fare.zones.max && <p className="warn small" role="note">{t.fareBoundary}</p>}
          <p className={atPabt ? 'warn small' : 'small'}>{atPabt ? t.fareAtPabt : t.fareCash}</p>
          <p className="muted small">{t.fareNote(fmtYmd(ds.publishedFares.effective, ctx.lang))}</p>
        </div>
      )}

      {gate && (
        <div className="card gate-card" data-status={gate.status}>
          <h2>{t.gateTitle}</h2>
          {gate.status === 'posted' && <p className="gate-big">{t.gatePosted(gate.gate, gate.door)}</p>}
          {gate.status === 'usual' && <><p className="gate-big">{t.gateUsual(gate.gate, gate.door)}</p><p className="muted small">{t.gateUsualNote(gate.samples)}</p></>}
          {gate.status === 'published' && <><p className="gate-big">{t.gatePublished(gate.gate, gate.door)}</p><p className="muted small">{t.gatePublishedNote(fmtYmd(gate.effective, ctx.lang))}</p></>}
          {gate.status === 'unknown' && <p className="gate-big">{t.gateUnknown}</p>}
          <p className="small">{t.gateConfirm}</p>
          {!ds.meta.demo && <p className="muted small" role="note">{t.gateConstruction}</p>}
          <p className="warn small" role="note">{t.ticketWarning}</p>
          <a className="link" href="https://www.njtransit.com/app" target="_blank" rel="noreferrer">{t.buyTicket} ↗</a>
        </div>
      )}

      <TicketGuide t={t} defaultOpen={atPabt} />

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

function SettingsScreen({ ctx, settings, setSettings, onGuide }: { ctx: Ctx; settings: Settings; setSettings: (s: Settings) => void; onGuide: () => void }) {
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
      <h2>{t.guide.title}</h2>
      <button className="ghost" onClick={onGuide}>{t.guideOpen}</button>
      <h2>{t.dataSource}</h2>
      <p className="small">{ds.meta.source} · {ds.meta.feedVersion}</p>
      <p className="small muted">{dataNotice(ds, t)}</p>
      <p className="small muted">{t.appTagline}</p>
    </section>
  );
}
