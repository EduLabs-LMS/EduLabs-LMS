'use client';
import { L, Localized, useLanguage } from '@/frontend/components/language-provider';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2,MessageCircle } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/frontend/components/ui/dialog';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { AttentionTag,BackButton,ChatFrame,ChatHeader,FilterPills,MessageBubble,PaperclipIcon,SendIcon,StatusSelect,SupportHeaderCard,TicketCard } from '@/frontend/features/support/support-ui';
import { useReplyDraft } from '@/frontend/features/support/use-reply-draft';
import { communicate } from '@/frontend/lib/communications';
import type { SupportDetail,SupportTicket } from '@/shared/contracts/communications';

const field='h-11 w-full rounded-xl border-2 border-black bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const alertBox='flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-sm text-red-800';
const FILTERS=[['ALL','support.filter_all'],['OPEN','support.filter_open'],['IN_PROGRESS','support.filter_in_progress'],['RESOLVED','support.filter_resolved']] as const;

export function SupabaseSupportView(){
 const { language,t } = useLanguage();
 const date=(v:string)=>new Date(v).toLocaleString(language,{dateStyle:'medium',timeStyle:'short'});
 const params=useSearchParams();
 const [rows,setRows]=useState<SupportTicket[]>([]),[detail,setDetail]=useState<SupportDetail|null>(null),[page,setPage]=useState(0),[messagePage,setMessagePage]=useState(0);
 const [filter,setFilter]=useState('ALL'),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[opening,setOpening]=useState<string|null>(null);
 const [orgs,setOrgs]=useState<{id:string;name:string}[]>([]),[org,setOrg]=useState(''),[category,setCategory]=useState('website'),[subject,setSubject]=useState(''),[newText,setNewText]=useState('');
 // The reply draft is saved per ticket, separate from the New Ticket form, so neither wipes the other.
 const [reply,setReply]=useReplyDraft(detail?.ticket.id??null);
 const scrollRef=useRef<HTMLElement>(null);
 // Reuse the same request after a network failure; a new payload gets a new ID.
 const pending=useRef<{fingerprint:string;id:string;version?:number}|null>(null);
 const load=useCallback(async()=>{setError('');setLoading(true);try{const r=await communicate<{rows:SupportTicket[]}>('support','list',{page,filter,search});setRows(r.rows);}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[page,filter,search]);
 const openTicket=useCallback(async(id:string,p=0)=>{setError('');try{setDetail(await communicate<SupportDetail>('support','get',{page:p},{id}));setMessagePage(p);}catch(e){if([401,403].includes((e as {status?:number}).status??0)){setDetail(null);setRows([]);}setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{void communicate<{id:string;name:string}[]>('support','organizations').then(setOrgs).catch(e=>setError(e.message));},[]);
 useEffect(()=>{const id=params.get('ticket');if(id&&/^[a-f0-9-]{36}$/i.test(id))void openTicket(id);},[params,openTicket]);
 const activeTicketId=detail?.ticket.id;
 useEffect(()=>{if(!activeTicketId)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void openTicket(activeTicketId,messagePage);},15000);return()=>clearInterval(timer);},[activeTicketId,messagePage,openTicket]);
 // Newest messages are at index 0 of the page; keep the thread pinned to the latest one.
 const newestId=detail?.messages[0]?.id;
 useEffect(()=>{if(messagePage===0&&scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[newestId,messagePage,activeTicketId]);
 async function command(action:string,data:unknown){
  const fingerprint=JSON.stringify({action,data,id:detail?.ticket.id});
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID(),version:detail?.ticket.version};
  setBusy(true);setError('');try{
   const r=await communicate<{id:string}>('support',action,data,{id:action==='create'?null:detail?.ticket.id,version:pending.current.version,requestId:pending.current.id});
   pending.current=null;
   // Clear only what the finished action owns, so a status change never wipes a half-written reply.
   if(action==='create'){setNewText('');setSubject('');setOpen(false);}
   if(action==='reply')setReply('');
   await openTicket(r.id);await load();
  }catch(e){if((e as {status?:number}).status===409)pending.current=null;setError((e as Error).message);}finally{setBusy(false);}
 }
 const retry=<Button variant="outline" onClick={()=>detail?void openTicket(detail.ticket.id,messagePage):void load()}><L id="support.retry_refresh"/></Button>;
 const isStaffViewer=rows.some(r=>r.staff);
 const overdue=(due:string|null)=>Boolean(due)&&Date.parse(due as string)<Date.now();

 const newTicketDialog=<Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-display text-2xl"><L id="support.new_ticket_"/></DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={e=>{e.preventDefault();void command('create',{organizationId:org||null,category,subject,body:newText});}}>
   <label className="grid gap-1 text-sm font-semibold"><L id="support.support_team"/><select className={field} value={org} onChange={e=>setOrg(e.target.value)}><option value=""><L id="support.edulabs_platform_technical_support"/></option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   <label className="grid gap-1 text-sm font-semibold"><L id="support.issue_category"/><select className={field} value={category} onChange={e=>setCategory(e.target.value)}>{['account','video','upload','exam','website','other'].map(c=><option key={c} value={c}><L text={c}/></option>)}</select></label>
   <label className="grid gap-1 text-sm font-semibold"><L id="support.subject"/><Input className="h-11" maxLength={120} required value={subject} onChange={e=>setSubject(e.target.value)}/></label>
   <label className="grid gap-1 text-sm font-semibold"><L id="support.describe_your_problem"/><Textarea maxLength={2000} required value={newText} onChange={e=>setNewText(e.target.value)}/></label>
   {error&&open&&<p role="alert" className="text-sm text-red-700"><L text={error}/></p>}
   <Button disabled={busy||!newText.trim()||!subject.trim()}>{busy&&<Loader2 className="me-2 h-4 w-4 animate-spin"/>}<L id="support.create_ticket"/></Button>
  </form></DialogContent></Dialog>;

 if(detail){
  const tk=detail.ticket,due=tk.status!=='RESOLVED'?tk.response_due_at:null;
  // Requesters may only Reopen/Close; In Progress is staff-only (the server enforces it too). A requester still sees it when it is the current state.
  const statusOptions=(['OPEN','IN_PROGRESS','RESOLVED'] as const).filter(s=>detail.staff||s!=='IN_PROGRESS'||tk.status==='IN_PROGRESS').map(s=>({value:s,label:<L id={s==='OPEN'?'support.filter_open':s==='IN_PROGRESS'?'support.filter_in_progress':'support.filter_resolved'}/>,disabled:!detail.staff&&s==='IN_PROGRESS'}));
  const sendReply=()=>{if(!busy&&reply.trim())void command('reply',{body:reply});};
  return <div className="mx-auto w-full max-w-3xl space-y-4 pb-6">
   {error&&<div role="alert" className={alertBox}><L text={error}/>{retry}</div>}
   <ChatFrame>
    <ChatHeader back={<BackButton label={t('support.back_to_tickets')} onClick={()=>setDetail(null)}/>} title={<bdi dir="auto">{tk.subject}</bdi>}
     subtitle={<><L id="support.opened"/>{" "}<bdi>{date(tk.created_at)}</bdi>{" "}<L id="support.updated"/>{" "}<bdi>{date(tk.updated_at)}</bdi></>}
     control={<StatusSelect ariaLabel={t('support.ticket_status')} value={tk.status} disabled={busy} options={statusOptions} onChange={v=>{if(v!==tk.status)void command('status',{status:v});}}/>}/>
    {(due||detail.staff)&&<div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-200 bg-white px-4 py-2 text-sm">
     {due?<p className={overdue(due)?'font-semibold text-red-700':'text-amber-800'}><L id="support.response_due"/>{" "}<bdi>{date(due)}</bdi>{overdue(due)&&<L id="support.overdueSuffix"/>}</p>:<span/>}
     {detail.staff&&<label className="flex items-center gap-2"><span className="font-semibold"><L id="support.assigned_to"/></span><select className={field+' w-auto max-w-full'} value={tk.assigned_to??''} disabled={busy} onChange={e=>void command('assign',{userId:e.target.value||null})}><option value=""><L id="support.unassigned"/></option>{detail.assignees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    </div>}
    <Localized as="section" ref={scrollRef} tabIndex={0} labels={{"aria-label":"support.ticket_messages"}} className="flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-3 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
     {detail.messages.length>=25&&<div className="flex justify-center"><Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={()=>void openTicket(tk.id,messagePage+1)}><L id="support.older_messages"/></Button></div>}
     {detail.messages.length===0?<p className="text-center text-sm text-slate-700"><L id="support.no_messages_on_this_page"/></p>:[...detail.messages].reverse().map(m=><MessageBubble key={m.id} name={m.sender_name} avatarUrl={null} staffLabel={m.staff?<L id="support.staff_label"/>:undefined} onEnd={m.mine||(detail.staff&&m.staff)} time={<bdi>{date(m.created_at)}</bdi>}><p dir="auto" className="whitespace-pre-wrap break-words">{m.body}</p></MessageBubble>)}
     {messagePage>0&&<div className="flex justify-center"><Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={()=>void openTicket(tk.id,messagePage-1)}><L id="support.newer_messages"/></Button></div>}
    </Localized>
    <form className="space-y-2 border-t-[2.5px] border-black bg-white p-3 sm:p-4" onSubmit={e=>{e.preventDefault();sendReply();}}>
     <div className="flex items-end gap-3">
      <Button type="button" variant="outline" className="h-12 w-12 shrink-0 p-0" disabled aria-label={t('support.attach_soon')} title={t('support.attach_soon')}><PaperclipIcon/></Button>
      <label htmlFor="support-reply" className="sr-only"><L id="support.reply"/></label>
      <Textarea id="support-reply" rows={2} maxLength={2000} className="max-h-40 min-h-[48px] resize-none" placeholder={t(detail.staff?'support.reply_placeholder_staff':'support.reply_placeholder_requester')} value={reply} onChange={e=>setReply(e.target.value)}
       onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){e.preventDefault();sendReply();}}}/>
      <Button type="submit" className="h-12 w-12 shrink-0 p-0" disabled={busy||!reply.trim()} aria-label={t('support.send_reply')}>{busy?<Loader2 className="h-5 w-5 animate-spin"/>:<SendIcon/>}</Button>
     </div>
     <p className="px-1 text-xs text-slate-600"><span className="hidden [@media(pointer:fine)]:inline"><L id="support.hint_enter"/></span><L id="support.hint_attachments_soon"/>{reply.length>=1800&&<span className="ms-2 font-semibold" aria-live="polite">{reply.length}/2000</span>}</p>
    </form>
   </ChatFrame>
   {newTicketDialog}
  </div>;
 }

 return <div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
  <SupportHeaderCard title={<L id="navigation.support"/>} subtitle={<L id={isStaffViewer?'support.subtitle_staff':'support.website_help_and_private_replies'}/>} newTicketLabel={<L id="support.new_ticket"/>} onNewTicket={()=>{setOpen(true);}}/>
  <p className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-700"><L id="support.we_aim_to_respond_within"/></p>
  {error&&<div role="alert" className={alertBox}><L text={error}/>{retry}</div>}
  <FilterPills ariaLabel={t('support.ticket_status')} value={filter} onChange={v=>{setFilter(v);setPage(0);}} options={FILTERS.map(([value,key])=>({value,label:<L id={key}/>}))}/>
  <Localized as={Input} labels={{"aria-label":"support.search_tickets","placeholder":"support.search_ticket_subjects"}} className="h-11 max-w-md" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/>
  {loading?<div role="status" aria-label={t('support.loading')} className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin"/></div>:!error&&rows.length===0?<div className="rounded-[28px] border-[2.5px] border-black bg-white p-8 text-center shadow-hard-sm"><MessageCircle className="mx-auto mb-2 h-8 w-8 text-slate-600"/><p className="text-sm text-slate-700"><L id="support.no_matching_tickets_use_new"/></p></div>:<ul className="space-y-4">{rows.map(tk=>{const waiting=Boolean(tk.response_due_at)&&tk.status!=='RESOLVED';return <li key={tk.id}><TicketCard busy={opening===tk.id} onOpen={()=>{setOpening(tk.id);void openTicket(tk.id).finally(()=>setOpening(null));}}
    avatar={<span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-black bg-primary text-primary-foreground"><MessageCircle className="h-5 w-5"/></span>}
    title={<bdi dir="auto">{tk.subject}</bdi>}
    badges={<><StatusBadge status={tk.status}/>{waiting&&<AttentionTag tone="wait"><L id={tk.staff?'support.awaiting_reply':'support.waiting_for_support'}/></AttentionTag>}{waiting&&overdue(tk.response_due_at)&&<AttentionTag tone="late"><L id="support.overdue_tag"/></AttentionTag>}</>}
    meta={<span className="capitalize"><L text={tk.category}/></span>}
    footer={<><L id="support.opened"/>{" "}<bdi>{date(tk.created_at)}</bdi>{" "}<L id="support.last_message"/>{" "}<bdi>{date(tk.last_message_at)}</bdi>{waiting&&<span className={`mt-1 block font-semibold ${overdue(tk.response_due_at)?'text-red-700':'text-amber-800'}`}>{overdue(tk.response_due_at)&&<L id="support.overdue"/>}<L id="support.response_due"/>{" "}<bdi>{date(tk.response_due_at as string)}</bdi></span>}</>}/></li>;})}</ul>}
  <div className="flex items-center gap-3"><Button variant="outline" disabled={page===0||loading} onClick={()=>setPage(page-1)}><L id="notifications.previous"/></Button><span className="p-2 text-sm"><L id="notifications.page"/>{" "}{page+1}</span><Button variant="outline" disabled={rows.length<25||loading} onClick={()=>setPage(page+1)}><L id="notifications.next"/></Button></div>
  {newTicketDialog}
 </div>;
}
