'use client';
import Link from 'next/link';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { SegmentedControl, Switch } from '@/frontend/components/design/controls';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { notificationEvents } from '@/shared/contracts/communications';

type Row = { id: string; event_type: string; created_at: string; read_at: string | null; link: string | null };
type Preference = { event_type: string; in_app: boolean; push: boolean };
type EventName = typeof notificationEvents[number];

/** The Notifications page inside the teacher app: the same data and the same handlers as the shared page, drawn with the design components. */
export function TeacherNotifications({ rows, unread, labels, filter, page, loading, error, busy, prefs, publicKey, pushOn, pushSupported, pushText, onFilter, onPage, onRetry, onAction, onPreference, onPush }: {
  rows: readonly Row[] | null; unread: number; labels: Record<string, string>; filter: string; page: number; loading: boolean; error: string; busy: boolean; prefs: readonly Preference[]; publicKey: string; pushOn: boolean | null; pushSupported: boolean; pushText: string;
  onFilter: (filter: string) => void; onPage: (page: number) => void; onRetry: () => void; onAction: (name: string, body?: unknown) => void; onPreference: (event: EventName, inApp: boolean, push: boolean) => void; onPush: (next: boolean) => void;
}) {
  const { language, t, ui } = useLanguage();
  return <div data-teacher-notifications className="d-page">
    <PageHeader title={<L id="settings.notifications" />} secondary={[{ key: 'read-all', label: <L id="notifications.mark_all_as_read" />, disabled: busy || !unread, onClick: () => onAction('read-all'), data: { 'data-read-all': '' } }]} />
    {error && <div role="alert" data-state="error" className="d-alert"><p className="d-alert-text"><L text={error} /></p><Button type="button" onClick={onRetry}><L id="home.retry" /></Button></div>}
    <SegmentedControl label={t('settings.notifications')} value={filter} onChange={onFilter} options={[
      { value: 'all', label: <L id="notifications.all" /> },
      { value: 'unread', label: <L id="notifications.filterUnread" /> },
      { value: 'read', label: <L id="notifications.filterRead" /> },
    ]} />
    {loading
      ? <div role="status" data-state="loading" className="d-list d-card d-card--pad"><div aria-hidden="true" className="d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div><span className="sr-only"><L id="th.state.loading" /></span></div>
      : !error && rows?.length === 0
        ? <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id={filter === 'all' ? 'notifications.empty' : filter === 'unread' ? 'notifications.emptyUnread' : 'notifications.emptyRead'} /></p></div>
        : rows && rows.length > 0 && <ul data-notification-list className="d-list d-card">{rows.map(n => <li key={n.id} data-notification={n.id} className="d-row d-row--action">
          <span aria-hidden className={n.read_at ? 'd-note-dot' : 'd-note-dot d-note-dot--unread'} />
          <span className="d-row-body"><span className="d-label"><L text={labels[n.event_type]} /></span><time className="d-meta" dateTime={n.created_at}>{new Date(n.created_at).toLocaleString(language)}</time>
            {!n.link && n.event_type !== 'account_approved' && <span className="d-meta"><L id="notifications.resource_currently_unavailable" /></span>}</span>
          <span className="d-row-trailing">
            {n.link && <Link className={buttonClass('tertiary')} href={n.link}><L id="notifications.open" /></Link>}
            <Button type="button" disabled={busy} onClick={() => onAction(n.read_at ? 'unread' : 'read', { id: n.id })}><L text={n.read_at ? 'Mark unread' : 'Mark read'} /></Button>
          </span>
        </li>)}</ul>}
    <div className="d-pager">
      <Button type="button" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}><L id="notifications.previous" /></Button>
      <span className="d-meta"><L id="notifications.page" />{' '}{page + 1}</span>
      <Button type="button" disabled={loading || !rows || rows.length < 25} onClick={() => onPage(page + 1)}><L id="notifications.next" /></Button>
    </div>
    <section aria-labelledby="tn-prefs" className="d-card d-card--pad d-stack">
      <h2 id="tn-prefs" className="d-section"><L id="notifications.preferences" /></h2>
      <p className="d-meta"><L id="notifications.push_permission_is_requested_only" /></p>
      <Switch data-browser-push checked={pushOn === true} disabled={busy || pushOn === null || !pushSupported || (pushOn !== true && !publicKey)} reasonId="browser-push-status" onChange={onPush} label={<L id="notifications.browser_push" />} />
      <p id="browser-push-status" role="status" data-browser-push-status className="d-meta"><L text={pushText} /></p>
      <ul className="d-list">{notificationEvents.map(event => {
        const p = prefs.find(v => v.event_type === event);
        return <li key={event} className="d-row d-row--action">
          <span className="d-row-body"><span className="d-body"><L text={labels[event]} /></span></span>
          <span className="d-row-trailing">
            <Switch data-pref-event={event} data-pref-kind="in-app" aria-label={`${ui(labels[event])}: ${t('notifications.in_app')}`} checked={p?.in_app ?? true} disabled={busy} onChange={next => onPreference(event, next, p?.push ?? false)} label={<L id="notifications.in_app" />} />
            <Switch data-pref-event={event} data-pref-kind="push" aria-label={`${ui(labels[event])}: ${t('notifications.push')}`} checked={p?.push ?? false} disabled={busy || !publicKey} reasonId={publicKey ? undefined : 'browser-push-status'} onChange={next => onPreference(event, p?.in_app ?? true, next)} label={<L id="notifications.push" />} />
          </span>
        </li>;
      })}</ul>
    </section>
  </div>;
}
