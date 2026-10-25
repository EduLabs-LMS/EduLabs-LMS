'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Badge, Banner, Button, Card, CardBody, CardHead } from '@/frontend/design-system';
import type { InvitationStatus, ProvisioningReason } from '@/shared/contracts/platform-provisioning';

/** Deterministic across server and browser, so server-rendered markup never mismatches on hydration. */
export function UtcDate({ value }: { value: string | null }) {
 if (!value) return <>—</>;
 return <bdi dir="ltr">{new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC</bdi>;
}

const statusKey = { pending: 'pa.status.pending', accepted: 'pa.status.accepted', revoked: 'pa.status.revoked', expired: 'pa.status.expired' } as const;
const statusTone = { pending: 'pending', accepted: 'ok', revoked: 'off', expired: 'off' } as const;
export function StatusBadge({ status }: { status: InvitationStatus }) {
 const { t } = useLanguage();
 return <Badge tone={statusTone[status]} data-status={status}>{t(statusKey[status])}</Badge>;
}

const reasonKey: Record<ProvisioningReason, 'pa.err.invalid' | 'pa.err.duplicate' | 'pa.err.pending_exists' | 'pa.err.not_found' | 'pa.err.used' | 'pa.err.gone' | 'pa.err.forbidden' | 'pa.err.unavailable'> = {
 invalid: 'pa.err.invalid', duplicate: 'pa.err.duplicate', pending_exists: 'pa.err.pending_exists', not_found: 'pa.err.not_found', used: 'pa.err.used',
 gone: 'pa.err.gone', forbidden: 'pa.err.forbidden', conflict: 'pa.err.used', unavailable: 'pa.err.unavailable',
};
export const reasonMessage = (reason: ProvisioningReason | undefined) => reasonKey[reason ?? 'unavailable'] ?? 'pa.err.unavailable';

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; reason: ProvisioningReason | 'network' };
/** A thrown fetch means the outcome of a write is unknown; callers must say so instead of claiming failure. */
export async function api<T>(path: string, init?: { method: 'GET' | 'POST'; body?: unknown }): Promise<ApiResult<T>> {
 try {
  const response = await fetch(path, {
   method: init?.method ?? 'GET', cache: 'no-store', credentials: 'same-origin',
   ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  const body = await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  return { ok: false, status: response.status, reason: (body?.reason as ProvisioningReason | undefined) ?? 'unavailable' };
 } catch { return { ok: false, status: 0, reason: 'network' }; }
}

/** The invitation secret is displayed once and kept only in component state; it is never persisted. */
export function SecretCard({ secret, expiresAt, delivery = 'not_sent', onDone }: { secret: string; expiresAt: string; delivery?: 'not_sent' | 'sent' | 'failed'; onDone?: () => void }) {
 const { t } = useLanguage();
 const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
 const [origin, setOrigin] = useState('');
 useEffect(() => { setOrigin(window.location.origin); }, []);
 const path = '/teacher-invitation/' + secret;
 const link = origin ? origin + path : path;
 async function copy() {
  try { await navigator.clipboard.writeText(window.location.origin + path); setCopied('yes'); } catch { setCopied('no'); }
 }
 const message = delivery === 'sent' ? 'pa.secret.email_sent' : delivery === 'failed' ? 'pa.secret.email_failed' : 'pa.secret.not_sent';
 return <Card emphasis labelledBy="pa-secret-title">
  <CardHead id="pa-secret-title" title={t('pa.secret.title')} aside={<>{t('pa.secret.expires')} <UtcDate value={expiresAt} /></>} />
  <CardBody>
   <p>{t('pa.secret.once')}</p>
   <div className="eds-input-row">
    <code className="eds-code" dir="ltr" data-invitation-link>{link}</code>
    <Button onClick={copy}>{copied === 'yes' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{t(copied === 'yes' ? 'pa.secret.copied' : 'pa.secret.copy')}</Button>
   </div>
   {copied === 'no' ? <p className="eds-error" role="alert">{t('pa.secret.copy_failed')}</p> : null}
   <Banner tone={delivery === 'sent' ? 'ok' : 'warn'} role="status">{t(message)}</Banner>
   {onDone ? <div className="eds-actions"><Button variant="primary" onClick={onDone}>{t('pa.secret.done')}</Button></div> : null}
  </CardBody>
 </Card>;
}
