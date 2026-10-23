import { L } from '@/frontend/components/language-provider';
import { redirect } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import { Settings as SettingsIcon } from 'lucide-react';
import { PageHeader } from '@/frontend/components/page-kit';
import DashboardForm from '@/frontend/features/personalization/dashboard-form';
export const metadata={title:'Settings | EduLabs',robots:{index:false,follow:false}};
export default async function SettingsPage(){
 const viewer=await getApplicationViewer();if(!viewer)redirect('/sign-in');
 return <div className="mx-auto max-w-4xl space-y-6 pb-10"><PageHeader icon={<SettingsIcon aria-hidden className="h-7 w-7"/>} title={<L id="navigation.settings"/>} subtitle={<L id="common.manage_your_profile_and_account"/>}/><DashboardForm/></div>;
}
