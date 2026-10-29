import Link from 'next/link';
import { Bell } from 'lucide-react';
import { L } from '@/frontend/components/language-provider';

/** The notification preferences (events, in-app, browser push) already live on the Notifications page; this section opens it instead of copying it. */
export function TeacherNotificationsSection() {
  return <section aria-labelledby="ts-notifications-h" data-settings-notifications className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6">
    <h2 id="ts-notifications-h" className="flex items-center gap-2 font-display text-2xl"><Bell aria-hidden className="h-6 w-6" /><L id="settings.notifications" /></h2>
    <p className="mt-3 text-sm text-slate-600"><L id="settings.view_your_notifications_and_manage" /></p>
    <Link href="/notifications" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border-2 border-black bg-primary px-5 py-2.5 text-sm font-bold shadow-hard-sm"><L id="settings.open_notifications" /></Link>
  </section>;
}
