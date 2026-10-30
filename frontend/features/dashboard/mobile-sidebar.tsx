'use client';

import { Localized, useLanguage } from '@/frontend/components/language-provider';
import { useState } from 'react';
import { Menu } from 'lucide-react';

import { Sheet, SheetContent, SheetTrigger } from '@/frontend/components/ui/sheet';
import Sidebar from '@/frontend/components/sidebar';
import { BrandLogo } from '@/frontend/components/brand-logo';
import { useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { isFirebaseStaging } from '@/shared/auth-config';
import { showTeacherNav, teacherHomeHref } from '@/shared/teacher-home';

interface MobileSidebarProps {
	initialRole?: string | null;
}

export const MobileSidebar = ({ initialRole }: MobileSidebarProps) => {
	const { direction } = useLanguage();
	const navigation = useWebsiteNavigation();
	const teacherMode = showTeacherNav(isFirebaseStaging(), navigation?.staffOrganizationIds);
 const [open, setOpen] = useState(false);

	return (
		<div className="md:hidden sticky top-0 z-40 bg-white text-black px-4 py-3 border-b-[2.5px] border-black flex items-center justify-between">
		{/* Mobile Branding Logo */}
		<BrandLogo size="phone" href={teacherMode ? teacherHomeHref : undefined} />

		{/* Sheet Trigger & Drawer Content */}
		<div className="flex items-center gap-3">
		<Sheet open={open} onOpenChange={setOpen}>
		<Localized as={SheetTrigger} labels={{"aria-label":"navigation.open_navigation_menu"}}
		className="flex items-center justify-center p-2 rounded-full border-2 border-black bg-white text-black shadow-hard-sm hover:bg-primary transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
		>
		<Menu className="h-6 w-6" />
		</Localized>

		<SheetContent
		side={direction==='rtl'?'right':'left'}
		className="w-72 border-none bg-transparent p-0 shadow-none outline-none [&>button]:hidden"
		>
		<Sidebar
		initialRole={initialRole}
		className="static h-full w-full overflow-hidden"
		onNavigate={() => setOpen(false)}
		/>
		</SheetContent>
		</Sheet>
		</div>
		</div>
	);
};

export default MobileSidebar;
