import Link from 'next/link';
import { L } from '@/frontend/components/language-provider';
import { buttonClass } from '@/frontend/components/design/button';

/** The notification preferences (events, in-app, browser push) already live on the Notifications page; this section opens it instead of copying it. */
export function TeacherNotificationsSection() {
  return <section aria-labelledby="ts-notifications-h" data-settings-notifications className="d-card d-card--pad d-stack">
    <h2 id="ts-notifications-h" className="d-section"><L id="settings.notifications" /></h2>
    <p className="d-meta"><L id="settings.view_your_notifications_and_manage" /></p>
    <Link href="/notifications" className={buttonClass('primary')}><L id="settings.open_notifications" /></Link>
  </section>;
}
