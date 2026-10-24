'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Plus } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import {
 Banner, Button, ButtonLink, Card, CardBody, CardHead, Chip, ChipList, DefinitionList, Disclosure, Field, Input, LinkButton, Page, PageHeader, Select, StepPanel, Stepper,
} from '@/frontend/design-system';
import type { MessageKey } from '@/frontend/locales/messages';
import {
 addGrade, addSubject, addSystem, canVisitStep, chooseCourse, emptyDraft, isDirty, removeGrade, removeSubject, removeSystem, setCourseTitle, stepValidity, toRequest, updateSystem, validateDraft, validateStep, wizardStepIds,
 type Draft, type DraftErrors,
} from '@/frontend/lib/provisioning-draft';
import { invitationLifetimes, provisioningLimits, type ProvisionResult } from '@/shared/contracts/platform-provisioning';
import { SecretCard, api, reasonMessage } from './common';

type Phase = 'edit' | 'review' | 'creating' | 'done' | 'unknown';
const msg = (code: string) => `pa.draft.${code}` as MessageKey;
const stepLabel = ['pa.step.teacher', 'pa.step.education', 'pa.step.subjects', 'pa.step.course'] as const;
const stepTitle = ['pa.section.teacher', 'pa.section.systems', 'pa.section.subjects', 'pa.section.course'] as const;
const last = wizardStepIds.length - 1;

export function ProvisionForm() {
 const { t } = useLanguage();
 const [draft, setDraft] = useState<Draft>(emptyDraft);
 const [phase, setPhase] = useState<Phase>('edit');
 const [step, setStep] = useState(0);
 const [direction, setDirection] = useState<'forward' | 'back'>('forward');
 const [visited, setVisited] = useState<number[]>([0]);
 const [attempted, setAttempted] = useState<number[]>([]);
 const [attempt, setAttempt] = useState(0);
 const [movedFocus, setMovedFocus] = useState(0);
 const [failure, setFailure] = useState<MessageKey | null>(null);
 const [result, setResult] = useState<ProvisionResult | null>(null);
 const [gradeText, setGradeText] = useState<Record<string, string>>({});
 const [subjectText, setSubjectText] = useState('');
 const [missingGrade, setMissingGrade] = useState({ open: false, systemId: '', text: '' });
 const [missingSubject, setMissingSubject] = useState({ open: false, text: '' });
 const [inline, setInline] = useState<string | null>(null);
 // Advanced options are collapsed by default and re-opened by their own content or errors, never lost.
 const [boardOpen, setBoardOpen] = useState<Record<string, boolean>>({});
 const [settingsOpen, setSettingsOpen] = useState(false);
 const submitting = useRef(false);
 const formRef = useRef<HTMLFormElement>(null);
 const headingRef = useRef<HTMLHeadingElement>(null);
 // Only the step the administrator has tried to leave shows errors; the rest of the draft stays quiet.
 const errors: DraftErrors = phase === 'edit' && attempted.includes(step) ? validateStep(draft, step) : {};
 const err = (key: string) => (errors[key] ? t(msg(errors[key])) : undefined);
 const lineError = (key: string) => (errors[key] ? <p className="eds-error" role="alert">{t(msg(errors[key]))}</p> : null);
 const validity = stepValidity(draft);

 // Leaving a half-built portal by accident loses typed work; warn while nothing is saved yet.
 useEffect(() => {
  if (phase === 'done' || !isDirty(draft)) return;
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
 }, [draft, phase]);
 useEffect(() => {
  if (!attempt) return;
  formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
 }, [attempt]);
 // After a step change, keyboard and screen-reader users land on the new step's heading.
 useEffect(() => {
  if (movedFocus) headingRef.current?.focus({ preventScroll: false });
 }, [movedFocus]);

 const patch = (next: Draft) => { setDraft(next); setInline(null); };

 function goTo(target: number) {
  setDirection(target >= step ? 'forward' : 'back');
  setStep(target); setPhase('edit'); setInline(null); setFailure(null);
  setVisited((seen) => (seen.includes(target) ? seen : [...seen, target]));
  setMovedFocus((n) => n + 1);
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
 }
 function refuse() { setAttempted((seen) => (seen.includes(step) ? seen : [...seen, step])); setAttempt((n) => n + 1); }
 function selectStep(target: number) {
  if (target === step && phase === 'edit') return;
  if (canVisitStep(draft, phase === 'edit' ? step : last, target)) { goTo(target); return; }
  // An upcoming step cannot skip validation: trying to open it shows what the current step still needs.
  if (phase === 'edit') refuse();
 }
 function next(event?: FormEvent) {
  event?.preventDefault();
  setFailure(null);
  if (Object.keys(validateStep(draft, step)).length) { refuse(); return; }
  if (step < last) { goTo(step + 1); return; }
  const firstBad = validateDraftSteps();
  if (firstBad !== -1) { goTo(firstBad); setAttempted((seen) => (seen.includes(firstBad) ? seen : [...seen, firstBad])); setAttempt((n) => n + 1); return; }
  setPhase('review'); window.scrollTo({ top: 0 }); setMovedFocus((n) => n + 1);
 }
 const validateDraftSteps = () => (Object.keys(validateDraft(draft)).length ? stepValidity(draft).findIndex((ok) => !ok) : -1);

 function addGradeTo(systemId: string, text: string, selectForCourse = false) {
  const out = addGrade(draft, systemId, text);
  if (!out.key) { setInline(text.trim() ? 'grade_duplicate' : 'name_required'); return false; }
  patch(selectForCourse ? chooseCourse(out.draft, { courseGradeKey: out.key }) : out.draft);
  return true;
 }
 function addSubjectText(text: string, selectForCourse = false) {
  const out = addSubject(draft, text);
  if (!out.key) { setInline(text.trim() ? 'subject_duplicate' : 'name_required'); return false; }
  patch(selectForCourse ? chooseCourse(out.draft, { courseSubjectKey: out.key }) : out.draft);
  return true;
 }

 async function create() {
  if (submitting.current) return;
  const request = toRequest(draft);
  if (!request) { goTo(Math.max(0, validity.findIndex((ok) => !ok))); refuse(); return; }
  submitting.current = true; setPhase('creating'); setFailure(null);
  const out = await api<ProvisionResult>('/api/platform-admin/portals', { method: 'POST', body: request });
  submitting.current = false;
  if (out.ok) { setResult(out.data); setPhase('done'); window.scrollTo({ top: 0 }); return; }
  // Nothing was saved on a definite refusal. After a network error the outcome is unknown.
  if (out.reason === 'network') { setPhase('unknown'); return; }
  setFailure(reasonMessage(out.reason)); setPhase('review');
 }

 const gradeOptions = draft.systems.flatMap((s) => s.grades.map((g) => ({ key: g.key, label: g.label, system: s.label.trim() })));
 const busy = phase === 'creating';
 const reviewing = phase === 'review' || busy;
 const completed = wizardStepIds.map((_, i) => validity[i] && (reviewing || (i !== step && visited.includes(i))));
 const progress = <Stepper label={t('pa.step.nav')} steps={wizardStepIds.map((id, i) => ({ id, label: t(stepLabel[i]) }))} current={reviewing ? null : step} completed={completed}
  canVisit={(i) => (reviewing ? !busy : canVisitStep(draft, step, i))} onSelect={(i) => { if (!busy) selectStep(i); }}
  stateLabels={{ completed: t('pa.step.state_done'), current: t('pa.step.state_current'), upcoming: t('pa.step.state_upcoming') }} />;

 if (phase === 'done' && result) {
  return <Page layout="focused">
   <PageHeader title={t('pa.done.title')} intro={t('pa.done.intro')} />
   <Banner tone="ok" role="status">{t('pa.done.pending_owner')}</Banner>
   <SecretCard secret={result.invitationSecret} expiresAt={result.expiresAt} />
   <div className="eds-actions">
    <ButtonLink variant="primary" href={`/platform-admin/teachers/${result.organizationId}`}>{t('pa.done.inspect')}</ButtonLink>
    <ButtonLink href="/platform-admin/teachers">{t('pa.done.list')}</ButtonLink>
   </div>
  </Page>;
 }

 if (phase === 'unknown') {
  return <Page layout="focused">
   <PageHeader title={t('pa.unknown.title')} />
   <Banner tone="error" role="alert">{t('pa.unknown.body')}</Banner>
   <div className="eds-actions">
    <ButtonLink variant="primary" href="/platform-admin/teachers">{t('pa.unknown.check')}</ButtonLink>
    <Button onClick={() => setPhase('review')}>{t('pa.unknown.back')}</Button>
   </div>
  </Page>;
 }

 if (reviewing) {
  const grade = gradeOptions.find((g) => g.key === draft.courseGradeKey);
  const subject = draft.subjects.find((s) => s.key === draft.courseSubjectKey);
  return <Page layout="focused">
   <PageHeader title={t('pa.review.title')} intro={t('pa.review.intro')} />
   {progress}
   {failure ? <Banner tone="error" role="alert">{t(failure)}</Banner> : null}
   <StepPanel direction="forward">
    <Card labelledBy="pa-review-title">
     <CardHead id="pa-review-title" title={t('pa.review.summary')} />
     <CardBody>
      <DefinitionList items={[
       { key: 'email', term: t('pa.field.email'), detail: <bdi dir="ltr">{draft.email.trim().toLowerCase()}</bdi> },
       { key: 'owner', term: t('pa.review.owner'), detail: t('pa.review.owner_value') },
       { key: 'life', term: t('pa.field.lifetime'), detail: t('pa.lifetime.days', { count: draft.lifetime }) },
       { key: 'systems', term: t('pa.section.systems'), detail: <ul className="eds-plain-list">{draft.systems.map((s) => <li key={s.id}><span className="eds-strong">{s.label.trim()}</span>{s.board.trim() ? <span className="eds-meta"> · {s.board.trim()}</span> : null}
        <ChipList label={s.label.trim()}>{s.grades.map((g) => <Chip key={g.key}>{g.label}</Chip>)}</ChipList></li>)}</ul> },
       { key: 'subjects', term: t('pa.section.subjects'), detail: <ChipList label={t('pa.section.subjects')}>{draft.subjects.map((s) => <Chip key={s.key}>{s.label}</Chip>)}</ChipList> },
       { key: 'course', term: t('pa.section.course'), detail: <><span className="eds-strong">{draft.courseTitle.trim()}</span><span className="eds-meta"> · {subject?.label} · {grade?.label} ({grade?.system})</span></> },
      ]} />
      <p className="eds-hint">{t('pa.review.empty_course')}</p>
     </CardBody>
    </Card>
   </StepPanel>
   <div className="eds-actions eds-wizard-actions">
    <Button onClick={() => goTo(last)} disabled={busy}><ArrowLeft size={16} className="eds-flip" aria-hidden="true" />{t('pa.review.edit')}</Button>
    <Button variant="primary" onClick={create} disabled={busy} aria-busy={busy}>
     {busy ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : null}{t(busy ? 'pa.review.creating' : 'pa.review.create')}
    </Button>
   </div>
  </Page>;
 }

 return <Page layout="focused">
  <PageHeader title={t('pa.new.title')} intro={t('pa.new.intro')} />
  {progress}
  <form ref={formRef} className="pa-form" onSubmit={next} noValidate>
   {Object.keys(errors).length ? <Banner tone="error" role="alert">{t('pa.form.fix')}</Banner> : null}
   {inline ? <Banner tone="warn" role="status">{t(msg(inline))}</Banner> : null}

   <StepPanel key={step} direction={direction}>
    <Card labelledBy="pa-step-title">
     <div className="eds-card-head"><h2 id="pa-step-title" ref={headingRef} tabIndex={-1}>{t(stepTitle[step])}<span className="eds-sr">, {t('pa.step.status', { n: step + 1, total: wizardStepIds.length })}</span></h2>
      {step === 1 ? <small>{t('pa.section.systems_hint')}</small> : step === 3 ? <small>{t('pa.section.course_hint')}</small> : null}</div>
     <CardBody divided={step === 1}>
      {step === 0 ? <>
       <Field id="pa-email" label={t('pa.field.email')} hint={t('pa.field.email_hint')} error={err('email')}>
        <Input type="email" inputMode="email" autoComplete="off" dir="ltr" value={draft.email} onChange={(e) => patch({ ...draft, email: e.target.value })} />
       </Field>
       <Disclosure id="pa-settings" open={settingsOpen || Boolean(errors.lifetime)} onToggle={() => setSettingsOpen((v) => !v)} label={t('pa.invitation.settings')}>
        <Field id="pa-lifetime" label={t('pa.field.lifetime')}>
         <Select value={draft.lifetime} onChange={(e) => patch({ ...draft, lifetime: Number(e.target.value) })}>
          {invitationLifetimes.map((n) => <option key={n} value={n}>{t('pa.lifetime.days', { count: n })}</option>)}
         </Select>
        </Field>
       </Disclosure>
      </> : null}

      {step === 1 ? <>
       {draft.systems.map((system, i) => {
        const boardError = err(`system.${i}.board`);
        return <div key={system.id} className="pa-system" data-system={i}>
         {draft.systems.length > 1 ? <div className="pa-system-head"><span className="eds-strong">{t('pa.system.n', { n: i + 1 })}</span>
          <LinkButton onClick={() => patch(removeSystem(draft, system.id))}>{t('pa.action.remove_system')}</LinkButton></div> : null}
         <Field id={`pa-sys-${i}`} label={t('pa.field.system')} error={err(`system.${i}`)}>
          <Input value={system.label} maxLength={200} onChange={(e) => patch(updateSystem(draft, system.id, { label: e.target.value }))} />
         </Field>
         <div className="eds-field">
          <label className="eds-label" htmlFor={`pa-grade-${i}`}>{t('pa.field.grades')}</label>
          <div className="eds-input-row">
           <Input id={`pa-grade-${i}`} value={gradeText[system.id] ?? ''} maxLength={200} aria-invalid={errors[`system.${i}.grades`] ? true : undefined} aria-describedby={errors[`system.${i}.grades`] ? `err-grades-${i}` : undefined}
            onChange={(e) => setGradeText({ ...gradeText, [system.id]: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addGradeTo(system.id, gradeText[system.id] ?? '')) setGradeText({ ...gradeText, [system.id]: '' }); } }} />
           <Button onClick={() => { if (addGradeTo(system.id, gradeText[system.id] ?? '')) setGradeText({ ...gradeText, [system.id]: '' }); }}><Plus size={16} aria-hidden="true" />{t('pa.action.add_grade')}</Button>
          </div>
          {errors[`system.${i}.grades`] ? <p className="eds-error" role="alert" id={`err-grades-${i}`}>{t(msg(errors[`system.${i}.grades`]))}</p> : null}
          <ChipList label={t('pa.field.grades')}>
           {system.grades.map((g, j) => <Chip key={g.key} onRemove={() => patch(removeGrade(draft, g.key))} removeLabel={t('pa.action.remove', { name: g.label })} error={lineError(`system.${i}.grade.${j}`)}>{g.label}</Chip>)}
          </ChipList>
         </div>
         <Disclosure id={`pa-board-box-${i}`} open={Boolean(boardOpen[system.id]) || system.board.trim() !== '' || Boolean(boardError)} onToggle={() => setBoardOpen({ ...boardOpen, [system.id]: !boardOpen[system.id] })} label={t('pa.field.board')}>
          <Field id={`pa-board-${i}`} label={t('pa.field.board_label')} hint={t('pa.field.board_hint')} error={boardError}>
           <Input value={system.board} maxLength={160} onChange={(e) => patch(updateSystem(draft, system.id, { board: e.target.value }))} />
          </Field>
         </Disclosure>
        </div>;
       })}
       {draft.systems.length < provisioningLimits.systems ? <LinkButton onClick={() => patch(addSystem(draft))}><Plus size={16} aria-hidden="true" />{t('pa.action.add_system')}</LinkButton> : null}
      </> : null}

      {step === 2 ? <div className="eds-field">
       <label className="eds-label" htmlFor="pa-subject">{t('pa.field.subjects')}</label>
       <div className="eds-input-row">
        <Input id="pa-subject" value={subjectText} maxLength={200} aria-invalid={errors.subjects ? true : undefined} aria-describedby={errors.subjects ? 'err-subjects' : undefined}
         onChange={(e) => setSubjectText(e.target.value)}
         onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addSubjectText(subjectText)) setSubjectText(''); } }} />
        <Button onClick={() => { if (addSubjectText(subjectText)) setSubjectText(''); }}><Plus size={16} aria-hidden="true" />{t('pa.action.add_subject')}</Button>
       </div>
       {errors.subjects ? <p className="eds-error" role="alert" id="err-subjects">{t(msg(errors.subjects))}</p> : null}
       <ChipList label={t('pa.field.subjects')}>
        {draft.subjects.map((s, i) => <Chip key={s.key} onRemove={() => patch(removeSubject(draft, s.key))} removeLabel={t('pa.action.remove', { name: s.label })} error={lineError(`subject.${i}`)}>{s.label}</Chip>)}
       </ChipList>
      </div> : null}

      {step === 3 ? <>
       <div className="eds-grid-2">
        <div className="pa-system">
         <Field id="pa-course-grade" label={t('pa.field.course_grade')} error={err('course.grade')}>
          <Select value={draft.courseGradeKey} onChange={(e) => patch(chooseCourse(draft, { courseGradeKey: e.target.value }))}>
           <option value="">{t('pa.field.choose')}</option>
           {gradeOptions.map((g) => <option key={g.key} value={g.key}>{g.label}{draft.systems.length > 1 && g.system ? ` — ${g.system}` : ''}</option>)}
          </Select>
         </Field>
         {!missingGrade.open ? <LinkButton onClick={() => setMissingGrade({ open: true, systemId: draft.systems[0]?.id ?? '', text: '' })}>{t('pa.action.missing_grade')}</LinkButton> : <div className="pa-inline-add">
          {draft.systems.length > 1 ? <Select aria-label={t('pa.field.system')} value={missingGrade.systemId} onChange={(e) => setMissingGrade({ ...missingGrade, systemId: e.target.value })}>
           {draft.systems.map((s, i) => <option key={s.id} value={s.id}>{s.label.trim() || t('pa.system.n', { n: i + 1 })}</option>)}
          </Select> : null}
          <Input aria-label={t('pa.field.new_grade')} value={missingGrade.text} maxLength={200} onChange={(e) => setMissingGrade({ ...missingGrade, text: e.target.value })}
           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addGradeTo(missingGrade.systemId, missingGrade.text, true)) setMissingGrade({ open: false, systemId: '', text: '' }); } }} />
          <Button size="sm" onClick={() => { if (addGradeTo(missingGrade.systemId, missingGrade.text, true)) setMissingGrade({ open: false, systemId: '', text: '' }); }}>{t('pa.action.add_and_use')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setMissingGrade({ open: false, systemId: '', text: '' })}>{t('pa.action.cancel')}</Button>
         </div>}
        </div>
        <div className="pa-system">
         <Field id="pa-course-subject" label={t('pa.field.course_subject')} error={err('course.subject')}>
          <Select value={draft.courseSubjectKey} onChange={(e) => patch(chooseCourse(draft, { courseSubjectKey: e.target.value }))}>
           <option value="">{t('pa.field.choose')}</option>
           {draft.subjects.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
         </Field>
         {!missingSubject.open ? <LinkButton onClick={() => setMissingSubject({ open: true, text: '' })}>{t('pa.action.missing_subject')}</LinkButton> : <div className="pa-inline-add">
          <Input aria-label={t('pa.field.new_subject')} value={missingSubject.text} maxLength={200} onChange={(e) => setMissingSubject({ ...missingSubject, text: e.target.value })}
           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addSubjectText(missingSubject.text, true)) setMissingSubject({ open: false, text: '' }); } }} />
          <Button size="sm" onClick={() => { if (addSubjectText(missingSubject.text, true)) setMissingSubject({ open: false, text: '' }); }}>{t('pa.action.add_and_use')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setMissingSubject({ open: false, text: '' })}>{t('pa.action.cancel')}</Button>
         </div>}
        </div>
       </div>
       <Field id="pa-course-title" label={t('pa.field.course_title')} hint={draft.courseTitleTouched ? undefined : t('pa.field.course_title_hint')} error={err('course.title')}>
        <Input value={draft.courseTitle} maxLength={200} onChange={(e) => patch(setCourseTitle(draft, e.target.value))} />
       </Field>
       <p className="eds-hint">{t('pa.review.empty_course')}</p>
      </> : null}
     </CardBody>
    </Card>
   </StepPanel>

   <div className="eds-actions eds-wizard-actions">
    {step === 0 ? <ButtonLink href="/platform-admin/teachers" variant="ghost">{t('pa.new.cancel')}</ButtonLink>
     : <Button onClick={() => goTo(step - 1)}><ArrowLeft size={16} className="eds-flip" aria-hidden="true" />{t('pa.wizard.back')}</Button>}
    <Button type="submit" variant="primary">{t(step === last ? 'pa.wizard.review' : 'pa.wizard.next')}{step === last ? null : <ArrowRight size={16} className="eds-flip" aria-hidden="true" />}</Button>
   </div>
  </form>
 </Page>;
}
