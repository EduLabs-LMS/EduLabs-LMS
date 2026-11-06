'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { PageHeader } from '@/frontend/components/design/page-header';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { useRetry } from '@/frontend/features/teacher-home/parts';
import type { MessageKey } from '@/frontend/locales/messages';
import type { StudyGroup } from '@/shared/contracts/groups';
import { GROUP_LENGTHS, MAX_WEEKLY_TIMES, checkGroupForm, editPayload, emptyGroupForm, emptyTime, failureKind, formFromGroup, placeChanged, timesRemoved, weeklyReference, type CourseChoice, type GroupForm, type GroupFormProblem, type WeeklyTime } from '@/shared/teacher-groups';
import { groupCall, postJson } from './api';
import { GroupError, useCommand } from './parts';

const field = 'd-field-input';
const problemText: Record<GroupFormProblem, MessageKey> = { name: 'tg.form.name_required', location: 'tg.form.location_required', join: 'tg.form.join_invalid', capacity: 'tg.form.capacity_invalid', times_required: 'tg.form.times_required', time: 'tg.form.time_invalid', times_duplicate: 'tg.form.times_duplicate' };

function Problem({ id, problems, of }: { id: string; problems: GroupFormProblem[]; of: GroupFormProblem[] }) {
  const shown = of.filter(p => problems.includes(p));
  if (!shown.length) return null;
  return <p id={id} role="alert" data-problem={shown[0]} className="d-field-error"><L id={problemText[shown[0]]} /></p>;
}

/** The fields Create and Edit share: flat rows, one column on a phone. */
function GroupFormFields({ form, set, problems }: { form: GroupForm; set: (next: GroupForm) => void; problems: GroupFormProblem[] }) {
  const { t, language } = useLanguage();
  const id = useId();
  const day = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' });
  const setTime = (i: number, change: Partial<GroupForm['times'][number]>) => set({ ...form, times: form.times.map((row, n) => n === i ? { ...row, ...change } : row) });
  return <>
    <label className="d-field" htmlFor={`${id}-n`} data-tour="group-name"><span className="d-field-label"><L id="tg.form.name" /></span>
      <input id={`${id}-n`} data-group-name className={field} value={form.name} maxLength={160} onChange={e => set({ ...form, name: e.target.value })} aria-invalid={problems.includes('name')} required /></label>
    <Problem id={`${id}-pn`} problems={problems} of={['name']} />

    <div className="d-stack-sm" data-tour="group-place">
      <p id={`${id}-w`} className="d-field-label"><L id="tg.form.where" /></p>
      <div role="group" aria-labelledby={`${id}-w`} className="d-actions">
        {(['center', 'online'] as const).map(mode => <Button key={mode} type="button" variant={form.mode === mode ? 'primary' : 'secondary'} data-mode={mode} aria-pressed={form.mode === mode} onClick={() => set({ ...form, mode })}><L id={mode === 'center' ? 'tg.mode.center' : 'tg.mode.online'} /></Button>)}
      </div>
      {form.mode === 'center'
        ? <label className="d-field" htmlFor={`${id}-l`}><span className="d-field-label"><L id="tg.form.location" /></span><input id={`${id}-l`} data-group-location className={field} value={form.location} maxLength={1000} onChange={e => set({ ...form, location: e.target.value })} aria-invalid={problems.includes('location')} /></label>
        : <label className="d-field" htmlFor={`${id}-j`}><span className="d-field-label"><L id="tg.form.join" /></span><input id={`${id}-j`} data-group-join dir="ltr" inputMode="url" className={field} value={form.joinUrl} maxLength={2000} placeholder="https://" onChange={e => set({ ...form, joinUrl: e.target.value })} aria-invalid={problems.includes('join')} /></label>}
      <Problem id={`${id}-pp`} problems={problems} of={['location', 'join']} />
    </div>

    <div className="d-stack-sm" data-tour="weekly-times">
      <p className="d-field-label"><L id="tg.form.times" /></p>
      <p className="d-meta"><L id="tg.form.times_hint" /></p>
      <ul className="d-list">
        {form.times.map((row, i) => <li key={i} data-time-row className="d-time-row">
          <label className="d-field d-time-day"><span className="d-field-label"><L id="tg.form.day" /></span>
            <Select data-time-day value={String(row.weekday)} onChange={v => setTime(i, { weekday: Number(v) })} options={[0, 1, 2, 3, 4, 5, 6].map(d => ({ value: String(d), label: day.format(new Date(weeklyReference(d, '12:00'))) }))} /></label>
          <label className="d-field"><span className="d-field-label"><L id="tg.form.start" /></span>
            <input type="time" data-time-start className={field} value={row.time} onChange={e => setTime(i, { time: e.target.value })} /></label>
          <label className="d-field"><span className="d-field-label"><L id="tg.form.length" /></span>
            <Select data-time-length value={String(row.durationMinutes)} onChange={v => setTime(i, { durationMinutes: Number(v) })} options={Array.from(new Set([...GROUP_LENGTHS, row.durationMinutes])).sort((a, b) => a - b).map(m => ({ value: String(m), label: t('tg.form.minutes', { count: m }) }))} /></label>
          <Button type="button" className="d-time-remove" data-time-remove aria-label={t('tg.form.remove_time')} title={t('tg.form.remove_time')} onClick={() => set({ ...form, times: form.times.filter((_, n) => n !== i) })}><Trash2 aria-hidden className="h-5 w-5" /></Button>
        </li>)}
      </ul>
      {form.times.length < MAX_WEEKLY_TIMES && <Button type="button" className="d-self-start" data-time-add onClick={() => set({ ...form, times: [...form.times, emptyTime()] })}><L id="tg.form.add_time" /></Button>}
      <Problem id={`${id}-pt`} problems={problems} of={['times_required', 'time', 'times_duplicate']} />
    </div>

    <label className="d-field" htmlFor={`${id}-c`} data-tour="group-capacity"><span className="d-field-label"><L id="tg.form.capacity" /></span>
      <input id={`${id}-c`} data-group-capacity inputMode="numeric" className={field} value={form.capacity} maxLength={5} onChange={e => set({ ...form, capacity: e.target.value })} aria-invalid={problems.includes('capacity')} aria-describedby={`${id}-ch`} />
      <span id={`${id}-ch`} className="d-field-hint"><L id="tg.form.capacity_hint" /></span></label>
    <Problem id={`${id}-pc`} problems={problems} of={['capacity']} />
  </>;
}

/** Create a Group. The teacher picks a course; its current run is found, or made when it has none, without ever being named. */
export function CreateGroupView({ courses }: { courses: { ok: true; value: CourseChoice[] } | { ok: false; status: number | null } }) {
  const router = useLoadingRouter();
  const { pending, retry } = useRetry();
  const id = useId();
  const [form, setForm] = useState(emptyGroupForm);
  const [courseId, setCourseId] = useState(courses.ok ? courses.value[0]?.courseId ?? '' : '');
  const [problems, setProblems] = useState<GroupFormProblem[]>([]);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useCommand(() => setSaved(true));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { problems: found, value } = checkGroupForm(form);
    setProblems(found);
    const choice = courses.ok ? courses.value.find(c => c.courseId === courseId) : undefined;
    if (!value || !choice) return;
    void run(async () => {
      const offeringId = choice.runId ?? (await postJson<{ offeringId: string }>('/api/study-groups/course-run', { courseId: choice.courseId })).offeringId;
      const created = await groupCall<{ id: string }>('create', null, { offeringId, definition: { ...value, description: '', instructions: '' } });
      router.push(`/teacher/groups/${created.id}`);
    });
  }
  return <div data-create-group-page className="d-page d-form-page">
    <PageHeader back={{ href: '/teacher/groups', label: <L id="tg.back" /> }} title={<L id="tg.create.button" />} meta={<L id="tg.create.intro" />} />
    {!courses.ok && <GroupError kind={failureKind(courses.status)} onRetry={retry} pending={pending} />}
    {courses.ok && !courses.value.length && <div data-state="empty" className="d-card d-card--pad d-stack"><p className="d-body"><L id="tg.create.no_courses" /></p><Link href="/teacher/settings/courses" className={buttonClass('primary')}><L id="tg.create.go_courses" /></Link></div>}
    {courses.ok && courses.value.length > 0 && <form data-create-group-form onSubmit={submit} noValidate className="d-card d-card--pad d-stack-form">
      <label className="d-field" htmlFor={`${id}-course`} data-tour="group-course"><span className="d-field-label"><L id="tg.form.course" /></span>
        <Select id={`${id}-course`} data-group-course value={courseId} onChange={setCourseId} options={courses.value.map(c => ({ value: c.courseId, label: c.title }))} /></label>
      <GroupFormFields form={form} set={setForm} problems={problems} />
      {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="tg.create.invalid" onRetry={error.status === null ? () => router.push('/teacher/groups') : undefined} retryLabel="tg.create.see_groups" />}
      <Button type="submit" variant="primary" className="d-self-start" data-save-group data-tour="save-group" disabled={busy || saved}>{(busy || saved) && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.create.save" /></Button>
    </form>}
  </div>;
}

/** Edit a Group on its Details tab. Sends the version it read; the existing rules decide what happens to upcoming Sessions. */
export function EditGroup({ group, schedules, onClose, onDone }: { group: StudyGroup; schedules: WeeklyTime[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(() => formFromGroup(group, schedules));
  const [problems, setProblems] = useState<GroupFormProblem[]>([]);
  const { busy, error, run } = useCommand(onDone);
  const rows = form.times.filter(t => t.time);
  const place = placeChanged(group, { mode: form.mode, location: form.mode === 'center' ? form.location.trim() : '', joinUrl: form.mode === 'online' ? form.joinUrl.trim() : '' });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { problems: found, value } = checkGroupForm(form, schedules.length > 0);
    setProblems(found);
    if (value) void run(() => groupCall('edit', group.id, editPayload(group, schedules, value), group.version));
  }
  return <form data-edit-group-form onSubmit={submit} noValidate className="d-stack-form">
    <h2 className="d-section"><L id="tg.edit.button" /></h2>
    <GroupFormFields form={form} set={setForm} problems={problems} />
    {timesRemoved(schedules, rows) && <p data-times-warning className="d-body"><L id="tg.edit.times_warning" /></p>}
    {place && <p data-place-note className="d-body"><L id="tg.edit.place_note" /></p>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="tg.edit.invalid" onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
    <div className="d-actions">
      <Button type="submit" variant="primary" data-save-edit disabled={busy}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.edit.save" /></Button>
      <Button type="button" data-cancel-edit disabled={busy} onClick={onClose}><L id="tg.edit.cancel" /></Button>
    </div>
  </form>;
}
