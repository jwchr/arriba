import { useEffect, useRef, useState } from 'react';
import { departureKey, MAX_DEPARTURE_QUERIES, parseDepartureBatch, type DepartureBatch, type DepartureRequest } from '../domain/liveDepartures';
import type { Dataset } from '../domain/types';
export function useLiveDepartures(ds: Dataset, requests: DepartureRequest[], api: string | undefined, now: number) {
  const enabled = !ds.meta.demo && !ds.meta.transcribed && ds.meta.realtime?.provider === 'njt-bus-g2';
  const clock = useRef(now); clock.current = now;
  const queries = [...new Map(requests.map(q => [departureKey(q), q])).values()].slice(0, MAX_DEPARTURE_QUERIES);
  const key = JSON.stringify(queries);
  const [result, setResult] = useState<{ key: string; state: 'checking' | 'available' | 'unavailable'; batch?: DepartureBatch }>();
  useEffect(() => {
    if (!enabled || !api || !queries.length) return;
    let stopped = false, running = false, ctl: AbortController | undefined, next: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState !== 'hidden';
    setResult({ key, state: 'checking' });
    async function poll() {
      if (stopped || running || !visible()) return;
      running = true; ctl = new AbortController(); const timeout = setTimeout(() => ctl?.abort(), 12_000);
      try {
        const url = new URL('/v1/departures', api); url.searchParams.set('q', key);
        const response = await fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (!response.ok) throw new Error('Live arrivals unavailable');
        const batch = parseDepartureBatch(await response.json(), ds, queries, clock.current);
        if (!stopped && visible()) setResult({ key, state: 'available', batch });
      } catch { if (!stopped && visible()) setResult({ key, state: 'unavailable' }); }
      finally { clearTimeout(timeout); running = false; if (!stopped && visible()) next = setTimeout(() => void poll(), 30_000); }
    }
    const onVisibility = () => { clearTimeout(next); if (!visible()) ctl?.abort(); else void poll(); };
    document.addEventListener('visibilitychange', onVisibility); void poll();
    return () => { stopped = true; clearTimeout(next); ctl?.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled, api, ds, key]);
  return enabled ? result?.key === key && api ? result : { key, state: api ? 'checking' as const : 'unavailable' as const } : undefined;
}
