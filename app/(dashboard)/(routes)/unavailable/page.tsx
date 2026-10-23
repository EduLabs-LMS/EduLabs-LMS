import Link from 'next/link';
import { isFirebaseStaging } from '@/shared/auth-config';
import { notFound } from 'next/navigation';

export default function UnavailablePage() {
  if (!isFirebaseStaging()) notFound();
  return <div className="mx-auto max-w-3xl rounded-3xl border-2 border-black bg-white p-8 shadow-hard-sm"><h1 className="text-2xl font-bold text-slate-900">This feature is awaiting integration</h1><p className="mt-4 text-sm text-slate-500">Module/lesson editing, homework, video playback, exams, staff administration, support tickets, live sessions, notifications, payments, personalization and notes are not available in this staging phase. Your existing records are preserved.</p><Link className="mt-6 inline-block font-semibold text-green-900" href="/home">Return to Home</Link></div>;
}
