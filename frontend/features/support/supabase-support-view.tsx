'use client';
import { L, Localized, useLanguage } from '@/frontend/components/language-provider';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft,LifeBuoy,Loader2,MessageCircle,PlusCircle,Send } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/frontend/components/ui/dialog';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { communicate } from '@/frontend/lib/communications';
import type { SupportDetail,SupportTicket } from '@/shared/contracts/communications';

const panel='rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm';
export function SupabaseSupportView(){
 const { language } = useLanguage();
 const date=(v:string)=>new Date(v).toLocaleString(language,{dateStyle:'medium',timeStyle:'short'});
 const params=useSearchParams();
 const [rows,setRows]=useState<SupportTicket[]>([]),[detail,setDetail]=useState<SupportDetail|null>(null),[page,setPage]=useState(0),[messagePage,setMessagePage]=useState(0);
 const [filter,setFilter]=useState('ALL'),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const [orgs,setOrgs]=useState<{id:string;name:string}[]>([]),[org,setOrg]=useState(''),[category,setCategory]=useState('website'),[subject,setSubject]=useState(''),[text,setText]=useState('');
 // Reuse the same request after a network failure; a new payload gets a new ID.
 const pending=useRef<{fingerprint:string;id:string;version?:number}|null>(null);
 const load=useCallback(async()=>{setError('');setLoading(true);try{const r=await communicate<{rows:SupportTicket[]}>('support','list',{page,filter,search});setRows(r.rows);}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[page,filter,search]);
 const openTicket=useCallback(async(id:string,p=0)=>{setError('');try{setDetail(await communicate<SupportDetail>('support','get',{page:p},{id}));setMessagePage(p);}catch(e){if([401,403].includes((e as {status?:number}).status??0)){setDetail(null);setRows([]);}setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{void communicate<{id:string;name:string}[]>('support','organizations').then(setOrgs).catch(e=>setError(e.message));},[]);
 useEffect(()=>{const id=params.get('ticket');if(id&&/^[a-f0-9-]{36}$/i.test(id))void openTicket(id);},[params,openTicket]);
 const activeTicketId=detail?.ticket.id;
 useEffect(()=>{if(!activeTicketId)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void openTicket(activeTicketId,messagePage);},15000);return()=>clearInterval(timer);},[activeTicketId,messagePage,openTicket]);
 async function command(action:string,data:unknown){
  const fingerprint=JSON.stringify({action,data,id:detail?.ticket.id});
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID(),version:detail?.ticket.version};
  setBusy(true);setError('');try{
   const r=await communicate<{id:string}>('support',action,data,{id:action==='create'?null:detail?.ticket.id,version:pending.current.version,requestId:pending.current.id});
   pending.current=null;setText('');setSubject('');setOpen(false);await openTicket(r.id);await load();
  }catch(e){if((e as {status?:number}).status===409)pending.current=null;setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-5 shadow-hard">
   <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-primary"><LifeBuoy className="h-6 w-6"/></div><div><h1 className="font-display text-3xl leading-none"><L id="navigation.support"/></h1><p className="mt-1 text-sm text-slate-600"><L id="support.website_help_and_private_replies"/></p></div></div>
   <Button onClick={()=>{setText('');setOpen(true);}}><PlusCircle className="mr-2 h-4 w-4"/><L id="support.new_ticket"/></Button>
  </div>
  <p className="text-xs text-slate-600"><L id="support.we_aim_to_respond_within"/></p>
  {error&&<div role="alert" className={panel}><L text={error}/><Button variant="outline" onClick={()=>detail?void openTicket(detail.ticket.id,messagePage):void load()}><L id="support.retry_refresh"/></Button></div>}
  {detail?<>
   <Button variant="outline" onClick={()=>{setDetail(null);setText('');}}><ArrowLeft className="mr-2 h-4 w-4"/><L id="support.back_to_tickets"/></Button>
   <section className={panel}><div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-2xl break-words"><bdi dir="auto">{detail.ticket.subject}</bdi></h2><StatusBadge status={detail.ticket.status}/></div>
    <p className="text-xs text-slate-500"><L id="support.opened"/>{" "}{date(detail.ticket.created_at)}{" "}<L id="support.updated"/>{" "}{date(detail.ticket.updated_at)}</p>
    <div className="mt-3 flex flex-wrap gap-2">{(['OPEN','IN_PROGRESS','RESOLVED'] as const).filter(s=>detail.staff||s!=='IN_PROGRESS').map(status=><Button key={status} variant="outline" disabled={busy||status===detail.ticket.status} onClick={()=>void command('status',{status})}><L text={status==='OPEN'?'Reopen':status==='RESOLVED'?'Close ticket':'In Progress'}/></Button>)}</div>
    {detail.staff&&<label className="mt-3 block text-sm"><L id="support.assigned_to"/><select className="ml-2 max-w-full rounded-xl border-2 border-black p-2" value={detail.ticket.assigned_to??''} disabled={busy} onChange={e=>void command('assign',{userId:e.target.value||null})}><option value=""><L id="support.unassigned"/></option>{detail.assignees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    {detail.ticket.response_due_at&&detail.ticket.status!=='RESOLVED'&&<p className="mt-3 text-xs text-amber-800"><L id="support.response_due"/>{" "}{date(detail.ticket.response_due_at)}{Date.parse(detail.ticket.response_due_at)<Date.now()&&<L id="support.overdueSuffix"/>}</p>}
   </section>
   <Localized as="section" labels={{"aria-label":"support.ticket_messages"}} className={panel}>{detail.messages.length===0?<p><L id="support.no_messages_on_this_page"/></p>:[...detail.messages].reverse().map(m=><div key={m.id} className={`mb-4 max-w-full rounded-xl border-2 p-3 ${m.mine?'border-black bg-primary/20':'border-slate-200 bg-slate-50'}`}><p className="text-xs font-semibold">{m.sender_name}{m.staff&&<L id="support.staffSuffix"/>} · {date(m.created_at)}</p><p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p></div>)}
    <div className="flex gap-2"><Button variant="outline" disabled={messagePage===0} onClick={()=>void openTicket(detail.ticket.id,messagePage-1)}><L id="support.newer_messages"/></Button><Button variant="outline" disabled={detail.messages.length<25} onClick={()=>void openTicket(detail.ticket.id,messagePage+1)}><L id="support.older_messages"/></Button></div>
   </Localized>
   <form className={panel} onSubmit={e=>{e.preventDefault();void command('reply',{body:text});}}><label htmlFor="support-reply" className="text-sm font-semibold"><L id="support.reply"/></label><Textarea id="support-reply" maxLength={2000} value={text} onChange={e=>setText(e.target.value)} required/><Button className="mt-3" disabled={busy||!text.trim()}><Send className="mr-2 h-4 w-4"/><L id="support.send_reply"/></Button></form>
  </>:<>
   <div className="flex flex-wrap gap-2"><Localized as={Input} labels={{"aria-label":"support.search_tickets","placeholder":"support.search_ticket_subjects"}} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><Localized as="select" labels={{"aria-label":"support.ticket_status"}} className="rounded-xl border-2 border-black p-2" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}>{['ALL','OPEN','IN_PROGRESS','RESOLVED'].map(s=><option key={s} value={s}><L text={s}/></option>)}</Localized></div>
   {loading?<Loader2 className="mx-auto h-6 w-6 animate-spin"/>:!error&&rows.length===0?<div className={`${panel} text-center`}><MessageCircle className="mx-auto h-8 w-8 text-slate-400"/><p><L id="support.no_matching_tickets_use_new"/></p></div>:<ul className="space-y-3">{rows.map(t=><li key={t.id}><button className={`${panel} w-full text-left transition-all hover:shadow-hard`} onClick={()=>void openTicket(t.id)}><div className="flex flex-wrap items-center gap-2"><span className="font-semibold break-words"><bdi dir="auto">{t.subject}</bdi></span><StatusBadge status={t.status}/></div><p className="mt-2 text-xs text-slate-500"><L id="support.opened"/>{" "}{date(t.created_at)}{" "}<L id="support.last_message"/>{" "}{date(t.last_message_at)}</p>{t.response_due_at&&t.status!=='RESOLVED'&&<p className="text-xs text-amber-800">{Date.parse(t.response_due_at)<Date.now()&&<L id="support.overdue"/>}<L id="support.response_due"/>{" "}{date(t.response_due_at)}</p>}</button></li>)}</ul>}
   <div className="flex gap-2"><Button variant="outline" disabled={page===0||loading} onClick={()=>setPage(page-1)}><L id="notifications.previous"/></Button><span className="p-2"><L id="notifications.page"/>{" "}{page+1}</span><Button variant="outline" disabled={rows.length<25||loading} onClick={()=>setPage(page+1)}><L id="notifications.next"/></Button></div>
  </>}
  <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-display text-2xl"><L id="support.new_ticket_"/></DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={e=>{e.preventDefault();void command('create',{organizationId:org||null,category,subject,body:text});}}>
   <label className="grid gap-1 text-sm"><L id="support.support_team"/><select className="rounded-xl border-2 border-black p-2" value={org} onChange={e=>setOrg(e.target.value)}><option value=""><L id="support.edulabs_platform_technical_support"/></option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   <label className="grid gap-1 text-sm"><L id="support.issue_category"/><select className="rounded-xl border-2 border-black p-2" value={category} onChange={e=>setCategory(e.target.value)}>{['account','video','upload','exam','website','other'].map(c=><option key={c} value={c}><L text={c}/></option>)}</select></label>
   <label className="grid gap-1 text-sm"><L id="support.subject"/><Input maxLength={120} required value={subject} onChange={e=>setSubject(e.target.value)}/></label>
   <label className="grid gap-1 text-sm"><L id="support.describe_your_problem"/><Textarea maxLength={2000} required value={text} onChange={e=>setText(e.target.value)}/></label><Button disabled={busy||!text.trim()||!subject.trim()}><L id="support.create_ticket"/></Button>
  </form></DialogContent></Dialog>
 </div>;
}
