'use client';
import { createContext, useContext } from 'react';
import { useUser, useClerk, UserButton } from '@clerk/nextjs';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { FirebaseAccountBridge } from '@/frontend/features/auth/firebase-account-bridge';
import { isFirebaseStaging } from '@/shared/auth-config';
import type { WebsiteNavigation } from '@/shared/contracts/application-auth';

type User = { id: string; lastName: string | null; imageUrl: string | null; firstName: string | null; username: string | null; fullName: string | null; email: string | null; emailVerified?: boolean | null };
type State = { user: User | null; signOut: () => Promise<void>; openUserProfile: () => void; accountStatus?: { loading: boolean; error: string; reload?: () => Promise<void> } };
const AuthContext = createContext<State | null>(null);
const NavigationContext = createContext<WebsiteNavigation | null>(null);

function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { user,isLoaded } = useUser(); const clerk = useClerk();
  return <AuthContext.Provider value={{ user: user ? { id: user.id, lastName: user.lastName, imageUrl: user.imageUrl, firstName: user.firstName, username: user.username, fullName: user.fullName, email: user.primaryEmailAddress?.emailAddress || null, emailVerified:user.primaryEmailAddress?user.primaryEmailAddress.verification.status==='verified':null } : null,
    accountStatus:{loading:!isLoaded,error:''},
    openUserProfile: () => clerk.openUserProfile(), signOut: async () => { await clerk.signOut(); window.location.assign('/sign-in'); } }}>{children}</AuthContext.Provider>;
}
function FirebaseBridge({ children }: { children: React.ReactNode }) {
  const { user, logout } = useFirebaseAuth();
  return <FirebaseAccountBridge key={user?.uid??'signed-out'} provide={({profile,open,loading,error,reload})=><AuthContext.Provider value={{user:user?{id:user.uid,lastName:profile?.last_name||null,imageUrl:profile?.avatarUrl??null,firstName:profile?.first_name||user.displayName?.split(' ')[0]||null,username:null,fullName:[profile?.first_name,profile?.last_name].filter(name=>typeof name==='string'&&name.trim()).join(' ').trim().replace(/\s+/g,' ')||user.displayName?.trim().replace(/\s+/g,' ')||null,email:user.email,emailVerified:user.emailVerified}:null,accountStatus:{loading,error,reload},signOut:logout,openUserProfile:open}}>{children}</AuthContext.Provider>}/>;
}
export function ApplicationAuthProvider({ children }: { children: React.ReactNode }) {
  return isFirebaseStaging() ? <FirebaseBridge>{children}</FirebaseBridge> : <ClerkBridge>{children}</ClerkBridge>;
}
export function useApplicationAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('ApplicationAuthProvider required');
  return state;
}
export function WebsiteNavigationProvider({ value, children }: { value: WebsiteNavigation; children: React.ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
export const useWebsiteNavigation = () => useContext(NavigationContext);
export function ApplicationAvatar() {
  const { user,openUserProfile } = useApplicationAuth();
  return isFirebaseStaging() ? <button type="button" aria-label="Your account" onClick={openUserProfile} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-bold">{user?.imageUrl?<img alt="Your profile" src={user.imageUrl} className="h-full w-full rounded-full object-cover"/>:(user?.fullName || user?.email || 'L').slice(0, 1).toUpperCase()}</button> :
    <UserButton appearance={{ elements: { avatarBox: 'h-9 w-9 border-2 border-cyan-500 shadow-sm', userButtonPopoverCard: 'shadow-xl rounded-2xl border border-slate-200 z-[99999] pointer-events-auto', userButtonPopoverMain: 'z-[99999] pointer-events-auto' } }} />;
}
