'use client';

import { UserButton as ClerkUserButton } from '@clerk/nextjs';
import toast from 'react-hot-toast';
import { isFirebaseStaging } from '@/shared/auth-config';
import { useApplicationAuth, useWebsiteNavigation } from './application-auth-provider';

/** Identity-only compatibility boundary. These hooks never infer authorization. */
export function useUser() {
  const { user } = useApplicationAuth();
  const navigation = useWebsiteNavigation();
  return { user: user ? { ...user, id: navigation?.viewer.id ?? user.id, primaryEmailAddress: { emailAddress: user.email } } : null };
}
export function useAuth() {
  const navigation = useWebsiteNavigation();
  const { user } = useApplicationAuth();
  return { userId: navigation?.viewer.id ?? user?.id ?? null };
}
export function useClerk() {
  const { signOut, openUserProfile } = useApplicationAuth();
  return { openUserProfile, signOut: async (_after?: unknown) => {
    try { await signOut(); }
    catch { toast.error('Sign-out could not be confirmed. Please retry.'); }
  } };
}
export function UserButton(props: React.ComponentProps<typeof ClerkUserButton>) {
 const { user,openUserProfile }=useApplicationAuth();
 if(!isFirebaseStaging())return <ClerkUserButton {...props}/>;
 return <button type="button" aria-label="Your account" onClick={openUserProfile} className="h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 border-black bg-primary shadow-hard-sm">{user?.imageUrl?<img alt="Your profile" src={user.imageUrl} className="h-full w-full object-cover"/>:(user?.fullName||user?.email||'L').slice(0,1).toUpperCase()}</button>;
}
