'use client';
import type { useGroupSummary } from './use-group-summary';
export function GroupSummaryPanel({summary,staff=false,homework=true}:{summary:ReturnType<typeof useGroupSummary>;staff?:boolean;homework?:boolean}) {
 const counts=summary.data?.[staff?'staff':'own'];
 return <section aria-label="Session attendance summary" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
  <div className="grid grid-cols-2 gap-4">{(['attended','absent'] as const).map(key=><div key={key}><p className="text-sm font-medium text-slate-500">Sessions {key==='attended'?'Attended':'Absent'}</p><p className="mt-2 text-2xl font-bold text-slate-950">{counts?counts[key]:summary.loading?'Loading…':'Unavailable'}</p></div>)}</div>
  <p className="text-xs text-slate-500">{staff?'Explicit attendance marks in your authorized groups.':'Your finalized attendance.'} Pending / Unmarked sessions never count as absent.</p>
  {homework&&!staff&&summary.data&&<p className={summary.data.pendingHomework?'text-sm font-semibold text-rose-700':'text-sm text-emerald-700'}>{summary.data.pendingHomework?`${summary.data.pendingHomework} homework assignment${summary.data.pendingHomework===1?'':'s'} awaiting your submission.`:'No pending homework in your current authorized scope.'}</p>}
  {summary.error&&<p role="alert" className="text-sm text-red-700">{summary.error} <button onClick={summary.refresh} className="underline">Retry summary</button></p>}
 </section>;
}
