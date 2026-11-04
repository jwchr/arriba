// One-tap trip update (issue #61): the rider sends it through their own app (Web Share) or copies it.
// Dale itself sends nothing and includes no position.
import { useState } from 'react';
import type { BusSession } from '../domain/busLock';
import { tripUpdate } from '../domain/tripUpdate';
import { formatTime12 } from '../domain/time';
import type { Dataset } from '../domain/types';
import type { Lang, Strings } from './i18n';

/** The place without the dataset's "(to …)" direction hint, which means nothing to the person reading. */
const place = (name: string) => name.replace(/\s+\(to [^)]+\)$/i, '');

export function ShareUpdate({ ds, session, alightIndex, now, t, lang }: { ds: Dataset; session: BusSession; alightIndex: number; now: number; t: Strings; lang: Lang }) {
  const s = t.share;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const u = tripUpdate(ds, session, alightIndex, now);
  const clock = (at: number, estimated: boolean) => `${estimated ? '~' : ''}${formatTime12(at, ds.meta.timezone, lang)}`;
  const stopName = (id: string) => place(ds.stops.find((x) => x.id === id)?.name ?? id);
  const to = u.update.kind === 'onboard' && u.update.to ? { stop: stopName(u.update.to.stopId), time: clock(u.update.to.at, u.update.to.estimated) } : undefined;
  const text = `${u.demo ? s.demo : ''}${s.text(u.update, u.route, clock(u.departs, u.estimated), stopName(u.stopId), to)}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share() {
    try { await navigator.share({ text }); } catch { /* the rider closed the share sheet: nothing to do */ }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus('copied'); } catch { setStatus('failed'); }
  }
  if (!open) return <button className="ghost share-open" onClick={() => { setStatus('idle'); setOpen(true); }}>{s.open}</button>;
  return (
    <div className="share-update">
      <p className="share-text" data-testid="share-text">{text}</p>
      <div className="lock-actions">
        {canShare && <button className="primary" onClick={() => void share()}>{s.share}</button>}
        <button className={canShare ? '' : 'primary'} onClick={() => void copy()}>{s.copy}</button>
        <button className="ghost" onClick={() => setOpen(false)}>{s.close}</button>
      </div>
      <p className="small" role="status">{status === 'copied' ? s.copied : status === 'failed' ? s.copyFailed : ''}</p>
      <p className="muted small">{s.note}</p>
    </div>
  );
}
