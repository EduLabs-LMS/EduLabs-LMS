'use client';
import { useLocale } from './preferences';
export function CourseSearch({ action, organization, title }: { action:string; organization?:string; title?:string }) {
  const {t}=useLocale();
  return <form className="flex flex-wrap gap-3" action={action}>{organization&&<input type="hidden" name="organization" value={organization}/>}<label className="min-w-0 flex-1"><span className="sr-only">{t('Search your courses')}</span><input aria-label={t('Search your courses')} name="title" defaultValue={title} maxLength={200} placeholder={t('Search your courses')}/></label><button className="edu-btn edu-btn-green">{t('Search')}</button></form>;
}
