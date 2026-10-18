import { redirect,notFound } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import { isFirebaseStaging } from '@/shared/auth-config';
import { StudentAccess } from '@/frontend/features/admin/users/student-access';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function JoinPage({params}:{params:Promise<{token:string}>}){const {token}=await params;if(!isFirebaseStaging()||!/^[A-Za-z0-9_-]{43}$/.test(token))notFound();const viewer=await getApplicationViewer();if(!viewer)redirect('/sign-in?next='+encodeURIComponent('/join/'+token));return <main className="min-h-screen bg-slate-50 p-4 pt-12"><StudentAccess token={token}/></main>;}
