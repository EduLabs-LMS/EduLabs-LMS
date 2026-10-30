'use client';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/frontend/components/ui/dialog';
import { api } from '@/frontend/lib/api';
import { courseSlug, type CreateTarget } from '@/shared/teacher-home';
import { cn } from '@/shared/utils';
import { inkButton, plainButton, primaryButton } from './parts';

type Failure = 'th.create.need_title' | 'th.create.failed' | 'th.create.denied' | 'th.state.error_401';

/** Creates a course through the existing teacher course endpoint. The server checks permission again; this only hides what it would refuse. */
export function CreateCourse({ targets, className, ink = false }: { targets: CreateTarget[]; className?: string; ink?: boolean }) {
  const router = useLoadingRouter();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [space, setSpace] = useState(targets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const done = useRef(false);
  const field = useId();
  if (!targets.length) return <p data-state="create-unavailable" className={cn('text-base text-slate-700', className)}><L id="th.create.unavailable" /></p>;

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

  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(null); } }}>
    <DialogTrigger asChild><button type="button" data-create-course className={cn(ink ? inkButton : primaryButton, className)}><Plus aria-hidden className="h-5 w-5" /><L id="th.courses.create" /></button></DialogTrigger>
    <DialogContent aria-describedby={`${field}-intro`}>
      <DialogTitle className="font-display text-2xl"><L id="th.create.title" /></DialogTitle>
      <DialogDescription id={`${field}-intro`} className="text-base text-slate-700"><L id="th.create.intro" /></DialogDescription>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label htmlFor={`${field}-title`} className="block text-base font-bold"><L id="th.create.name" /></label>
          <input id={`${field}-title`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} dir="auto" autoComplete="off" aria-invalid={error === 'th.create.need_title'} className="min-h-[44px] w-full rounded-2xl border-2 border-black bg-white px-3 text-base text-black" />
        </div>
        {targets.length > 1 && <div className="space-y-2">
          <label htmlFor={`${field}-space`} className="block text-base font-bold"><L id="th.create.space" /></label>
          <select id={`${field}-space`} value={space} onChange={e => setSpace(e.target.value)} className="min-h-[44px] w-full rounded-2xl border-2 border-black bg-white px-3 text-base text-black">{targets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>}
        {error && <p role="alert" className="text-base font-bold text-rose-800">{t(error)}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className={plainButton}><L id="th.create.cancel" /></button>
          <button type="submit" disabled={busy} className={primaryButton}>{busy ? <L id="th.create.working" /> : <L id="th.create.submit" />}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
