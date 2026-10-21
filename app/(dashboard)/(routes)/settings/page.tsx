import { L } from '@/frontend/components/language-provider';
import { redirect } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import DashboardForm from '@/frontend/features/personalization/dashboard-form';
export const metadata={title:'Settings | EduLabs',robots:{index:false,follow:false}};
export default async function SettingsPage(){
 const viewer=await getApplicationViewer();if(!viewer)redirect('/sign-in');
 return <div className="mx-auto max-w-4xl space-y-6 pb-10"><header className="rounded-3xl border-2 border-black bg-primary p-5 shadow-hard sm:p-6"><h1 className="font-display text-3xl"><L id="navigation.settings"/></h1><p className="mt-2 text-sm"><L id="common.manage_your_profile_and_account"/></p></header><DashboardForm/></div>;
}
