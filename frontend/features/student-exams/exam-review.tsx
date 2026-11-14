'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { StudentPicture } from '@/frontend/features/student-exams/student-picture';
import { examCount } from '@/frontend/features/teacher-exams/exam-words';
import { scoreText } from '@/frontend/features/student-exams/student-exam-format';
import type { StudentAttempt, StudentExamView, StudentItem } from '@/shared/exams-student';
import { cn } from '@/shared/utils';

const card = 'rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm';

/**
 * The answer review of one handed-in try: each question with what the student answered, the right answers, the model answer and the marker's
 * note. The database sends keys only once review is open, so a missing key here simply shows nothing; nothing is hidden or revealed by this screen.
 */
export function ExamReview({ examId, view, attempt, onBack }: { examId: string; view: StudentExamView; attempt: StudentAttempt; onBack: () => void }) {
  const { t, number } = useLanguage();
  const result = view.result && !('waiting' in view.result) ? view.result : null;
  return <div className="space-y-3" data-student-exam="review">
    <section className={cn(card, 'space-y-1')}>
      <h1 className="font-display text-2xl leading-tight" dir="auto">{view.title}</h1>
      <p className="text-sm text-slate-600"><L id="se.r.title" /></p>
      {result && <p className="font-semibold" data-score>{result.absent ? t('se.x.absent') : t('se.x.score_value', { score: number(result.score ?? 0), max: number(result.maxScore ?? 0) })}</p>}
      <button type="button" data-review-back onClick={onBack} className="min-h-[44px] text-sm font-semibold underline"><L id="se.r.back" /></button>
    </section>
    {attempt.items.map((item, i) => <ReviewItem key={item.id} examId={examId} item={item} index={i} />)}
  </div>;
}

function ReviewItem({ examId, item, index }: { examId: string; item: StudentItem; index: number }) {
  const { t, number } = useLanguage();
  const choice = item.type === 'single_choice' || item.type === 'multiple_choice';
  const picked = new Set(item.answer?.optionIds ?? []), right = new Set(item.correctOptionIds ?? []);
  const mark = item.mark;
  return <section className={cn(card, 'space-y-3')} data-review-item={item.position} data-type={item.type}>
    <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
      <span data-position>{t('se.r.question', { n: number(index + 1) })}</span>
      <span className="rounded-full border-2 border-black bg-primary/60 px-3 py-0.5 font-semibold" data-points>
        {mark && mark.points !== null ? scoreText(mark.points, item.points, number) : examCount(t, 'mark', item.points)}</span>
    </div>
    <h2 className="whitespace-pre-wrap text-lg font-semibold" dir="auto">{item.text}</h2>
    {item.imageId && <StudentPicture examId={examId} id={item.imageId} label={t('se.q.picture')} />}

    {choice && <ul className="space-y-2">{item.options.map(o => { const mine = picked.has(o.id), ok = right.has(o.id);
      return <li key={o.id} data-option={o.id} data-picked={mine ? '' : undefined} data-right={ok ? '' : undefined}
        className={cn('flex min-h-[44px] items-center gap-2 rounded-xl border-2 border-black px-3 py-2', ok ? 'bg-emerald-100' : mine ? 'bg-rose-100' : 'bg-white')}>
        {ok ? <CheckCircle2 className="h-5 w-5 flex-none" aria-hidden /> : mine ? <XCircle className="h-5 w-5 flex-none" aria-hidden /> : <span className="h-5 w-5 flex-none" aria-hidden />}
        <span className="min-w-0 flex-1 whitespace-pre-wrap" dir="auto">{o.text}</span>
        <span className="text-xs font-semibold">{[mine ? t('se.r.yours') : '', ok ? t('se.r.right') : ''].filter(Boolean).join(' · ')}</span>
      </li>; })}</ul>}

    {item.type === 'number' && <div className="space-y-1 text-sm" data-number-review>
      <p><span className="text-slate-600">{t('se.r.your_answer')}: </span><bdi dir="ltr" className="font-semibold">{item.answer?.numberValue === null || item.answer?.numberValue === undefined ? t('se.r.no_answer') : number(item.answer.numberValue)}</bdi></p>
      {item.numberValue !== undefined && item.numberValue !== null && <p><span className="text-slate-600">{t('se.r.right_answer')}: </span><bdi dir="ltr" className="font-semibold">{number(item.numberValue)}</bdi>{item.tolerance ? <span> (± {number(item.tolerance)})</span> : null}</p>}
    </div>}

    {item.type === 'essay' && <div className="space-y-2 text-sm" data-essay-review>
      <p className="text-slate-600"><L id="se.r.your_answer" /></p>
      {item.answer?.text ? <p className="whitespace-pre-wrap rounded-xl border-2 border-black p-3" dir="auto">{item.answer.text}</p> : !item.answer?.uploadId && <p>{t('se.r.no_answer')}</p>}
      {item.answer?.uploadId && <StudentPicture examId={examId} id={item.answer.uploadId} label={t('se.q.your_photo')} />}
      {(item.modelText || item.modelImageId) && <div className="space-y-2 rounded-xl border-2 border-black bg-emerald-50 p-3" data-model>
        <p className="font-semibold"><L id="se.r.model" /></p>
        {item.modelText && <p className="whitespace-pre-wrap" dir="auto">{item.modelText}</p>}
        {item.modelImageId && <StudentPicture examId={examId} id={item.modelImageId} label={t('se.r.model')} />}
      </div>}
    </div>}
    {mark?.note && <p className="text-sm" data-note dir="auto"><span className="font-semibold"><L id="se.r.note" />: </span>{mark.note}</p>}
  </section>;
}
