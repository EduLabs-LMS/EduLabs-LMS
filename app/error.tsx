'use client';
import { useLocale } from '@/frontend/design/preferences';
export default function ErrorPage({ reset }: { error:Error & {digest?:string}; reset:()=>void }) {
  const {locale}=useLocale();
  return <section className="edu-app edu-card mx-auto my-12 max-w-lg space-y-6" role="alert"><h1 className="text-3xl">{locale==='ar'?'تعذر تحميل هذه الصفحة.':'We couldn’t load this page.'}</h1><p>{locale==='ar'?'حاول مجددًا. تغييراتك المحفوظة ما زالت محفوظة.':'Please try again. Your saved changes are still safe.'}</p><button className="edu-btn edu-btn-green" onClick={reset}>{locale==='ar'?'إعادة المحاولة':'Try again'}</button></section>;
}
