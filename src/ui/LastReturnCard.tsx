import { useMemo } from 'react';
import { lastReturn } from '../domain/lastReturn';
import { formatTime12, localYmd } from '../domain/time';
import type { Dataset, Departure } from '../domain/types';
import type { Lang, Strings } from './i18n';

interface ReturnLeg { fromStopId: string; toStopId: string; routeIds: string[] }
interface Props {
  ds: Dataset;
  outbound: Departure;
  toStopId: string;
  t: Strings;
  lang: Lang;
  onOpen: (dep: Departure, leg: ReturnLeg) => void;
}

/** Always show the service-day boundary and the following departure; never infer an end of service. */
export function LastReturnCard({ ds, outbound, toStopId, t, lang, onOpen }: Props) {
  const result = useMemo(() => lastReturn(ds, outbound, toStopId), [ds, outbound, toStopId]);
  if (result.status === 'not_applicable') return null;
  const l = t.lastReturn;
  const fmtDate = (date: string) => lang === 'es'
    ? `${+date.slice(6, 8)}/${+date.slice(4, 6)}/${date.slice(0, 4)}`
    : `${+date.slice(4, 6)}/${+date.slice(6, 8)}/${date.slice(0, 4)}`;
  const time = (dep: Departure) => `${dep.estimated ? '~' : ''}${formatTime12(dep.departs, ds.meta.timezone, lang)} · ${fmtDate(localYmd(dep.departs, ds.meta.timezone))}`;
  const stop = ds.stops.find((s) => s.id === result.returnLeg?.toStopId);
  const usable = (dep: Departure) => !!result.window && dep.departs >= result.window.from;
  const open = (dep: Departure) => { if (result.returnLeg) onOpen(dep, { ...result.returnLeg, routeIds: [result.routeId] }); };
  return (
    <section className="card last-return" aria-labelledby="last-return-heading">
      <h2 id="last-return-heading">{l.title}</h2>
      <p className="small">{l.operatingDay(outbound.route.shortName, fmtDate(result.serviceDate))}</p>
      {stop && <p className="small">{l.destination(stop.name)}</p>}
      {result.status === 'unconfirmed' && <p className="warn small">{l.unconfirmed}</p>}
      {result.status === 'no_return_listed' && <p className="warn small">{l.noReturn}</p>}
      {result.status === 'continues_overnight' && <p className="small">{l.ongoing}</p>}
      {result.limitations.includes('holiday_schedule_missing') && <p className="warn small">{l.holiday}</p>}
      {result.limitations.includes('no_reverse_stop') && <p className="small">{l.noReverse}</p>}
      {result.lastForServiceDay && <>
        <p className="small">{l.finalListed}</p>
        <p className="return-time"><strong>{time(result.lastForServiceDay)}</strong></p>
        {usable(result.lastForServiceDay) && <button className="wide" onClick={() => open(result.lastForServiceDay!)}>{l.open}</button>}
      </>}
      {result.previous && <div className="return-option">
        <p className="small">{l.previous}: <strong>{time(result.previous)}</strong></p>
        <button className="ghost wide" onClick={() => open(result.previous!)}>{l.earlier}</button>
      </div>}
      {result.nextAfterLast ? <p className="small">{l.next}: <strong>{time(result.nextAfterLast)}</strong></p>
        : result.lastForServiceDay && <p className="muted small">{l.unknownNext}</p>}
      {!result.lastForServiceDay && !result.limitations.includes('no_reverse_stop') && result.status === 'unconfirmed' && <p className="small">{l.missing}</p>}
      <p className="muted small">{l.schedule}</p>
      {ds.meta.transcribed && <p className="muted small">{l.printed}</p>}
    </section>
  );
}
