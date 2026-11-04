// The rider's own backup plans on the rescue screen (issue #62): their notes, kept on this phone,
// never presented as Dale schedule data and never checked by Dale.
import { useEffect, useId, useRef, useState } from 'react';
import { cleanBackupPlan, loadBackupPlans, MAX_NOTE, MAX_PLACE, MAX_PLAN, MAX_PLANS, removeBackupPlan, saveBackupPlans, upsertBackupPlan, type BackupPlan } from '../domain/backupPlans';
import type { Strings } from './i18n';

const store = (() => { try { return window.localStorage; } catch { return undefined; } })();

export function BackupPlans({ t }: { t: Strings }) {
  const b = t.backups;
  const [plans, setPlans] = useState(() => loadBackupPlans(store));
  // 'new', a plan id being edited, or undefined when no form is open.
  const [editing, setEditing] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<string | undefined>();
  const addButton = useRef<HTMLButtonElement>(null);
  const update = (fn: (l: BackupPlan[]) => BackupPlan[]) => setPlans((l) => { const next = fn(l); saveBackupPlans(store, next); return next; });
  const close = () => { setEditing(undefined); requestAnimationFrame(() => addButton.current?.focus()); };

  return (
    <section className="card backups" aria-labelledby="backups-heading">
      <h2 id="backups-heading">{b.title}</h2>
      <p className="muted small" role="note">{b.notDale}</p>
      {!plans.length && editing === undefined && <p className="small">{b.empty}</p>}
      <ol className="backup-list">
        {plans.map((p) => editing === p.id
          ? <li key={p.id}><PlanForm t={t} plan={p} onSave={(np) => { update((l) => upsertBackupPlan(l, np)); close(); }} onCancel={close} /></li>
          : <li key={p.id} className="backup">
            <p className="backup-plan">{p.plan}</p>
            {p.place && <p className="small">{b.placeIs(p.place)}</p>}
            {p.note && <p className="small backup-note">{p.note}</p>}
            {confirming === p.id
              ? <div className="edit-row" role="group" aria-label={b.confirmRemove}>
                <span className="small">{b.confirmRemove}</span>
                <button className="danger" onClick={() => { update((l) => removeBackupPlan(l, p.id)); setConfirming(undefined); requestAnimationFrame(() => addButton.current?.focus()); }}>{b.yesRemove}</button>
                <button className="ghost" onClick={() => setConfirming(undefined)}>{b.keep}</button>
              </div>
              : <div className="edit-row">
                <button className="ghost" onClick={() => { setConfirming(undefined); setEditing(p.id); }}>{b.edit}</button>
                <button className="ghost" onClick={() => setConfirming(p.id)}>{b.remove}</button>
              </div>}
          </li>)}
      </ol>
      {editing === 'new'
        ? <PlanForm t={t} onSave={(np) => { update((l) => upsertBackupPlan(l, np)); close(); }} onCancel={close} />
        : plans.length < MAX_PLANS && <button ref={addButton} className="ghost" onClick={() => setEditing('new')}>＋ {b.add}</button>}
      <p className="muted small">{b.local}</p>
    </section>
  );
}

function PlanForm({ t, plan, onSave, onCancel }: { t: Strings; plan?: BackupPlan; onSave: (p: BackupPlan) => void; onCancel: () => void }) {
  const b = t.backups;
  const [text, setText] = useState(plan?.plan ?? '');
  const [place, setPlace] = useState(plan?.place ?? '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [bad, setBad] = useState(false);
  const errorId = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  function save() {
    const clean = cleanBackupPlan({ id: plan?.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, plan: text, place, note });
    if (!clean) { setBad(true); first.current?.focus(); return; }
    onSave(clean);
  }
  return (
    <div className="backup-form">
      <label>{b.planLabel}<input ref={first} value={text} maxLength={MAX_PLAN} placeholder={b.planExample} aria-invalid={bad || undefined} aria-describedby={bad ? errorId : undefined} onChange={(e) => setText(e.currentTarget.value)} /></label>
      <label>{b.placeLabel}<input value={place} maxLength={MAX_PLACE} onChange={(e) => setPlace(e.currentTarget.value)} /></label>
      <label>{b.noteLabel}<textarea value={note} maxLength={MAX_NOTE} rows={3} onChange={(e) => setNote(e.currentTarget.value)} /></label>
      {bad && <p className="warn small" role="alert" id={errorId}>{b.needPlan}</p>}
      <div className="edit-row">
        <button className="primary" onClick={save}>{b.save}</button>
        <button className="ghost" onClick={onCancel}>{b.cancel}</button>
      </div>
    </div>
  );
}
