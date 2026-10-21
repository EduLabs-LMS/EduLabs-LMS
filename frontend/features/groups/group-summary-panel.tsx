'use client';
import { L, Localized, LocalCount } from '@/frontend/components/language-provider';
import type { useGroupSummary } from './use-group-summary';
export function GroupSummaryPanel({summary,staff=false,homework=true}:{summary:ReturnType<typeof useGroupSummary>;staff?:boolean;homework?:boolean}) {
 const counts=summary.data?.[staff?'staff':'own'];
 return <Localized as="section" labels={{"aria-label":"common.session_attendance_summary"}} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
  <div className="grid grid-cols-2 gap-4">{(['attended','absent'] as const).map(key=><div key={key}><p className="text-sm font-medium text-slate-500"><L id="common.sessions"/>{" "}{key==='attended'?<L id="common.attended"/>:<L id="common.absent"/>}</p><p className="mt-2 text-2xl font-bold text-slate-950">{counts?counts[key]:summary.loading?<L id="common.loading"/>:<L id="common.unavailable"/>}</p></div>)}</div>
  <p className="text-xs text-slate-500">{staff?<L id="groups.explicitMarks"/>:<L id="groups.ownAttendance"/>}{" "}<L id="common.pending_unmarked_sessions_never_count"/></p>
  {homework&&!staff&&summary.data&&<p className={summary.data.pendingHomework?'text-sm font-semibold text-rose-700':'text-sm text-emerald-700'}>{summary.data.pendingHomework?<LocalCount count={summary.data.pendingHomework} noun="pendingHomework"/>:<L id="groups.noHomework"/>}</p>}
  {summary.error&&<p role="alert" className="text-sm text-red-700">{summary.error} <button onClick={summary.refresh} className="underline"><L id="common.retry_summary"/></button></p>}
 </Localized>;
}
