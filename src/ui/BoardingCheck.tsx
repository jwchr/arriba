// Boarding check (issue #55): one compact screen for the curb or the gate, plus a large bilingual card
// to show the driver. It checks the scheduled trip the rider picked, never the physical bus: a route
// number alone does not identify a bus, so the card asks the driver to confirm.
import { useState } from 'react';
import { tripStopTimes } from '../domain/schedule';
import { formatTime12 } from '../domain/time';
import type { Dataset, Departure } from '../domain/types';
import type { Lang, Strings } from './i18n';
import { strings } from './i18n';

interface Props {
  ds: Dataset;
  dep: Departure;
  toStopId: string;
  t: Strings;
  lang: Lang;
  /** The gate line with its source, when boarding at Port Authority. */
  gate?: string;
}

export function BoardingCheck({ ds, dep, toStopId, t, lang, gate }: Props) {
  const c = t.boarding;
  const [card, setCard] = useState(false);
  const name = (id: string) => ds.stops.find((s) => s.id === id)?.name ?? id;
  const clock = (at: number) => formatTime12(at, ds.meta.timezone, lang);
  const alightIndex = dep.pattern.stopIds.indexOf(toStopId, dep.stopIndex + 1);
  const at = alightIndex > dep.stopIndex ? tripStopTimes(ds, dep)[alightIndex] : undefined;
  const dest = name(toStopId);
  const variant = dep.pattern.variant ? t.variantNotes[dep.pattern.variant] : undefined;

  if (card) {
    // Both languages at once, whatever the app language: the driver may read either.
    return (
      <section className="driver-card" aria-label={c.cardLabel}>
        <p className="driver-q" lang="en">{strings.en.boarding.ask(dest)}</p>
        <p className="driver-q" lang="es">{strings.es.boarding.ask(dest)}</p>
        <p className="driver-route">{dep.route.shortName} · {dep.pattern.headsign}</p>
        <button className="primary wide" onClick={() => setCard(false)}>{c.closeCard}</button>
      </section>
    );
  }
  return (
    <section className="boarding-check">
      <h1>{c.title}</h1>
      <dl className="lock-facts">
        <div><dt>{c.route}</dt><dd>{dep.route.shortName}{variant ? ` · ${variant}` : ''}</dd></div>
        <div><dt>{c.direction}</dt><dd>{dep.pattern.headsign}</dd></div>
        <div><dt>{c.leaves}</dt><dd>{dep.estimated ? '~' : ''}{clock(dep.departs)} · {name(dep.pattern.stopIds[dep.stopIndex]!)}</dd></div>
        <div><dt>{c.gettingOff}</dt><dd>{dest}</dd></div>
      </dl>
      {at
        ? <p className="boarding-ok" role="status">{c.serves(dest, `${at.estimated ? '~' : ''}${clock(at.at)}`)}</p>
        : <p className="warn" role="alert">{c.notServed(dest)}</p>}
      {ds.meta.transcribed && <p className="muted small">{c.printed}</p>}
      {gate && <p className="dep-gate">{gate}</p>}
      <p className="small">{c.checkSign}</p>
      <button className="primary wide" onClick={() => setCard(true)}>{c.showCard}</button>
      <p className="muted small">{c.notThisBus}</p>
    </section>
  );
}
