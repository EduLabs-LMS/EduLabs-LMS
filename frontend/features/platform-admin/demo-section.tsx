'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Badge, Banner, Button, Card, CardBody, CardHead, DefinitionList } from '@/frontend/design-system';
import type { MessageKey } from '@/frontend/locales/messages';
import type { DemoAction, DemoClearResult, DemoFillResult, DemoMarkResult, DemoStatus } from '@/shared/contracts/platform-demo';
import { UtcDate, api, reasonMessage } from './common';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: DemoStatus };
type Notice = { tone: 'ok' | 'warn' | 'error'; key: MessageKey; values?: Record<string, number> };

/**
 * Demo space controls for one teaching space. The status always comes from the server; a button is enabled only when the server-reported
 * state allows it, and the database refuses the rest again. A write whose reply never arrived locks the section until the status is checked.
 */
export function DemoSection({ portalId, accepted }: { portalId: string; accepted: boolean }) {
 const { t } = useLanguage();
 const path = `/api/platform-admin/portals/${portalId}/demo`;
 const [load, setLoad] = useState<Load>({ state: 'loading' });
 const [busy, setBusy] = useState<DemoAction | 'status' | null>(null);
 const [confirm, setConfirm] = useState(false);
 const [notice, setNotice] = useState<Notice | null>(null);
 const [unknown, setUnknown] = useState(false);
 const inflight = useRef(false);

 const refresh = useCallback(async () => {
  const out = await api<DemoStatus>(path);
  if (out.ok) setLoad({ state: 'ready', status: out.data }); else setLoad({ state: 'error' });
  return out.ok;
 }, [path]);
 useEffect(() => { void refresh(); }, [refresh]);

 async function run(action: DemoAction) {
  if (inflight.current || unknown) return; // a second click while a request is running does nothing
  inflight.current = true; setBusy(action); setNotice(null); setConfirm(false);
  const out = await api<DemoMarkResult | DemoFillResult | DemoClearResult>(path, { method: 'POST', body: { action } });
  inflight.current = false; setBusy(null);
  if (out.ok) {
   // A successful write is never reported as failed because the follow-up read failed.
   if (action === 'fill') setNotice({ tone: 'ok', key: 'pa.demo.filled', values: out.data as DemoFillResult as unknown as Record<string, number> });
   else if (action === 'clear') setNotice({ tone: 'ok', key: 'pa.demo.cleared', values: { count: (out.data as DemoClearResult).removedRows } });
   else setNotice({ tone: 'ok', key: action === 'mark' ? 'pa.demo.marked' : 'pa.demo.unmarked' });
   await refresh();
   return;
  }
  if (out.reason === 'network') { setUnknown(true); return; } // outcome unknown: no retry until the status is checked
  setNotice({ tone: 'error', key: reasonMessage(out.reason) });
  if (out.status === 409) void refresh(); // the refusal means the state is not what the page showed
 }
 async function checkStatus() {
  setBusy('status');
  const ok = await refresh();
  setBusy(null);
  if (ok) { setUnknown(false); setNotice({ tone: 'warn', key: 'pa.demo.checked' }); }
 }

 const status = load.state === 'ready' ? load.status : null;
 const locked = busy !== null || unknown || load.state !== 'ready';
 const spinner = (action: DemoAction) => (busy === action ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : null);
 const label: MessageKey = !status || !status.demo ? 'pa.demo.status_off' : status.filled ? 'pa.demo.status_filled' : 'pa.demo.status_empty';

 return <Card labelledBy="pa-p-demo" data-demo-section>
  <CardHead id="pa-p-demo" title={t('pa.demo.title')} aside={status ? <Badge tone={!status.demo ? 'neutral' : status.filled ? 'ok' : 'pending'} data-demo-status={!status.demo ? 'off' : status.filled ? 'filled' : 'empty'}>{t(label)}</Badge> : null} />
  <CardBody>
   <p className="eds-hint">{t('pa.demo.intro')}</p>
   {notice ? <Banner tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{t(notice.key, notice.values)}</Banner> : null}
   {unknown ? <Banner tone="warn" role="alert">
    <span><strong>{t('pa.demo.unknown_title')}</strong><br />{t('pa.demo.unknown_body')}</span>
    <Button variant="primary" size="sm" onClick={() => void checkStatus()} disabled={busy !== null} aria-busy={busy === 'status'}>{busy === 'status' ? <Loader2 size={14} className="eds-spin" aria-hidden="true" /> : null}{t('pa.demo.check_status')}</Button>
   </Banner> : null}
   {load.state === 'loading' ? <p className="eds-hint" role="status">{t('pa.demo.loading')}</p> : null}
   {load.state === 'error' ? <Banner tone="error" role="alert">
    <span>{t('pa.demo.status_failed')}</span>
    <Button size="sm" onClick={() => void refresh()} disabled={busy !== null}>{t('pa.demo.retry')}</Button>
   </Banner> : null}
   {status ? <DefinitionList items={[
    { key: 's', term: t('pa.demo.status_label'), detail: t(label) },
    ...(status.filled && status.seedVersion ? [{ key: 'v', term: t('pa.demo.seed_version'), detail: <bdi dir="ltr">{status.seedVersion}</bdi> }, { key: 'f', term: t('pa.demo.filled_at'), detail: <UtcDate value={status.filledAt} /> }] : []),
   ]} /> : null}
   {status?.filled && status.seedVersion && status.seedVersion < status.latestSeedVersion ? <Banner tone="warn" role="note">{t('pa.demo.outdated', { version: status.seedVersion, latest: status.latestSeedVersion })}</Banner> : null}
   {status ? <div className="eds-actions">
    {!status.demo ? <Button variant="primary" onClick={() => void run('mark')} disabled={locked} aria-busy={busy === 'mark'}>{spinner('mark')}{t('pa.demo.turn_on')}</Button> : <>
     <Button variant="primary" onClick={() => void run('fill')} disabled={locked || status.filled || !accepted} aria-busy={busy === 'fill'}>{spinner('fill')}{t('pa.demo.fill')}</Button>
     <Button onClick={() => { setConfirm(true); setNotice(null); }} disabled={locked || !status.filled}>{t('pa.demo.clear')}</Button>
     <Button variant="danger" onClick={() => void run('unmark')} disabled={locked || status.filled} aria-busy={busy === 'unmark'}>{spinner('unmark')}{t('pa.demo.turn_off')}</Button>
    </>}
   </div> : null}
   {status?.demo && !accepted ? <p className="eds-hint" data-demo-reason="not_accepted">{t('pa.demo.need_accept')}</p> : null}
   {status?.demo && status.filled ? <p className="eds-hint" data-demo-reason="not_cleared">{t('pa.demo.need_clear')}</p> : null}
   {confirm ? <Banner tone="warn" role="group">
    <span>{t('pa.demo.clear_confirm')}</span>
    <span className="eds-actions">
     <Button variant="danger" size="sm" onClick={() => void run('clear')} disabled={locked} aria-busy={busy === 'clear'}>{spinner('clear')}{t('pa.demo.clear_yes')}</Button>
     <Button size="sm" onClick={() => setConfirm(false)} disabled={busy !== null}>{t('pa.action.cancel')}</Button>
    </span>
   </Banner> : null}
  </CardBody>
 </Card>;
}
