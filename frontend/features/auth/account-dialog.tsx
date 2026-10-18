'use client';
import { useEffect,useRef,useState } from 'react';
import type { User } from 'firebase/auth';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/frontend/components/ui/dialog';
import { AvatarPicker } from './avatar-picker';
import { accountNames,providerPhoto } from '@/shared/contracts/account';
import type { AccountProfile } from '@/shared/contracts/account';
import { accountRequest,uploadAccountAvatar } from '@/frontend/lib/account';
import { readAccountDraft,clearAccountDraft } from '@/frontend/lib/account-draft';

export function AccountDialog({open,onOpenChange,profile,user,onSaved,reload,error,onboarding=false,children}:{open:boolean;onOpenChange:(open:boolean)=>void;profile:AccountProfile|null;user:User;onSaved:(profile:AccountProfile)=>void;reload:()=>Promise<void>;error:string;onboarding?:boolean;children?:React.ReactNode}){
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto p-5 sm:p-8"><DialogTitle className="pr-6 font-display text-2xl">{onboarding?'Make yourself at home':'Your EduLabs account'}</DialogTitle><DialogDescription>{onboarding?'Confirm your profile to finish setup. Your teacher still controls course access.':'One account across your teachers. Profile changes never change your course access.'}</DialogDescription>
  {error&&<p role="alert" className="text-sm text-red-700">{error} <button className="underline" onClick={()=>void reload()}>Retry profile</button></p>}
  {profile?<ProfileEditor profile={profile} user={user} onSaved={onSaved} reload={reload} onboarding={onboarding} onDone={()=>onOpenChange(false)}/>:!error&&<p role="status">Loading your profile…</p>}
  {children}
 </DialogContent></Dialog>;
}
function ProfileEditor({profile,user,onSaved,reload,onboarding,onDone}:{profile:AccountProfile;user:User;onSaved:(value:AccountProfile)=>void;reload:()=>Promise<void>;onboarding:boolean;onDone:()=>void}){
 const parts=(user.displayName??'').trim().split(/\s+/);const [first,setFirst]=useState(profile.first_name||parts[0]||''),[last,setLast]=useState(profile.last_name||parts.slice(1).join(' ')),[file,setFile]=useState<File|null>(null),[remove,setRemove]=useState(false),[useProvider,setUseProvider]=useState(onboarding&&!profile.avatar_id&&!!providerPhoto(user.photoURL)),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const current=useRef(profile),operation=useRef(false);useEffect(()=>{current.current=profile;},[profile]);
 useEffect(()=>{let active=true;if(onboarding)void readAccountDraft(user.uid).then(draft=>{if(!active||!draft)return;setFirst(draft.firstName);setLast(draft.lastName);if(draft.photo)setFile(new File([draft.photo],'profile',{type:draft.photo.type}));setUseProvider(false);}).catch(()=>{if(active)setError('Your saved draft is unavailable. Enter your profile details again.');});return()=>{active=false;};},[user.uid,onboarding]);
 const field='mt-1 w-full rounded-xl border-2 border-black bg-white p-3 text-sm';
 return <form className="space-y-5" onSubmit={async e=>{e.preventDefault();if(operation.current)return;operation.current=true;setBusy(true);setError('');setMessage('');try{
  const values=accountNames.parse({firstName:first,lastName:last});let saved=await accountRequest('save',current.current.revision,{...values,completeOnboarding:false});current.current=saved;onSaved(saved);
  if(file){saved=await uploadAccountAvatar(file,saved.revision);setFile(null);}
  else if(remove&&saved.avatar_id)saved=await accountRequest('remove-avatar',saved.revision);
  else if(useProvider&&!saved.avatar_id)saved=await accountRequest('provider-avatar',saved.revision);
  current.current=saved;onSaved(saved);setRemove(false);setUseProvider(false);
  if(onboarding){saved=await accountRequest('save',saved.revision,{...values,completeOnboarding:true});current.current=saved;onSaved(saved);try{await clearAccountDraft(user.uid);}catch{}onDone();}
  setMessage(saved.cleanupPending?'Profile saved. An old photo still needs cleanup; use Retry photo cleanup.':'Profile saved.');
 }catch(e){setError((e as {status?:number}).status===409?'Your profile changed. Reload the latest profile before retrying.':'The complete profile update did not finish. Your saved names or photo may already be updated. '+(e as Error).message);}finally{operation.current=false;setBusy(false);}}}>
  <fieldset disabled={busy} className="space-y-5"><AvatarPicker file={file} url={remove?null:profile.avatarUrl||(useProvider?providerPhoto(user.photoURL):null)} onChange={value=>{setFile(value);setRemove(!value);setUseProvider(false);setMessage('');}}/>
  <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">First name<input required maxLength={60} autoComplete="given-name" className={field} value={first} onChange={e=>setFirst(e.target.value)}/></label><label className="text-sm font-semibold">Last name<input required maxLength={60} autoComplete="family-name" className={field} value={last} onChange={e=>setLast(e.target.value)}/></label></div>
  <div className="flex flex-wrap gap-3"><button className="rounded-xl border-2 border-black bg-primary px-5 py-3 text-sm font-bold shadow-hard-sm">{busy?'Saving…':onboarding?'Confirm profile':'Save profile'}</button><button type="button" className="rounded-xl border-2 border-black px-4 py-2 text-sm font-semibold" onClick={onDone}>{onboarding?'Finish later':'Cancel / Close'}</button></div></fieldset>
  {message&&<p role="status" className="text-sm text-emerald-800">{message}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error} <button type="button" className="underline" onClick={()=>void reload()}>Reload profile</button></p>}
  {profile.cleanupPending&&<button type="button" disabled={busy} className="text-sm underline" onClick={async()=>{try{const value=await accountRequest('cleanup');onSaved(value);setMessage(value.cleanupPending?'Photo cleanup is still pending.':'Old photo cleanup completed.');}catch(e){setError((e as Error).message);}}}>Retry photo cleanup</button>}
 </form>;
}
