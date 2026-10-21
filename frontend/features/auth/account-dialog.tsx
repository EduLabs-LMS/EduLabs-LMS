'use client';
import { L, Localized } from '@/frontend/components/language-provider';
import { useEffect,useRef,useState } from 'react';
import type { User } from 'firebase/auth';
import { Portal,Overlay,Content,Close } from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { AccountSecurity } from './account-security';
import { Dialog,DialogTitle,DialogDescription } from '@/frontend/components/ui/dialog';
import { AvatarPicker } from './avatar-picker';
import { accountNames,providerPhoto } from '@/shared/contracts/account';
import type { AccountProfile } from '@/shared/contracts/account';
import { accountRequest,uploadAccountAvatar } from '@/frontend/lib/account';
import { readAccountDraft,clearAccountDraft } from '@/frontend/lib/account-draft';

export function AccountDialog({open,onOpenChange,profile,user,onSaved,reload,error,onboarding=false,children}:{open:boolean;onOpenChange:(open:boolean)=>void;profile:AccountProfile|null;user:User;onSaved:(profile:AccountProfile)=>void;reload:()=>Promise<void>;error:string;onboarding?:boolean;children?:React.ReactNode}){
 const [profileBusy,setProfileBusy]=useState(false),[securityBusy,setSecurityBusy]=useState(false);const locked=profileBusy||securityBusy;
 const previousOpen=useRef(false),opener=useRef<HTMLElement|null>(null);
 if(open&&!previousOpen.current&&typeof document!=='undefined')opener.current=document.activeElement as HTMLElement;
 previousOpen.current=open;
 return <Dialog open={open} onOpenChange={value=>{if(!locked)onOpenChange(value);}}><Portal><Overlay className="fixed inset-0 z-[100000] bg-black/50 backdrop-blur-md"/><Content onCloseAutoFocus={event=>{event.preventDefault();opener.current?.focus();}} className="fixed left-1/2 top-1/2 z-[100001] max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 space-y-5 overflow-y-auto rounded-[28px] border-[2.5px] border-black bg-card p-5 shadow-hard-lg sm:p-8"><Localized as={Close} labels={{"aria-label":"account.close_account"}} disabled={locked} className="absolute end-4 top-4 rounded p-1 focus:ring-2 focus:ring-black disabled:opacity-40"><X className="h-5 w-5"/></Localized><DialogTitle className="pr-6 font-display text-2xl">{onboarding?<L id="account.makeHome"/>:<L id="account.title"/>}</DialogTitle><DialogDescription>{onboarding?<L id="account.setupAccess"/>:<L id="account.acrossTeachers"/>}</DialogDescription>
  {error&&<p role="alert" className="text-sm text-red-700"><L text={error}/> <button className="underline" onClick={()=>void reload()}><L id="settings.retry_profile"/></button></p>}
  {profile?<ProfileEditor profile={profile} user={user} onSaved={onSaved} reload={reload} onboarding={onboarding} onDone={()=>onOpenChange(false)} disabled={securityBusy} onBusy={setProfileBusy}/>:!error&&<p role="status"><L id="account.loading_your_profile"/></p>}
  {!onboarding&&<AccountSecurity user={user} disabled={profileBusy} onBusy={setSecurityBusy}/>}
  {children}
 </Content></Portal></Dialog>;
}
function ProfileEditor({profile,user,onSaved,reload,onboarding,onDone,disabled,onBusy}:{profile:AccountProfile;user:User;onSaved:(value:AccountProfile)=>void;reload:()=>Promise<void>;onboarding:boolean;onDone:()=>void;disabled:boolean;onBusy:(busy:boolean)=>void}){
 const parts=(user.displayName??'').trim().split(/\s+/);const [first,setFirst]=useState(profile.first_name||parts[0]||''),[last,setLast]=useState(profile.last_name||parts.slice(1).join(' ')),[file,setFile]=useState<File|null>(null),[remove,setRemove]=useState(false),[useProvider,setUseProvider]=useState(onboarding&&!profile.avatar_id&&!!providerPhoto(user.photoURL)),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const current=useRef(profile),operation=useRef(false); // Keep the edit base fixed; background avatar refresh must not silently rebase stale edits.
 useEffect(()=>{let active=true;if(onboarding)void readAccountDraft(user.uid).then(draft=>{if(!active||!draft)return;setFirst(draft.firstName);setLast(draft.lastName);if(draft.photo)setFile(new File([draft.photo],'profile',{type:draft.photo.type}));setUseProvider(draft.source==='provider'&&!draft.photo&&!!providerPhoto(user.photoURL));}).catch(()=>{if(active)setError('Your saved draft is unavailable. Enter your profile details again.');});return()=>{active=false;};},[user.uid,user.photoURL,onboarding]);
 const field='mt-1 w-full rounded-xl border-2 border-black bg-white p-3 text-sm';
 return <form className="space-y-5" onSubmit={async e=>{e.preventDefault();if(operation.current||disabled)return;operation.current=true;setBusy(true);onBusy(true);setError('');setMessage('');try{
  const values=accountNames.parse({firstName:first,lastName:last});let saved=await accountRequest('save',current.current.revision,{...values,completeOnboarding:false});current.current=saved;onSaved(saved);
  if(file){saved=await uploadAccountAvatar(file,saved.revision);setFile(null);}
  else if(remove&&saved.avatar_id)saved=await accountRequest('remove-avatar',saved.revision);
  else if(useProvider&&!saved.avatar_id)saved=await accountRequest('provider-avatar',saved.revision);
  current.current=saved;onSaved(saved);setRemove(false);setUseProvider(false);
  if(onboarding){saved=await accountRequest('save',saved.revision,{...values,completeOnboarding:true});current.current=saved;onSaved(saved);try{await clearAccountDraft(user.uid);}catch{}onDone();}
  setMessage(saved.cleanupPending?'Profile saved. An old photo still needs cleanup; use Retry photo cleanup.':'Profile saved.');
 }catch(e){setError((e as {status?:number}).status===409?'Your profile changed. Reload the latest profile before retrying.':'The complete profile update did not finish. Your saved names or photo may already be updated. '+(e as Error).message);}finally{operation.current=false;setBusy(false);onBusy(false);}}}>
  <fieldset disabled={busy||disabled} className="space-y-5"><AvatarPicker hasPhoto={!!profile.avatar_id&&!remove} file={file} url={remove?null:profile.avatarUrl||(useProvider?providerPhoto(user.photoURL):null)} onChange={value=>{setFile(value);setRemove(!value);setUseProvider(false);setMessage('');}}/>
  <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold"><L id="account.first_name"/><input required maxLength={60} autoComplete="given-name" className={field} value={first} onChange={e=>setFirst(e.target.value)}/></label><label className="text-sm font-semibold"><L id="account.last_name"/><input required maxLength={60} autoComplete="family-name" className={field} value={last} onChange={e=>setLast(e.target.value)}/></label></div>
  <div className="flex flex-wrap gap-3"><button className="rounded-xl border-2 border-black bg-primary px-5 py-3 text-sm font-bold shadow-hard-sm">{busy?<L id="account.saving"/>:onboarding?<L id="account.confirmProfile"/>:<L id="account.saveProfile"/>}</button><button type="button" className="rounded-xl border-2 border-black px-4 py-2 text-sm font-semibold" onClick={onDone}>{onboarding?<L id="account.finishLater"/>:<L id="account.cancelClose"/>}</button></div></fieldset>
  {profile.avatarError&&<p role="alert" className="text-sm text-amber-800">{profile.avatarError}</p>}
  {message&&<p role="status" className="text-sm text-emerald-800"><L text={message}/></p>}{error&&<p role="alert" className="text-sm text-red-700"><L text={error}/> <button type="button" className="underline" onClick={()=>void reload().then(onDone)}><L id="account.reload_and_close"/></button></p>}
  {<button type="button" disabled={busy} className="text-sm underline" onClick={async()=>{try{const value=await accountRequest('cleanup');onSaved(value);setMessage(value.cleanupPending?'Photo cleanup is still pending.':'Old photo cleanup completed.');}catch(e){setError((e as Error).message);}}}>{profile.cleanupPending?<L id="account.retryCleanup"/>:<L id="account.cleanup"/>}</button>}
 </form>;
}
