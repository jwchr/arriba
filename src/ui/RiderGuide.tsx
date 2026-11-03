// First-ride guide (UX-07): numbered steps from NJ Transit's printed route 165 timetable and njtransit.com.
// The words live in i18n `guide`, which names its sources; this only lays them out.

import type { Strings } from './i18n';

export function RiderGuide({ t }: { t: Strings }) {
  const g = t.guide;
  return (
    <section className="guide">
      <h1>{g.title}</h1>
      <p>{g.intro}</p>
      {g.sections.map((s) => (
        <div className="card" key={s.title}>
          <h2>{s.title}</h2>
          <ol className="guide-steps">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol>
        </div>
      ))}
      <a className="link" href="tel:+19732755555">{g.call}</a>
      <p className="muted small">{g.sources}</p>
    </section>
  );
}
