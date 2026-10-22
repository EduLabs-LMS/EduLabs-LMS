'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { Button } from '@/frontend/components/ui/button';
import { administer } from '@/frontend/lib/student-administration';
import type { AccessDetails } from '@/shared/contracts/student-administration';
export function StudentAccess({token}:{token?:string}){
 return <StudentAccessState key={token??'requests'} token={token}/>;
}
function StudentAccessState({token}:{token?:string}){
 const [details,setDetails]=useState<AccessDetails|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[profileId,setProfileId]=useState(''),[page,setPage]=useState(0);
 const [loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),operation=useRef(false);
 const [requests,setRequests]=useState<{id:string;status:string;reason:string;offering_name:string;organization_name:string}[]>([]),request=useRef<string|null>(null);
 useEffect(()=>{let active=true;setLoading(true);setError('');setStatus('');setDetails(null);setRequests([]);setProfileId('');
  const load=token?administer<AccessDetails>('inspect',{token}).then(v=>{if(active)setDetails(v);}):administer<{profileId:string;rows:typeof requests}>('mine',{page}).then(v=>{if(active){setRequests(v.rows);setProfileId(v.profileId);}});
  void load.catch(e=>{if(active)setError(e instanceof Error?e.message:'Learning access could not be loaded.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[token,page,refresh]);
 async function submit(){if(!details||!token||operation.current||loading||error)return;operation.current=true;setBusy(true);setError('');request.current??=crypto.randomUUID();try{const r=await administer<{status:string}>(details.kind==='invite'?'accept':'request',{token},{requestId:request.current});setStatus(r.status==='active'?'Access granted. Open Home to begin.':r.status==='rejected'?'Your request was rejected. Check My requests for details.':r.status==='approved'?'Your request was approved. Check Home or My requests for current access.':'Request pending. Your teacher will review it.');setRefresh(v=>v+1);}catch(e){setError((e as Error).message);}finally{operation.current=false;setBusy(false);}}
 return <section aria-busy={loading} className="mx-auto max-w-xl space-y-5 rounded-3xl border-2 border-black bg-white p-6 shadow-hard"><h1 className="font-display text-3xl">Learning access</h1>{loading&&<p role="status">Loading learning access…</p>}{error&&<div role="alert">{error}<Button variant="outline" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Retry</Button></div>}{status&&<p role="status">{status}</p>}{!loading&&!error&&(details?<><h2 className="text-xl font-semibold">{details.organization}</h2><p>{details.name}</p>{details.enrolled?<p>You already have access.</p>:details.kind==='request'&&details.requestStatus?<p>Request: {details.requestStatus}. {details.requestStatus==='approved'?'Approval is recorded, but current learning access is unavailable. Contact your teacher.':''}</p>:<Button disabled={busy} onClick={()=>void submit()}>{details.kind==='invite'?'Accept invitation':'Request access'}</Button>}</>:!token&&<><p>Ask your teacher for an access link. Registration alone does not grant course access.</p><p className="break-all text-sm">Your profile ID: {profileId}</p>{requests.map(r=><p key={r.id}>{r.organization_name} · {r.offering_name} · {r.status}{r.reason?' · '+r.reason:''}</p>)}<div className="flex gap-2"><Button variant="outline" disabled={busy||!page} onClick={()=>setPage(page-1)}>Previous requests</Button><Button variant="outline" disabled={busy||requests.length<25} onClick={()=>setPage(page+1)}>More requests</Button></div></>)}<div className="flex flex-wrap gap-4"><Button variant="outline" disabled={loading||busy} onClick={()=>setRefresh(v=>v+1)}>Refresh status</Button><Link href="/home">Home</Link><Link href="/access">My requests</Link></div></section>;
}
