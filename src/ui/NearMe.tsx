// "Stops near me" (issue #31): opt-in, one position from the phone, used on the phone to list nearby
// stops and then dropped. Never stored, logged or sent. The rider picks the stop; the direction guard
// and the printed fare zones still decide the rest. Hidden where stops have no coordinates.
import { useState } from 'react';
import { hasStopLocations, nearbyStops } from '../domain/direction';
import type { Dataset, Stop } from '../domain/types';
import type { Strings } from './i18n';

const RADIUS_M = 500;
/** A position less precise than this may not pick out the nearest corner. */
const ROUGH_M = 150;

type State =
  | { status: 'idle' }
  | { status: 'asking' }
  | { status: 'done'; results: { stop: Stop; distanceM: number }[]; accuracyM: number }
  | { status: 'denied' | 'failed' | 'unsupported' };

export function NearMe({ ds, t, onPick }: { ds: Dataset; t: Strings; onPick: (s: Stop) => void }) {
  const n = t.nearMe;
  const [state, setState] = useState<State>({ status: 'idle' });
  if (!hasStopLocations(ds)) return <p className="muted small" role="note">{n.unavailable}</p>;

  function ask() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState({ status: 'unsupported' }); return; }
    setState({ status: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        // Only the stop list and the stated accuracy survive this callback; the coordinates do not.
        const results = nearbyStops(ds, { lat: p.coords.latitude, lon: p.coords.longitude }, RADIUS_M);
        setState({ status: 'done', results, accuracyM: Math.round(p.coords.accuracy) });
      },
      (e) => setState({ status: e.code === e.PERMISSION_DENIED ? 'denied' : 'failed' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="near-me">
      <button onClick={ask} disabled={state.status === 'asking'}>{n.button}</button>
      <p className="muted small">{n.explain}</p>
      <div role="status">
        {state.status === 'asking' && <p className="small">{n.asking}</p>}
        {state.status === 'denied' && <p className="warn small">{n.denied}</p>}
        {state.status === 'failed' && <p className="warn small">{n.failed}</p>}
        {state.status === 'unsupported' && <p className="warn small">{n.unsupported}</p>}
        {state.status === 'done' && !state.results.length && <p className="small">{n.none(RADIUS_M)}</p>}
        {state.status === 'done' && state.results.length > 0 && <>
          <p className="small">{n.results(state.accuracyM)}</p>
          {state.accuracyM > ROUGH_M && <p className="warn small">{n.rough}</p>}
        </>}
      </div>
      {state.status === 'done' && state.results.length > 0 && (
        <ul className="results">
          {state.results.map(({ stop, distanceM }) => (
            <li key={stop.id}><button onClick={() => onPick(stop)}><strong>{stop.name}</strong><span className="muted"> · {n.distance(distanceM)}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
