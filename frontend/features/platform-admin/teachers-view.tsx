'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Banner, Button, ButtonLink, Card, Page, PageHeader } from '@/frontend/design-system';
import type { PortalOverview } from '@/shared/contracts/platform-provisioning';
import { StatusBadge, UtcDate, api, reasonMessage } from './common';

export function TeachersView({ initial }: { initial: PortalOverview | null }) {
 const { t } = useLanguage();
 const [data, setData] = useState(initial);
 const [loading, setLoading] = useState(false);
 const [failed, setFailed] = useState<ReturnType<typeof reasonMessage> | 'pa.err.network' | null>(initial ? null : 'pa.err.unavailable');

 async function refresh() {
  setLoading(true);
  const out = await api<PortalOverview>('/api/platform-admin/portals');
  setLoading(false);
  if (out.ok) { setData(out.data); setFailed(null); return; }
  setFailed(out.reason === 'network' ? 'pa.err.network' : reasonMessage(out.reason));
 }

 return <Page layout="wide">
  <PageHeader title={t('pa.teachers.title')} intro={t('pa.teachers.intro')} actions={<>
   <Button onClick={refresh} disabled={loading} aria-busy={loading}>
    {loading ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{t('pa.action.refresh')}
   </Button>
   <ButtonLink href="/platform-admin/teachers/new" variant="primary"><Plus size={16} aria-hidden="true" />{t('pa.teachers.new')}</ButtonLink>
  </>} />
  {failed ? <Banner tone="error" role="alert"><span>{t(failed)}</span><Button size="sm" onClick={refresh}>{t('pa.action.retry')}</Button></Banner> : null}
  {data && data.items.length === 0 ? <Card><div className="eds-empty"><strong>{t('pa.teachers.empty_title')}</strong><span>{t('pa.teachers.empty_body')}</span>
   <ButtonLink href="/platform-admin/teachers/new" variant="primary">{t('pa.teachers.new')}</ButtonLink></div></Card> : null}
  {data && data.items.length > 0 ? <Card>
   <div className="eds-table-wrap">
    <table className="eds-table">
     <caption className="eds-sr">{t('pa.teachers.title')}</caption>
     <thead><tr><th scope="col">{t('pa.col.teacher')}</th><th scope="col">{t('pa.col.course')}</th><th scope="col">{t('pa.col.status')}</th><th scope="col">{t('pa.col.created')}</th></tr></thead>
     <tbody>
      {data.items.map((item) => <tr key={item.organizationId}>
       <td data-label={t('pa.col.teacher')}><Link href={`/platform-admin/teachers/${item.organizationId}`} className="eds-strong" dir="ltr">{item.teacherEmail}</Link></td>
       <td data-label={t('pa.col.course')}>{item.course ? <><span className="eds-strong">{item.course.title}</span><span className="eds-meta">{[item.course.educationSystem, item.course.examinationBoard, item.course.grade, item.course.subject].filter(Boolean).join(' · ')}</span></> : '—'}</td>
       <td data-label={t('pa.col.status')}><StatusBadge status={item.invitationStatus} /></td>
       <td data-label={t('pa.col.created')}><UtcDate value={item.createdAt} /></td>
      </tr>)}
     </tbody>
    </table>
   </div>
   {data.hasMore ? <p className="eds-hint eds-pad">{t('pa.teachers.more')}</p> : null}
  </Card> : null}
 </Page>;
}
