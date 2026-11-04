// The rider's own past reports for this scheduled bus (issue #57). Past personal observations from
// this phone, never today's bus, never NJ Transit data, with dates and sample counts.
import type { HistorySummary } from '../domain/reportHistory';
import type { DayType } from '../domain/reportHistory';
import type { Strings } from './i18n';

export function PastReports({ summary, dayType, t, fmtDate }: { summary: HistorySummary; dayType: DayType; t: Strings; fmtDate: (ymd: string) => string }) {
  const h = t.history;
  const c = summary.capacity;
  return (
    <section className="card past-reports" aria-labelledby="past-reports-heading">
      <h2 id="past-reports-heading">{h.title}</h2>
      <p className="small">{h.basis(h.dayType[dayType], summary.rides, fmtDate(summary.firstDate), fmtDate(summary.lastDate))}</p>
      <ul className="past-list">
        {summary.arrived && <li>{h.arrived(summary.arrived.count, summary.arrived.medianMin, summary.arrived.minMin, summary.arrived.maxMin)}</li>}
        {summary.noBus > 0 && <li>{h.noBus(summary.noBus)}</li>}
        {summary.passed > 0 && <li>{h.passed(summary.passed)}</li>}
        {c.seats + c.standing + c.full > 0 && <li>{h.capacity(c.seats, c.standing, c.full)}</li>}
      </ul>
      {summary.rides < 3 && <p className="muted small">{h.few}</p>}
      <p className="muted small" role="note">{h.note}</p>
    </section>
  );
}
