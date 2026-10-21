'use client';
import { useCallback,useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { accountRequest } from '@/frontend/lib/account';
import { readAccountDraft } from '@/frontend/lib/account-draft';
import type { AccountProfile } from '@/shared/contracts/account';
import { AccountDialog } from './account-dialog';

export function FirebaseAccountBridge({provide}:{provide:(value:{profile:AccountProfile|null;open:()=>void;loading:boolean;error:string;reload:()=>Promise<void>})=>React.ReactNode}){
 const {user,loading,error:authError}=useFirebaseAuth();const router=useRouter();const [profile,setProfile]=useState<AccountProfile|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[onboarding,setOnboarding]=useState(false);
 const [profileLoading,setProfileLoading]=useState(true);
 const external=user?.providerData.some(p=>['google.com','apple.com'].includes(p.providerId))??false;
 const reload=useCallback(async()=>{setProfileLoading(true);try{const value=await accountRequest('get');setProfile(previous=>!previous||value.revision>=previous.revision?value:previous);setError('');}catch(e){setError((e as Error).message);}finally{setProfileLoading(false);}},[]);
 useEffect(()=>{if(!user?.emailVerified||loading||authError)return;let active=true;const uid=user.uid;
  setProfileLoading(true);
  void accountRequest('get').then(async value=>{if(!active)return;setProfile(previous=>!previous||value.revision>=previous.revision?value:previous);const draft=await readAccountDraft(uid).catch(()=>null);if(active&&!value.onboarding_completed_at&&(external||draft)){setOnboarding(true);setOpen(true);}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setProfileLoading(false);});
  const timer=setInterval(()=>{if(active)void reload();},60000);return()=>{active=false;clearInterval(timer);};
 },[user?.uid,user?.emailVerified,loading,authError,reload,external]);
 const saved=(value:AccountProfile)=>{setProfile(value);router.refresh();};
 return <>{provide({profile,loading:loading||!!user?.emailVerified&&!authError&&profileLoading,error:authError||error,reload,open:()=>{setOnboarding(false);setOpen(true);void reload();}})}{user&&<AccountDialog key={user.uid} open={open} onOpenChange={setOpen} profile={profile} user={user} onSaved={saved} reload={reload} error={error} onboarding={onboarding}/>}</>;
}
