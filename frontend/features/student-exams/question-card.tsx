'use client';

import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { StudentPicture } from '@/frontend/features/student-exams/student-picture';
import { examCount } from '@/frontend/features/teacher-exams/exam-words';
import { uploadAnswerPhoto } from '@/frontend/lib/exam-upload';
import type { Draft, StudentItem } from '@/shared/exams-student';
import { cn } from '@/shared/utils';

const card = 'rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm';
const TEXT_DELAY_MS = 700;

type Props = {
  examId: string; attemptId: string; item: StudentItem; index: number; total: number; draft: Draft; photosAllowed: boolean; locked: boolean;
  onChange: (patch: Partial<Draft>, delay?: number) => void;
};

/**
 * One question in the order the try stored it (choices too: never sorted here). A choice is saved the moment it is picked, a number and text
 * shortly after typing stops, a photo once it is in Storage and checked. When the try is locked (time is up) nothing can be changed.
 */
export function QuestionCard({ examId, attemptId, item, index, total, draft, photosAllowed, locked, onChange }: Props) {
  const { t, number } = useLanguage();
  const [progress, setProgress] = useState<number | null>(null), [photoError, setPhotoError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const kept = !!item.answer?.kept, off = locked || kept;
  const many = item.type === 'multiple_choice';
  const takesText = item.responseMode !== 'photo', takesPhoto = item.responseMode !== 'text' && photosAllowed;

  const pick = (id: string) => {
    if (off) return;
    if (many) onChange({ optionIds: draft.optionIds.includes(id) ? draft.optionIds.filter(x => x !== id) : [...draft.optionIds, id] });
    else onChange({ optionIds: [id] });
  };
  const choose = async (picked: File | undefined) => {
    if (!picked || off) return;
    setPhotoError(null); setProgress(0);
    try { const up = await uploadAnswerPhoto(examId, attemptId, picked, setProgress); onChange({ uploadId: up.id }); }
    catch { setPhotoError(t('se.q.photo_failed')); }
    finally { setProgress(null); if (file.current) file.current.value = ''; }
  };

  return <section className={cn(card, 'space-y-4')} data-question={item.position} data-type={item.type} aria-labelledby={`q-${item.id}`}>
    <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
      <span data-position>{t('se.q.of', { n: number(index + 1), total: number(total) })}</span>
      <span className="rounded-full border-2 border-black bg-primary/60 px-3 py-0.5 font-semibold">{examCount(t, 'mark', item.points)}</span>
    </div>
    <h2 id={`q-${item.id}`} className="whitespace-pre-wrap text-lg font-semibold" dir="auto">{item.text}</h2>
    {item.imageId && <StudentPicture examId={examId} id={item.imageId} label={t('se.q.picture')} />}
    {kept && <p role="status" data-kept className="text-sm font-semibold"><L id="se.q.kept" /></p>}

    {(item.type === 'single_choice' || many) && <fieldset className="space-y-2" disabled={off}>
      <legend className="mb-2 text-sm text-slate-600">{many ? t('se.q.choose_many') : t('se.q.choose_one')}</legend>
      {item.options.map(o => { const on = draft.optionIds.includes(o.id); return <label key={o.id} data-option={o.id} data-picked={on ? '' : undefined}
        className={cn('flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border-2 border-black px-3 py-2', on ? 'bg-primary' : 'bg-white', off && 'cursor-default opacity-80')}>
        <input type={many ? 'checkbox' : 'radio'} name={`q-${item.id}`} checked={on} onChange={() => pick(o.id)} className="h-5 w-5 flex-none accent-black" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap" dir="auto">{o.text}</span>
      </label>; })}
    </fieldset>}

    {item.type === 'number' && <div className="space-y-1">
      <label htmlFor={`n-${item.id}`} className="text-sm text-slate-600"><L id="se.q.number" /></label>
      <input id={`n-${item.id}`} data-number type="text" inputMode="decimal" autoComplete="off" dir="ltr" value={draft.number} disabled={off}
        onChange={e => onChange({ number: e.target.value.slice(0, 40) }, TEXT_DELAY_MS)} className="h-12 w-full rounded-xl border-2 border-black px-3 text-lg" />
    </div>}

    {item.type === 'essay' && <div className="space-y-3">
      {takesText && <div className="space-y-1">
        <label htmlFor={`t-${item.id}`} className="text-sm text-slate-600"><L id="se.q.text" /></label>
        <textarea id={`t-${item.id}`} data-text rows={6} dir="auto" value={draft.text} disabled={off} maxLength={8000}
          onChange={e => onChange({ text: e.target.value }, TEXT_DELAY_MS)} className="w-full rounded-xl border-2 border-black p-3 text-base" />
      </div>}
      {takesPhoto && <div className="space-y-2" data-photo-box>
        {draft.uploadId && <StudentPicture examId={examId} id={draft.uploadId} label={t('se.q.your_photo')} />}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden data-photo-input onChange={e => void choose(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-2">
          <button type="button" data-photo-add disabled={off || progress !== null} onClick={() => file.current?.click()}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border-2 border-black bg-white px-4 font-semibold disabled:opacity-60"><Camera className="h-5 w-5" aria-hidden />{draft.uploadId ? t('se.q.photo_replace') : t('se.q.photo_add')}</button>
          {draft.uploadId && !off && <button type="button" data-photo-remove onClick={() => onChange({ uploadId: null })}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border-2 border-black bg-white px-4 font-semibold"><Trash2 className="h-5 w-5" aria-hidden />{t('se.q.photo_remove')}</button>}
        </div>
        {progress !== null && <p role="status" data-photo-progress className="text-sm">{t('se.q.photo_uploading', { n: number(progress) })}</p>}
        {photoError && <p role="alert" data-photo-error className="text-sm font-semibold">{photoError}</p>}
        <p className="text-xs text-slate-600"><L id="se.q.photo_hint" /></p>
      </div>}
    </div>}
  </section>;
}
