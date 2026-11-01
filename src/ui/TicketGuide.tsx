// Teaching illustrations of what NJ Transit bus tickets look like, so a first-time rider knows what to
// buy and what to show. Original drawings: no agency logo, no scannable code, fixed example values and
// a SAMPLE watermark, so they can never pass for a real ticket. Facts in the notes are from
// njtransit.com (ticket policy July 2024, bus tickets page, MyTix page), checked 2026-11-01.

import { useId, useState } from 'react';
import type { Strings } from './i18n';

/** Numbered marker drawn on the illustration; the legend below carries the words. */
function Mark({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r="10" fill="#1565c0" stroke="#fff" strokeWidth="2" />
      <text x={x} y={y + 4.5} textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">{n}</text>
    </g>
  );
}

/** Hatched box where a real ticket's code would be. Deliberately not a QR or barcode. */
function CodeBox({ x, y, size, label, id }: { x: number; y: number; size: number; label: string; id: string }) {
  return (
    <g>
      <defs>
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa39d" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={size} height={size} rx="3" fill={`url(#${id})`} stroke="#5b675f" strokeWidth="1.5" />
      <rect x={x + size / 2 - 24} y={y + size / 2 - 10} width="48" height="20" rx="4" fill="#fff" />
      <text x={x + size / 2} y={y + size / 2 + 4.5} textAnchor="middle" fontSize="12" fontWeight="700" fill="#5b675f">{label}</text>
    </g>
  );
}

function Watermark({ text, w, h, clip }: { text: string; w: number; h: number; clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}><g aria-hidden="true" transform={`rotate(-28 ${w / 2} ${h / 2})`} pointerEvents="none">
      {[-1, 0, 1].map((k) => (
        <text key={k} x={w / 2} y={h / 2 + k * 92} textAnchor="middle" fontSize="19" fontWeight="900" letterSpacing="1.5"
          fill="#c62828" fillOpacity="0.32" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6">{text}</text>
      ))}
    </g></g>
  );
}

function PaperTicket({ t }: { t: Strings }) {
  const uid = useId().replace(/:/g, '');
  const W = 230, H = 330;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ticket-svg" role="img" aria-label={t.paperTicketAlt}>
      <defs>
        {/* Fine wavy security-paper lines: decorative, generated, not copied from a real ticket. */}
        <pattern id={`${uid}g`} width="24" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4 Q6 0 12 4 T24 4" fill="none" stroke="#d98f8a" strokeWidth="0.7" />
        </pattern>
        <clipPath id={`${uid}k`}><rect x="8" y="8" width={W - 16} height={H - 16} rx="10" /></clipPath>
      </defs>
      <rect x="8" y="8" width={W - 16} height={H - 16} rx="10" fill="#f6cfcb" />
      <rect x="8" y="8" width={W - 16} height={H - 16} rx="10" fill={`url(#${uid}g)`} />
      <rect x="8" y="8" width={W - 16} height={H - 16} rx="10" fill="none" stroke="#b5655f" strokeWidth="1.5" />
      <text x="24" y="34" fontSize="10" fill="#6b2b27" fontFamily="ui-monospace, monospace">0000 0000 0000</text>
      <CodeBox x={70} y={42} size={90} label={t.codeLabel} id={`${uid}c`} />
      <text x={W / 2} y={160} textAnchor="middle" fontSize="15" fontWeight="700" fill="#3b1513" fontFamily="ui-monospace, monospace">EXP: MM/DD/YYYY</text>
      <text x={W / 2} y={188} textAnchor="middle" fontSize="20" fontWeight="900" letterSpacing="3" fill="#3b1513">INTERSTATE</text>
      <text x={W / 2} y={252} textAnchor="middle" fontSize="70" fontWeight="900" fill="#3b1513">2</text>
      <text x={W / 2} y={278} textAnchor="middle" fontSize="16" fontWeight="800" letterSpacing="2" fill="#3b1513">ZONE RIDE</text>
      <text x={W / 2} y={300} textAnchor="middle" fontSize="12" fontWeight="700" fill="#3b1513">ONE WAY · BUS</text>
      <Watermark text={t.sampleWatermark} w={W} h={H} clip={`${uid}k`} />
      <Mark n={1} x={172} y={60} />
      <Mark n={2} x={204} y={155} />
      <Mark n={3} x={204} y={183} />
      <Mark n={4} x={160} y={222} />
      <Mark n={5} x={196} y={296} />
    </svg>
  );
}

function AppTicket({ t }: { t: Strings }) {
  const uid = useId().replace(/:/g, '');
  const W = 230, H = 400;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ticket-svg" role="img" aria-label={t.appTicketAlt}>
      <defs><clipPath id={`${uid}k`}><rect x="22" y="22" width={W - 44} height={H - 44} rx="8" /></clipPath></defs>
      <rect x="12" y="4" width={W - 24} height={H - 8} rx="26" fill="#1d1d1d" />
      <rect x="22" y="22" width={W - 44} height={H - 44} rx="8" fill="#ffffff" />
      <rect x="22" y="22" width={W - 44} height="40" rx="8" fill="#ffffff" />
      <text x={W / 2} y={50} textAnchor="middle" fontSize="20" fontWeight="900" letterSpacing="1" fill="#c62828">INTERSTATE</text>
      <rect x="30" y="62" width={W - 60} height="74" rx="6" fill="#e3f2e6" stroke="#9cc9a6" />
      <text x={W / 2} y={114} textAnchor="middle" fontSize="54" fontWeight="900" fill="#111">2</text>
      <text x={W / 2} y={130} textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="1" fill="#111">ZONE RIDE</text>
      <rect x="30" y="144" width={W - 60} height="96" rx="4" fill="#fff" stroke="#c9cfca" />
      <text x="38" y="164" fontSize="12" fontWeight="700" fill="#111">One Way</text>
      <text x="38" y="184" fontSize="12" fill="#111">1 Adult</text>
      <CodeBox x={118} y={150} size={84} label={t.codeLabel} id={`${uid}c`} />
      <text x={W / 2} y={262} textAnchor="middle" fontSize="11" fontWeight="700" fill="#c62828">*ID REQUIRED</text>
      <text x={W / 2} y={286} textAnchor="middle" fontSize="18" fontWeight="800" fill="#111" fontFamily="ui-monospace, monospace">--:--:-- AM</text>
      <text x={W / 2} y={304} textAnchor="middle" fontSize="11" fill="#333">Weekday, Mon DD, YYYY</text>
      <rect x="30" y="314" width="56" height="10" fill="#3949ab" />
      <rect x="86" y="314" width="58" height="10" fill="#43a047" />
      <rect x="144" y="314" width="56" height="10" fill="#8e24aa" />
      <text x={W / 2} y={346} textAnchor="middle" fontSize="11" fill="#333">Expires in --:--</text>
      <Watermark text={t.sampleWatermark} w={W} h={H} clip={`${uid}k`} />
      <Mark n={1} x={196} y={44} />
      <Mark n={2} x={186} y={100} />
      <Mark n={3} x={98} y={178} />
      <Mark n={4} x={210} y={226} />
      <Mark n={5} x={196} y={292} />
    </svg>
  );
}

export function TicketGuide({ t, defaultOpen }: { t: Strings; defaultOpen: boolean }) {
  const [kind, setKind] = useState<'paper' | 'app'>('paper');
  const notes = kind === 'paper' ? t.paperNotes : t.appNotes;
  return (
    <details className="card ticket-guide" open={defaultOpen}>
      <summary><h2>{t.ticketGuideTitle}</h2></summary>
      <p className="small muted">{t.ticketGuideIntro}</p>
      <div className="choice-list" role="group" aria-label={t.ticketGuideTitle}>
        <button className="chip" aria-pressed={kind === 'paper'} onClick={() => setKind('paper')}>{t.paperTicket}</button>
        <button className="chip" aria-pressed={kind === 'app'} onClick={() => setKind('app')}>{t.appTicket}</button>
      </div>
      <div className="ticket-figure">{kind === 'paper' ? <PaperTicket t={t} /> : <AppTicket t={t} />}</div>
      <ol className="ticket-notes">
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ol>
    </details>
  );
}
