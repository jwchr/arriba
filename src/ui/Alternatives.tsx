import type { Strings } from './i18n';
export function Alternatives({ t, onBuses, onGuide }: { t: Strings; onBuses: () => void; onGuide: () => void }) {
  const a = t.confidence;
  return <details className="card alternatives">
    <summary>{a.alternatives}</summary><h3>{a.alternativesTitle}</h3><p>{a.preserve}</p>
    <button className="primary wide" onClick={onBuses}>{a.otherBuses}</button>
    <p>{a.backups}</p><button className="wide" onClick={onGuide}>{a.train}</button>
    <h3>{a.rideshare}</h3><div className="choice-list">
      <a className="link" href="https://m.uber.com/" target="_blank" rel="noreferrer">{a.uber}</a>
      <a className="link" href="https://www.lyft.com/rider" target="_blank" rel="noreferrer">{a.lyft}</a>
    </div><p className="small">{a.rideHelp}</p>
  </details>;
}
