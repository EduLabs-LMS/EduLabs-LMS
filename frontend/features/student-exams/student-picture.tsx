'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { studentPictureUrl } from '@/frontend/lib/exam-upload';

/** A picture of an exam (a question picture, a model answer, the student's own photo) through a five-minute signed link the database hands out. */
export function StudentPicture({ examId, id, label }: { examId: string; id: string; label: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; setUrl(null); setFailed(false);
    studentPictureUrl(examId, id).then(u => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [examId, id]);
  if (failed) return <p role="status" data-picture-failed className="text-sm text-slate-600">{t('se.q.picture_failed')}</p>;
  if (!url) return <p role="status" className="text-sm text-slate-600">{t('se.x.loading')}</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={label} data-picture={id} className="max-h-72 w-full rounded-xl border-2 border-black bg-white object-contain" />;
}
