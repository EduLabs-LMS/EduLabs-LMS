'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import { useId, useRef, useState } from 'react';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { Loader2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { spaceName as spaceNameRule } from '@/shared/contracts/platform-provisioning';
import { Button } from '@/frontend/components/design/button';
import { Field } from '@/frontend/components/design/field';

export type SpaceRow = { id: string; name: string; owner: boolean };
type Failure = Extract<MessageKey, `ts.space.${'invalid' | 'denied' | 'failed' | 'unknown' | 'signin'}`>;

/**
 * Settings > My account: the name of each teaching space the teacher works in. Only the owner gets Rename; the database decides again
 * (rename_my_teaching_space answers 403 to anyone else), so this only hides a button that would be refused.
 */
export function SpaceNames({ spaces }: { spaces: SpaceRow[] }) {
  const { t } = useLanguage();
  const router = useLoadingRouter();
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!spaces.length) return null;
  return <section aria-labelledby="ts-space-h" data-space-names data-tour="space-name" className="d-card d-card--pad d-stack">
    <h2 id="ts-space-h" className="d-section"><L id="ts.space.title" /></h2>
    <p className="d-meta"><L id="ts.space.intro" /></p>
    <ul className="d-list">
      {spaces.map(s => <li key={s.id} data-space={s.id} className={editing === s.id ? 'd-space-editing' : 'd-row'}>
        {editing === s.id
          ? <Editor space={s} current={names[s.id] ?? s.name} onCancel={() => setEditing(null)} onSaved={name => { setNames(n => ({ ...n, [s.id]: name })); setEditing(null); setSaved(s.id); actionToast(t('ts.space.saved')); router.refresh(); }} />
          : <>
            <div className="d-row-body">
              <p data-space-name className="d-label d-wrap"><bdi dir="auto">{names[s.id] ?? s.name}</bdi></p>
              {!s.owner && <p className="d-meta"><L id="ts.space.only_owner" /></p>}
              {saved === s.id && <p role="status" data-space-saved className="d-meta"><L id="ts.space.saved" /></p>}
            </div>
            {s.owner && <Button type="button" data-space-rename onClick={() => { setSaved(null); setEditing(s.id); }}><L id="ts.space.rename" /></Button>}
          </>}
      </li>)}
    </ul>
  </section>;
}

function Editor({ space, current, onCancel, onSaved }: { space: SpaceRow; current: string; onCancel: () => void; onSaved: (name: string) => void }) {
  const { t } = useLanguage();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const done = useRef(false);
  const field = useId();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || done.current) return;
    const parsed = spaceNameRule.safeParse(value);
    if (!parsed.success) { setError('ts.space.invalid'); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/teacher/space', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: space.id, name: parsed.data }) });
      if (!response.ok) throw Object.assign(new Error('rename'), { status: response.status });
      done.current = true;
      onSaved(parsed.data);
    } catch (failure) {
      const status = (failure as { status?: number }).status;
      const unknown = status === undefined;
      setError(unknown ? 'ts.space.unknown' : status === 401 ? 'ts.space.signin' : status === 403 ? 'ts.space.denied' : status === 400 ? 'ts.space.invalid' : 'ts.space.failed');
      setBusy(false);
    }
  }
  return <form onSubmit={submit} noValidate data-space-form className="d-stack-form">
    <Field id={field} label={<L id="ts.space.field" />} data-space-input value={value} onChange={e => setValue(e.target.value)} maxLength={200} dir="auto" autoComplete="off" autoFocus error={error === 'ts.space.invalid' ? t(error) : undefined} />
    {error && error !== 'ts.space.invalid' && <p role="alert" className="d-field-error">{t(error)}</p>}
    <div className="d-actions">
      <Button type="submit" variant="primary" data-space-save disabled={busy}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.space.save" /></Button>
      <Button type="button" data-space-cancel disabled={busy} onClick={onCancel}><L id="ts.space.cancel" /></Button>
    </div>
  </form>;
}
