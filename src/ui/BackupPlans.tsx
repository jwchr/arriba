// The rider's own backup plans on the rescue screen (issue #62): their notes, kept on this phone,
// never presented as Dale schedule data and never checked by Dale.
import { useEffect, useId, useRef, useState } from 'react';
import { cleanBackupPlan, loadBackupPlans, MAX_NOTE, MAX_PLACE, MAX_PLAN, MAX_PLANS, removeBackupPlan, saveBackupPlans, upsertBackupPlan, type BackupPlan } from '../domain/backupPlans';
import type { Strings } from './i18n';

const store = (() => { try { return window.localStorage; } catch { return undefined; } })();
/** Whether this browser actually lets Dale save (private modes and blocked site data may not). */
const canStore = (() => { try { store?.setItem('arriba.probe', '1'); store?.removeItem('arriba.probe'); return !!store; } catch { return false; } })();

export function BackupPlans({ t }: { t: Strings }) {
  const b = t.backups;
  const [plans, setPlans] = useState(() => loadBackupPlans(store));
  // 'new', a plan id being edited, or undefined when no form is open.
  const [editing, setEditing] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<string | undefined>();
  const update = (fn: (l: BackupPlan[]) => BackupPlan[]) => setPlans((l) => { const next = fn(l); saveBackupPlans(store, next); return next; });
  // Every action says where focus goes next; the effect moves it once the new controls exist.
  const root = useRef<HTMLElement>(null);
  const [focusNext, setFocusNext] = useState<string | undefined>();
  useEffect(() => {
    if (!focusNext) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusNext)}"]`) ?? root.current?.querySelector<HTMLElement>('[data-focus="heading"]');
    el?.focus();
    setFocusNext(undefined);
  }, [focusNext]);
  const closeNew = () => { setEditing(undefined); setFocusNext('add'); };
  const closeEdit = (id: string) => { setEditing(undefined); setFocusNext(`edit-${id}`); };

  return (
    <section className="card backups" aria-labelledby="backups-heading" ref={root}>
      <h2 id="backups-heading" tabIndex={-1} data-focus="heading">{b.title}</h2>
      <p className="muted small" role="note">{b.notDale}</p>
      {!plans.length && editing === undefined && <p className="small">{b.empty}</p>}
      <ol className="backup-list">
        {plans.map((p) => editing === p.id
          ? <li key={p.id}><PlanForm t={t} plan={p} onSave={(np) => { update((l) => upsertBackupPlan(l, np)); closeEdit(p.id); }} onCancel={() => closeEdit(p.id)} /></li>
          : <li key={p.id} className="backup">
            <p className="backup-plan">{p.plan}</p>
            {p.place && <p className="small">{b.placeIs(p.place)}</p>}
            {p.note && <p className="small backup-note">{p.note}</p>}
            {confirming === p.id
              ? <div className="edit-row" role="group" aria-label={b.confirmRemove}>
                <span className="small">{b.confirmRemove}</span>
                <button className="danger" data-focus={`yes-${p.id}`} onClick={() => { update((l) => removeBackupPlan(l, p.id)); setConfirming(undefined); setFocusNext('add'); }}>{b.yesRemove}</button>
                <button className="ghost" onClick={() => { setConfirming(undefined); setFocusNext(`remove-${p.id}`); }}>{b.keep}</button>
              </div>
              : <div className="edit-row">
                <button className="ghost" data-focus={`edit-${p.id}`} onClick={() => { setConfirming(undefined); setEditing(p.id); }}>{b.edit}</button>
                <button className="ghost" data-focus={`remove-${p.id}`} onClick={() => { setConfirming(p.id); setFocusNext(`yes-${p.id}`); }}>{b.remove}</button>
              </div>}
          </li>)}
      </ol>
      {editing === 'new'
        ? <PlanForm t={t} onSave={(np) => { update((l) => upsertBackupPlan(l, np)); closeNew(); }} onCancel={closeNew} />
        : plans.length < MAX_PLANS && <button data-focus="add" className="ghost" onClick={() => setEditing('new')}>＋ {b.add}</button>}
      <p className="muted small" role={canStore ? undefined : 'note'}>{canStore ? b.local : b.notSaved}</p>
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
  const hintId = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  function save() {
    const clean = cleanBackupPlan({ id: plan?.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, plan: text, place, note });
    if (!clean) { setBad(true); first.current?.focus(); return; }
    onSave(clean);
  }
  return (
    <div className="backup-form">
      <label>{b.planLabel}<input ref={first} value={text} maxLength={MAX_PLAN} aria-invalid={bad || undefined} aria-describedby={bad ? `${hintId} ${errorId}` : hintId} onChange={(e) => setText(e.currentTarget.value)} /></label>
      <p className="muted small" id={hintId}>{b.planHint}</p>
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
