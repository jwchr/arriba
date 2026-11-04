// "Get me the fuck home" (issue #32): every scheduled way home in Dale's data, ranked by arrival,
// with what was searched and what was not. Schedule only: it never claims a bus is running or that
// no other way exists.
import type { ReactNode } from 'react';
import { rescueOptions, type RescueOption } from '../domain/rescue';
import { formatTime12, localHour, localYmd } from '../domain/time';
import type { Dataset } from '../domain/types';
import type { Lang, Strings } from './i18n';

interface Props {
  ds: Dataset;
  t: Strings;
  lang: Lang;
  now: number;
  fromStopId: string;
  homeStopId: string;
  usualRouteId?: string;
  /** 'home' when heading out of New York; 'other' for trips into Port Authority. */
  label: 'home' | 'other';
  /** The gate line for a departure boarding at Port Authority, with its source; undefined elsewhere. */
  gateText: (o: RescueOption) => string | undefined;
  onOpen: (o: RescueOption) => void;
  badge: (routeId: string) => ReactNode;
}

export function Rescue({ ds, t, lang, now, fromStopId, homeStopId, usualRouteId, label, gateText, onOpen, badge }: Props) {
  const r = t.rescue;
  const name = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  const clock = (at: number) => formatTime12(at, ds.meta.timezone, lang);
  const result = rescueOptions(ds, fromStopId, homeStopId, now, usualRouteId);
  const soon = result.options.filter((o) => !o.lastOnLine || o.dep.departs <= result.searchedUntil);
  const today = localYmd(now, ds.meta.timezone);
  // A row on another calendar day says which day, so 1:10 AM tomorrow never reads as 1:10 AM today.
  const day = (at: number) => localYmd(at, ds.meta.timezone) === today ? ''
    : `${new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', timeZone: ds.meta.timezone }).format(new Date(at))} `;

  return (
    <section className="rescue">
      <h1>{label === 'home' ? r.title : r.otherWays}</h1>
      <p className="leg">{r.leg(name(fromStopId), name(homeStopId))}</p>
      <p className="small">{r.scheduleOnly(clock(result.searchedUntil), result.options.some((o) => o.lastOnLine))}</p>
      {!soon.length && <p className="warn" role="note">{r.none}</p>}
      <ol className="rescue-list">
        {result.options.map((o) => {
          const gate = gateText(o);
          return (
            <li key={o.dep.tripInstanceId}>
              <button className="dep" onClick={() => onOpen(o)}>
                {badge(o.dep.route.id)}
                <span className="dep-main">
                  <span className="dep-time">{day(o.dep.departs)}{o.dep.estimated ? '~' : ''}{clock(o.dep.departs)}</span>
                  <span className="dep-sub">{r.arrives(`${o.arrivesEstimated ? '~' : ''}${clock(o.arrives)}`, name(o.alightStopId))}</span>
                  {o.acrossFromBoard && <span className="dep-sub">{r.acrossBoard(name(o.boardStopId))}</span>}
                  {o.acrossFromHome && <span className="dep-sub">{r.acrossHome}</span>}
                  {gate && <span className="dep-gate">{gate}</span>}
                </span>
                <span className="dep-right">
                  {o.lastOnLine && <span className="tag">{o.lastUnconfirmed ? r.lastUnconfirmed
                    : localHour(o.dep.departs, ds.meta.timezone) >= 4 && localHour(o.dep.departs, ds.meta.timezone) < 18 ? r.lastToday : r.lastOnLine}</span>}
                  {o.sameLine && !o.lastOnLine && <span className="muted small">{r.sameLine}</span>}
                  <span className="badge-sched">{t.scheduledOnly}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small" role="note">{r.coverage(result.routesSearched.join(', '))}</p>
      <p className="muted small">{r.noWalking}</p>
      {result.limitations.includes('printed_timepoints_only') && <p className="muted small">{r.printed}</p>}
    </section>
  );
}
