'use client';
import { useState, type ReactNode } from 'react';
import { ActionMenu } from '@/frontend/components/design/action-menu';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { SegmentedControl } from '@/frontend/components/design/controls';
import { Icon } from '@/frontend/components/design/icon';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { addOption, blankAnswers, choiceType, clampMarks, letter, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, moveQuestion, removeOption, toggleCorrect, type QuestionLike } from '@/shared/teacher-homework';
import { countText } from './homework-words';

/** A question of the step: Homework's (choice, essay), or an exam's, which adds Number (its right value and how far off still counts). */
export type StepQuestion = Omit<QuestionLike, 'kind'> & { kind: 'choice' | 'essay' | 'number'; numberValue?: string; tolerance?: string };
type Kind = StepQuestion['kind'];
const KIND_WORDS: Record<Kind, MessageKey> = { choice: 'hw.w.kind.choice', essay: 'hw.w.kind.essay', number: 'ex.w.kind.number' };
export type UploadSpot = { at: string; percent: number } | null;

/**
 * The Questions step, one question at a time with a tab per question. Homework uses it with Choice and Essay; exams add Number. A choice
 * has 2 to 8 answers (blank ones show as a row of letters) and the teacher taps every right one. Pictures go through the caller's upload
 * flow (`onUpload`), which says when it cannot upload yet (`uploadBlocked`).
 */
export function QuestionsStep<Q extends StepQuestion>({ questions, kinds, change, create, setKind, picture, upload, uploadFailure, uploadBlocked, onUpload, onUploadFailure, maxPoints = 100 }: {
  questions: Q[]; kinds: readonly Kind[]; change: (fn: (list: Q[]) => Q[]) => void; create: (kind: Kind) => Q; setKind: (q: Q, kind: Kind) => Q;
  picture: Record<string, string>; upload: UploadSpot; uploadFailure: { at: string; text: string } | null; uploadBlocked: string | null;
  onUpload: (at: string, file: File, purpose: 'question' | 'model', done: (row: { id: string }) => void) => void; onUploadFailure: (at: string) => void; maxPoints?: number;
}) {
  const { t, language } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const [current, setCurrent] = useState(0);
  // Questions whose blank answers the teacher chose to write out (a list instead of the row of letters).
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  if (!questions.length) return null;
  const q = questions[Math.min(current, questions.length - 1)];
  const qi = questions.indexOf(q);
  const setQ = (fn: (q: Q) => Q) => change(list => list.map(x => x.id === q.id ? fn(x) : x));
  const total = questions.reduce((n, x) => n + x.points, 0);
  const questionMenu = <ActionMenu label={t('hw.w.q_actions', { n: qi + 1 })} triggerData={{ 'data-question-menu': '' }} items={[
    { key: 'up', label: t('hw.w.q_up'), unavailable: qi === 0, reason: qi === 0 ? t('hw.w.q_first') : undefined, data: { 'data-action': 'up' }, onSelect: () => { change(list => moveQuestion(list, qi, qi - 1)); setCurrent(qi - 1); } },
    { key: 'down', label: t('hw.w.q_down'), unavailable: qi === questions.length - 1, reason: qi === questions.length - 1 ? t('hw.w.q_last') : undefined, data: { 'data-action': 'down' }, onSelect: () => { change(list => moveQuestion(list, qi, qi + 1)); setCurrent(qi + 1); } },
    { key: 'remove', label: t('hw.w.q_remove'), destructive: questions.length > 1, unavailable: questions.length === 1, reason: questions.length === 1 ? t('hw.w.q_only') : undefined, data: { 'data-action': 'remove' }, onSelect: () => { change(list => list.filter(x => x.id !== q.id)); setCurrent(Math.max(0, qi - 1)); } },
  ]} />;
  const pictureAt = `picture-${q.id}`, modelAt = `model-${q.id}`;
  const chips = q.kind === 'choice' && blankAnswers(q) && !writing[q.id];
  const pick = (at: string, purpose: 'question' | 'model', done: (row: { id: string }) => void) => (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { onUploadFailure(at); return; }
    onUpload(at, file, purpose, done);
  };
  return <div className="d-stack-sm">
    <div role="tablist" aria-label={t('hw.w.step.questions')} data-question-tabs className="d-hw-qtabs">
      {questions.map((x, i) => <button key={x.id} type="button" role="tab" aria-selected={i === qi} data-question-tab={i + 1} className="d-hw-qtab d-focus" onClick={() => setCurrent(i)}>
        <b>{i + 1}</b>{!phone && <span>{t(KIND_WORDS[x.kind])}</span>}
      </button>)}
      <Button variant="tertiary" data-add-question aria-label={phone ? t('hw.w.add_question') : undefined} aria-disabled={questions.length >= MAX_QUESTIONS || undefined} onClick={() => { if (questions.length >= MAX_QUESTIONS) return; change(list => [...list, create('choice')]); setCurrent(questions.length); }}><Icon name="plus" size={16} />{!phone && <L id="hw.w.add_question" />}</Button>
      <span className="d-meta" data-question-count>{phone ? countText(t, 'mark', total) : `${countText(t, 'question', questions.length)} · ${countText(t, 'mark', total)}`}</span>
    </div>
    <section aria-labelledby="hw-q" data-question={qi + 1} data-question-kind={q.kind} className="d-card d-card--pad d-stack-sm">
      <div className="d-hw-qhead">
        <h2 id="hw-q" className="d-section">{t('hw.w.question_n', { n: qi + 1 })} · {t(KIND_WORDS[q.kind])}</h2>
        <Stepper value={q.points} min={0} max={maxPoints} label={t('hw.w.marks_label')} less={t('hw.w.fewer_marks')} more={t('hw.w.more_marks')} shown={countText(t, 'mark', q.points)} onChange={n => setQ(x => ({ ...x, points: Math.min(maxPoints, clampMarks(n)) }))} data="marks" />
        {questionMenu}
      </div>
      <SegmentedControl label={t('hw.w.kind_label')} value={q.kind} onChange={kind => setQ(x => setKind(x, kind))} options={kinds.map(kind => ({ value: kind, label: t(KIND_WORDS[kind]), 'data-kind': kind }))} />
      <TextArea label={q.kind !== 'essay' ? <><L id="hw.w.question_text" /> <span className="d-meta"><L id="hw.w.optional" /></span></> : <L id="hw.w.question_text" />} value={q.text} maxLength={10000} rows={3} onChange={v => setQ(x => ({ ...x, text: v }))} data="question-text" />
      <div className="d-stack-xs" data-picture>
        {q.imageId ? <div className="d-hw-file">
          {/* A short-lived signed Storage URL, not an optimisable asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {picture[q.imageId] ? <img src={picture[q.imageId]} alt={t('hw.w.picture_alt', { n: qi + 1 })} className="d-hw-picture" /> : <Icon name="check" />}
          <span className="d-meta"><L id="hw.w.picture_added" /></span>
          <Button variant="tertiary" data-picture-remove onClick={() => setQ(x => ({ ...x, imageId: null }))}><L id="hw.w.remove" /></Button>
        </div> : <FilePick at={pictureAt} accept="image/png,image/jpeg,image/webp" label={upload?.at === pictureAt ? t('hw.w.uploading', { n: upload.percent }) : t('hw.w.picture_add')} blocked={uploadBlocked ?? (upload ? t('hw.w.uploading', { n: upload.percent }) : null)}
          onFile={pick(pictureAt, 'question', row => setQ(x => ({ ...x, imageId: row.id })))} />}
        {uploadFailure?.at === pictureAt && <p role="alert" className="d-field-error">{uploadFailure.text}</p>}
      </div>
      {q.kind === 'choice' && <fieldset className="d-stack-xs" data-options={chips ? 'chips' : 'list'} data-choice-type={choiceType(q)}>
        <legend className="d-field-label"><L id="hw.w.answers" /></legend>
        {/* Any number of answers may be right: one makes it single choice, more make it multiple choice. Students are told which. */}
        <div role="group" aria-label={t('hw.w.answers')} aria-describedby="hw-choice-type" className={chips ? 'd-hw-chips' : 'd-stack-xs'}>
          {q.options.map((o, i) => chips
            ? <button key={o.id} type="button" role="checkbox" aria-checked={q.correctIds.includes(o.id)} aria-label={t('hw.w.mark_correct', { letter: letter(i, lang) })} data-option={letter(i)} data-correct={q.correctIds.includes(o.id) ? '' : undefined} className="d-hw-mark d-focus" onClick={() => setQ(x => toggleCorrect(x, o.id))}>
              <span aria-hidden="true">{letter(i, lang)}</span>
            </button>
            : <div key={o.id} className="d-hw-option" data-option={letter(i)}>
              <button type="button" role="checkbox" aria-checked={q.correctIds.includes(o.id)} aria-label={t('hw.w.mark_correct', { letter: letter(i, lang) })} data-correct={q.correctIds.includes(o.id) ? '' : undefined} className="d-hw-mark d-focus" onClick={() => setQ(x => toggleCorrect(x, o.id))}>
                <span aria-hidden="true">{q.correctIds.includes(o.id) ? <Icon name="check" size={16} /> : letter(i, lang)}</span>
              </button>
              <input className="d-field-input" value={o.text} maxLength={2000} dir="auto" placeholder={t('hw.w.optional')} aria-label={t('hw.w.option_n', { letter: letter(i, lang) })} data-option-text={letter(i)} onChange={e => setQ(x => ({ ...x, options: x.options.map(y => y.id === o.id ? { ...y, text: e.target.value } : y) }))} />
              <Button variant="icon" aria-label={t('hw.w.remove_option', { letter: letter(i, lang) })} aria-disabled={q.options.length <= MIN_OPTIONS || undefined} aria-describedby={q.options.length <= MIN_OPTIONS ? 'hw-min-options' : undefined} onClick={() => setQ(x => removeOption(x, o.id))} data-remove-option={letter(i)}><Icon name="close" size={18} /></Button>
            </div>)}
        </div>
        <p id="hw-choice-type" className="d-meta" data-choice-hint>{t(q.correctIds.length === 0 ? 'hw.w.type_none' : choiceType(q) === 'multiple_choice' ? 'hw.w.type_many' : 'hw.w.type_one')}</p>
        <div className="d-hw-option-actions">
          <Button variant="tertiary" data-add-option aria-disabled={q.options.length >= MAX_OPTIONS || undefined} aria-describedby={q.options.length >= MAX_OPTIONS ? 'hw-max-options' : undefined} onClick={() => setQ(x => addOption(x, () => crypto.randomUUID()))}><Icon name="plus" size={16} /><L id="hw.w.add_option" /></Button>
          {chips && <Button variant="tertiary" data-remove-last aria-disabled={q.options.length <= MIN_OPTIONS || undefined} aria-describedby={q.options.length <= MIN_OPTIONS ? 'hw-min-options' : undefined} onClick={() => setQ(x => removeOption(x, x.options[x.options.length - 1].id))}><Icon name="close" size={16} />{t('hw.w.remove_option', { letter: letter(q.options.length - 1, lang) })}</Button>}
          {chips && <Button variant="tertiary" data-write-answers onClick={() => setWriting(w => ({ ...w, [q.id]: true }))}><L id="hw.w.write_answers" /></Button>}
        </div>
        {q.options.length <= MIN_OPTIONS && <p id="hw-min-options" className="d-meta"><L id="hw.w.min_options" /></p>}
        {q.options.length >= MAX_OPTIONS && <p id="hw-max-options" className="d-meta"><L id="hw.w.max_options" /></p>}
      </fieldset>}
      {/* Number (exams): the right value, and how far off still counts as right. Typed as on paper: Arabic digits and a comma are fine. */}
      {q.kind === 'number' && <fieldset className="d-stack-xs" data-number>
        <legend className="d-field-label"><L id="ex.w.number_answer" /></legend>
        <div className="d-field-pair">
          <label className="d-field" data-field="number-value"><span className="d-field-label"><L id="ex.w.number_value" /></span>
            <input className="d-field-input" inputMode="decimal" dir="ltr" maxLength={40} value={q.numberValue ?? ''} onChange={e => setQ(x => ({ ...x, numberValue: e.target.value }))} /></label>
          <label className="d-field" data-field="number-tolerance"><span className="d-field-label"><L id="ex.w.tolerance" /> <span className="d-meta"><L id="hw.w.optional" /></span></span>
            <input className="d-field-input" inputMode="decimal" dir="ltr" maxLength={40} value={q.tolerance ?? ''} aria-describedby="ex-tolerance-hint" onChange={e => setQ(x => ({ ...x, tolerance: e.target.value }))} />
            <span id="ex-tolerance-hint" className="d-field-hint"><L id="ex.w.tolerance_hint" /></span></label>
        </div>
      </fieldset>}
      {/* Every question: an essay's model answer, a choice's explanation, each with an optional picture. Students see both when the solutions open. */}
      <div className="d-stack-xs" data-model={q.kind}>
        <TextArea label={<><L id={q.kind === 'essay' ? 'hw.w.model_answer' : 'hw.w.explanation'} /> <span className="d-meta"><L id="hw.w.model_answer_hint" /></span></>} value={q.modelAnswer} maxLength={10000} rows={2} onChange={v => setQ(x => ({ ...x, modelAnswer: v }))} data="model-answer" />
        {/* The model answer picture: images only, the same limit as a question picture; students see it when the solutions open. */}
        {q.modelImageId ? <div className="d-hw-file" data-model-picture>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {picture[q.modelImageId] ? <img src={picture[q.modelImageId]} alt={t('hw.w.model_picture_alt', { n: qi + 1 })} className="d-hw-picture" /> : <Icon name="check" />}
          <span className="d-meta"><L id="hw.w.model_picture_added" /></span>
          <Button variant="tertiary" data-model-picture-remove onClick={() => setQ(x => ({ ...x, modelImageId: null }))}><L id="hw.w.remove" /></Button>
        </div> : <FilePick at={modelAt} accept="image/png,image/jpeg,image/webp" label={upload?.at === modelAt ? t('hw.w.uploading', { n: upload.percent }) : t('hw.w.model_picture_add')} blocked={uploadBlocked ?? (upload ? t('hw.w.uploading', { n: upload.percent }) : null)}
          onFile={pick(modelAt, 'model', row => setQ(x => ({ ...x, modelImageId: row.id })))} />}
        {uploadFailure?.at === modelAt && <p role="alert" className="d-field-error">{uploadFailure.text}</p>}
      </div>
    </section>
  </div>;
}

export function TextArea({ label, value, onChange, maxLength, rows, data }: { label: ReactNode; value: string; onChange: (v: string) => void; maxLength: number; rows: number; data: string }) {
  return <label className="d-field" data-field={data}><span className="d-field-label">{label}</span>
    <textarea className="d-field-input d-textarea" value={value} maxLength={maxLength} rows={rows} dir="auto" onChange={e => onChange(e.target.value)} />
  </label>;
}

/** − n +. At a limit the button stays reachable and says why it does nothing (aria-disabled with the reason). */
export function Stepper({ value, min, max, label, less, more, shown, lessReason, moreReason, onChange, data, step = 1 }: { value: number; min: number; max: number; label: string; less: string; more: string; shown: string; lessReason?: string; moreReason?: string; onChange: (n: number) => void; data: string; step?: number }) {
  const atMin = value <= min, atMax = value >= max;
  return <span role="group" aria-label={label} className="d-hw-stepper" data-stepper={data}>
    <button type="button" className="d-btn d-btn--secondary d-hw-step-btn" aria-label={less} aria-disabled={atMin || undefined} aria-describedby={atMin && lessReason ? `${data}-min` : undefined} onClick={() => { if (!atMin) onChange(value - step); }}>−</button>
    <span aria-live="polite" className="d-label d-hw-step-value" data-stepper-value={value}>{shown}</span>
    <button type="button" className="d-btn d-btn--secondary d-hw-step-btn" aria-label={more} aria-disabled={atMax || undefined} aria-describedby={atMax && moreReason ? `${data}-max` : undefined} onClick={() => { if (!atMax) onChange(value + step); }}>+</button>
    {atMin && lessReason && <span id={`${data}-min`} className="sr-only">{lessReason}</span>}
    {atMax && moreReason && <span id={`${data}-max`} className="sr-only">{moreReason}</span>}
  </span>;
}

/** A file chooser that looks like a button. The input is visually hidden and reached through its 44 px label. */
export function FilePick({ at, accept, label, blocked, onFile }: { at: string; accept: string; label: string; blocked: string | null; onFile: (file: File) => void }) {
  if (blocked) return <span className="d-stack-xs"><button type="button" className={buttonClass('tertiary')} aria-disabled="true" aria-describedby={`${at}-why`} data-file-pick={at}><Icon name="plus" size={16} />{label}</button><span id={`${at}-why`} className="d-meta">{blocked}</span></span>;
  return <label className={`${buttonClass('tertiary')} d-self-start`} data-file-pick={at}>
    <Icon name="plus" size={16} />{label}
    <input type="file" accept={accept} className="sr-only" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }} />
  </label>;
}
