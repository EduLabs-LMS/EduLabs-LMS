'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell,LogOut,ShieldCheck,User } from 'lucide-react';
import { AppearanceSettings } from './appearance-settings';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';

/** A discoverable entry to the existing identity-bound account editor. No duplicate account logic. */
export default function DashboardForm(){
 const {user,openUserProfile,signOut,accountStatus}=useApplicationAuth();
 const [failedImage,setFailedImage]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const button='rounded-xl border-2 border-black bg-primary px-5 py-3 text-sm font-bold shadow-hard-sm disabled:opacity-50';
 async function logout(){if(busy)return;setBusy(true);setError('');try{await signOut();}catch{setError('Sign-out could not be confirmed. Retry, or sign in again if you were signed out locally.');}finally{setBusy(false);}}
 return <div className="space-y-6">
  <section aria-label="Account and profile" className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6">
   <h2 className="flex items-center gap-2 font-display text-2xl"><User aria-hidden className="h-6 w-6"/>Account &amp; profile</h2>
   {accountStatus?.loading&&!user?<p role="status" className="mt-5">Loading your account…</p>:!user?<div className="mt-5"><p>Your account could not be loaded. Sign in again to manage your profile.</p><Link className="mt-3 inline-block underline" href="/sign-in">Sign in again</Link></div>:<>
    <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
     <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-black bg-primary/20">
      {user.imageUrl&&failedImage!==user.imageUrl?<Image unoptimized width={96} height={96} src={user.imageUrl} alt="Your profile photo" className="h-full w-full object-cover" onError={()=>setFailedImage(user.imageUrl)}/>:<User aria-label="No profile photo available" className="h-10 w-10"/>}
     </div>
     <dl className="min-w-0 space-y-3 text-sm"><div><dt className="text-slate-600">Display name</dt><dd className="break-words text-lg font-bold">{user.fullName?.trim()||'Name not set'}</dd></div><div><dt className="text-slate-600">Email address</dt><dd className="break-all font-semibold">{user.email||'Email not available'}</dd>{user.email&&<dd className="mt-1 text-xs text-slate-600">{user.emailVerified===true?'Email verified':user.emailVerified===false?'Email not verified':'Verification status unavailable'}</dd>}</div></dl>
    </div>
    {accountStatus?.loading&&<p role="status" className="mt-4 text-sm">Refreshing your profile…</p>}
    <p className="mt-5 text-sm text-slate-600">Manage your name, photo and sign-in security using your existing account editor. Email and password changes keep their verification and identity checks.</p>
    <button type="button" className={button+' mt-4'} onClick={openUserProfile} disabled={busy}>Manage account</button>
   </>}
   {accountStatus?.error&&<div role="alert" className="mt-4 text-sm text-red-800"><p>Your profile details could not be loaded. Please retry, or sign in again if the problem continues.</p>{accountStatus.reload&&<button type="button" className="mt-2 font-semibold underline" onClick={()=>void accountStatus.reload?.()}>Retry profile</button>}<Link href="/sign-in" className="ml-3 underline">Sign in again</Link></div>}
  </section>
  <AppearanceSettings/>
  <section aria-label="Notifications destination" className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6"><h2 className="flex items-center gap-2 font-display text-2xl"><Bell aria-hidden className="h-6 w-6"/>Notifications</h2><p className="mt-3 text-sm text-slate-600">View your notifications and manage event preferences and browser-push registration on the Notifications page.</p><Link href="/notifications" className={button+' mt-4 inline-block'}>Open Notifications</Link></section>
  {user&&<section aria-label="Session" className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6"><h2 className="flex items-center gap-2 font-display text-2xl"><ShieldCheck aria-hidden className="h-6 w-6"/>Your session</h2><p className="mt-3 text-sm text-slate-600">Sign out of EduLabs on this device.</p><button type="button" className={button.replace('bg-primary','bg-card')+' mt-4 inline-flex items-center gap-2'} onClick={()=>void logout()} disabled={busy}><LogOut aria-hidden className="h-4 w-4"/>{busy?'Signing out…':'Sign out'}</button>{error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}</section>}
 </div>;
}
