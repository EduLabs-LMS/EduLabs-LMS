import Link from 'next/link';
import { T } from '@/frontend/design/preferences';
import { Brand } from '@/frontend/design/tree';
export default function NotFound() {
  return <section className="edu-app edu-card mx-auto my-12 max-w-lg space-y-6"><Brand/><p className="edu-pill">404</p><h1 className="text-3xl"><T arabic="تعذر العثور على هذه الصفحة.">This page could not be found.</T></h1><p className="edu-muted"><T arabic="تحقق من الرابط أو عد إلى مساحتك التعليمية.">Check the address or return to your learning space.</T></p><Link className="edu-btn edu-btn-green" href="/home"><T>Return to Home</T></Link></section>;
}
