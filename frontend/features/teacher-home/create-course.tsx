'use client';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import { Button } from '@/frontend/components/design/button';
import { Dialog } from '@/frontend/components/design/dialog';
import { Field } from '@/frontend/components/design/field';
import { api } from '@/frontend/lib/api';
import { courseSlug, type CreateTarget } from '@/shared/teacher-home';

type Failure = 'th.create.need_title' | 'th.create.failed' | 'th.create.denied' | 'th.state.error_401';

/** The button and its dialog, where a page has no header action to hold it (a first visit). */
export function CreateCourse({ targets, variant = 'primary' }: { targets: CreateTarget[]; variant?: 'primary' | 'secondary' }) {
  const [open, setOpen] = useState(false);
  if (!targets.length) return <CreateUnavailable />;
  return <>
    <Button type="button" variant={variant} data-create-course onClick={() => setOpen(true)}><Plus aria-hidden className="h-5 w-5" /><L id="th.courses.create" /></Button>
    <CreateCourseDialog targets={targets} open={open} onOpenChange={setOpen} />
  </>;
}

export function CreateUnavailable() {
  return <p data-state="create-unavailable" className="d-meta"><L id="th.create.unavailable" /></p>;
}

/** Creates a course through the existing teacher course endpoint. The server checks permission again; this only hides what it would refuse. */
export function CreateCourseDialog({ targets, open, onOpenChange }: { targets: CreateTarget[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useLoadingRouter();
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [space, setSpace] = useState(targets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const done = useRef(false);
  const field = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || done.current) return;
    const name = title.trim();
    if (!name) { setError('th.create.need_title'); return; }
    setBusy(true); setError(null);
    try {
      const slug = courseSlug(name, () => crypto.randomUUID());
      const response = await api.post<{ id?: string }>('/api/teacher/courses', { organization_id: space, title: name, slug });
      done.current = true;
      router.push(response.data.id ? `/teacher/courses/${response.data.id}` : '/teacher/courses');
      router.refresh();
    } catch (failure) {
      const status = (failure as { response?: { status?: number } }).response?.status;
      setError(status === 401 ? 'th.state.error_401' : status === 403 ? 'th.create.denied' : 'th.create.failed');
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy) { onOpenChange(value); setError(null); } }} title={<L id="th.create.title" />} description={<L id="th.create.intro" />}>
    <form onSubmit={submit} className="d-stack-form" noValidate>
      <Field label={<L id="th.create.name" />} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} dir="auto" autoComplete="off" error={error === 'th.create.need_title' ? t(error) : undefined} />
      {targets.length > 1 && <div className="d-field">
        <label htmlFor={`${field}-space`} className="d-field-label"><L id="th.create.space" /></label>
        <Select id={`${field}-space`} value={space} onChange={setSpace} options={targets.map(x => ({ value: x.id, label: x.name }))} />
      </div>}
      {error && error !== 'th.create.need_title' && <p role="alert" className="d-field-error">{t(error)}</p>}
      <div className="d-dialog-footer">
        <Button type="button" disabled={busy} onClick={() => onOpenChange(false)}><L id="th.create.cancel" /></Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? <L id="th.create.working" /> : <L id="th.create.submit" />}</Button>
      </div>
    </form>
  </Dialog>;
}
