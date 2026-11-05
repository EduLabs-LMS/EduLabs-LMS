'use client';
import { useId, useRef, useState } from 'react';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { Loader2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { spaceName as spaceNameRule } from '@/shared/contracts/platform-provisioning';
import { inkButton, plainButton } from '@/frontend/features/teacher-home/parts';

export type SpaceRow = { id: string; name: string; owner: boolean };
type Failure = Extract<MessageKey, `ts.space.${'invalid' | 'denied' | 'failed' | 'unknown' | 'signin'}`>;
const tall = '!min-h-[48px]';

/**
 * Settings > My account: the name of each teaching space the teacher works in. Only the owner gets Rename; the database decides again
 * (rename_my_teaching_space answers 403 to anyone else), so this only hides a button that would be refused.
 */
export function SpaceNames({ spaces }: { spaces: SpaceRow[] }) {
  const router = useLoadingRouter();
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!spaces.length) return null;
  return <section aria-labelledby="ts-space-h" data-space-names data-tour="space-name" className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6">
    <h2 id="ts-space-h" className="font-display text-2xl"><L id="ts.space.title" /></h2>
    <p className="mt-2 text-base text-slate-700"><L id="ts.space.intro" /></p>
    <ul className="mt-4 divide-y-2 divide-black/15 border-y-2 border-black/15">
      {spaces.map(s => <li key={s.id} data-space={s.id} className="py-3">
        {editing === s.id
          ? <Editor space={s} current={names[s.id] ?? s.name} onCancel={() => setEditing(null)} onSaved={name => { setNames(n => ({ ...n, [s.id]: name })); setEditing(null); setSaved(s.id); router.refresh(); }} />
          : <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p data-space-name className="break-words text-lg font-bold"><bdi dir="auto">{names[s.id] ?? s.name}</bdi></p>
              {!s.owner && <p className="text-base text-slate-700"><L id="ts.space.only_owner" /></p>}
              {saved === s.id && <p role="status" data-space-saved className="text-base font-bold"><L id="ts.space.saved" /></p>}
            </div>
            {s.owner && <button type="button" data-space-rename onClick={() => { setSaved(null); setEditing(s.id); }} aria-label={undefined} className={`${plainButton} ${tall}`}><L id="ts.space.rename" /></button>}
          </div>}
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
  return <form onSubmit={submit} noValidate data-space-form className="space-y-3">
    <label htmlFor={field} className="block text-base font-bold"><L id="ts.space.field" /></label>
    <input id={field} data-space-input value={value} onChange={e => setValue(e.target.value)} maxLength={200} dir="auto" autoComplete="off" autoFocus aria-invalid={error === 'ts.space.invalid'}
      className="min-h-[48px] w-full rounded-2xl border-2 border-black bg-white px-3 text-base text-black" />
    {error && <p role="alert" className="text-base font-bold text-rose-800">{t(error)}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" data-space-save disabled={busy} className={`${inkButton} ${tall}`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.space.save" /></button>
      <button type="button" data-space-cancel disabled={busy} onClick={onCancel} className={`${plainButton} ${tall}`}><L id="ts.space.cancel" /></button>
    </div>
  </form>;
}
