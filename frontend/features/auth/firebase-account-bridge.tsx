'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { getFirebaseAuth } from '@/frontend/lib/firebase';
import { accountRequest } from '@/frontend/lib/account';
import { readAccountDraft } from '@/frontend/lib/account-draft';
import type { AccountProfile } from '@/shared/contracts/account';
import { AccountDialog } from './account-dialog';

type ScopedProfile = { uid: string; value: AccountProfile };
type ScopedError = { uid: string; value: string };
type ScopedDialog = { uid: string; open: boolean; onboarding: boolean };

/** Keep the auth page mounted while strictly isolating profile/dialog state by Firebase UID. */
export function FirebaseAccountBridge({provide}:{provide:(value:{profile:AccountProfile|null;open:()=>void})=>React.ReactNode}){
 const {user,loading,error:authError}=useFirebaseAuth();
 const router=useRouter();
 const [scopedProfile,setScopedProfile]=useState<ScopedProfile|null>(null);
 const [scopedError,setScopedError]=useState<ScopedError|null>(null);
 const [dialog,setDialog]=useState<ScopedDialog|null>(null);
 const uid=user?.uid??null;
 const profile=scopedProfile?.uid===uid?scopedProfile.value:null;
 const error=scopedError?.uid===uid?scopedError.value:'';
 const isOpen=!!uid&&dialog?.uid===uid&&dialog.open;
 const isOnboarding=!!uid&&dialog?.uid===uid&&dialog.onboarding;
 const external=user?.providerData.some(p=>['google.com','apple.com'].includes(p.providerId))??false;

 const remember=(id:string,value:AccountProfile)=>{
  setScopedProfile(previous=>previous?.uid!==id||value.revision>=previous.value.revision?{uid:id,value}:previous);
  setScopedError(previous=>previous?.uid===id?null:previous);
 };
 const reload=useCallback(async()=>{
  if(!uid)return;
  try {
   const value=await accountRequest('get');
   if(getFirebaseAuth().currentUser?.uid!==uid)return;
   setScopedProfile(previous=>previous?.uid!==uid||value.revision>=previous.value.revision?{uid,value}:previous);
   setScopedError(previous=>previous?.uid===uid?null:previous);
  } catch(e){
   if(getFirebaseAuth().currentUser?.uid===uid)setScopedError({uid,value:(e as Error).message});
  }
 },[uid]);

 useEffect(()=>{
  if(!uid||!user?.emailVerified||loading||authError)return;
  let active=true;
  void accountRequest('get').then(async value=>{
   if(!active||getFirebaseAuth().currentUser?.uid!==uid)return;
   setScopedProfile(previous=>previous?.uid!==uid||value.revision>=previous.value.revision?{uid,value}:previous);
   setScopedError(previous=>previous?.uid===uid?null:previous);
   const draft=await readAccountDraft(uid).catch(()=>null);
   if(active&&getFirebaseAuth().currentUser?.uid===uid&&!value.onboarding_completed_at&&(external||draft)){
    setDialog({uid,open:true,onboarding:true});
   }
  }).catch(e=>{
   if(active&&getFirebaseAuth().currentUser?.uid===uid)setScopedError({uid,value:(e as Error).message});
  });
  const timer=setInterval(()=>{if(active)void reload();},60000);
  return()=>{active=false;clearInterval(timer);};
 },[uid,user?.emailVerified,loading,authError,reload,external]);

 const saved=(value:AccountProfile)=>{if(!uid)return;remember(uid,value);router.refresh();};
 const open=()=>{if(!uid)return;setDialog({uid,open:true,onboarding:false});void reload();};
 return <>
  {provide({profile,open})}
  {user&&<AccountDialog key={uid} open={isOpen} onOpenChange={next=>setDialog(previous=>previous?.uid===uid?{...previous,open:next}:previous)}
   profile={profile} user={user} onSaved={saved} reload={reload} error={error} onboarding={isOnboarding}/>}
 </>;
}
