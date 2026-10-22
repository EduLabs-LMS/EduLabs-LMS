'use client';

import { L, Localized, useLanguage } from '@/frontend/components/language-provider';
import { useState } from 'react';
import { Menu } from 'lucide-react';

import { Sheet, SheetContent, SheetTrigger } from '@/frontend/components/ui/sheet';
import Sidebar from '@/frontend/components/sidebar';
import EduLabsMark from '@/frontend/components/edulabs-mark';

interface MobileSidebarProps {
	initialRole?: string | null;
	teacherSide?: boolean;
}

export const MobileSidebar = ({ initialRole, teacherSide }: MobileSidebarProps) => {
	const { direction } = useLanguage();
 const [open, setOpen] = useState(false);

	return (
		<div className="md:hidden sticky top-0 z-40 bg-white text-black px-4 py-3 border-b-[2.5px] border-black flex items-center justify-between">
		{/* Mobile Branding Logo */}
		<div className="flex items-center gap-2.5">
		<EduLabsMark className="h-9 w-9 shrink-0" />
		<div className="flex flex-col">
		<span className="text-2xl font-normal text-black leading-none" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
		EduLabs
		</span>
		<span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600"><L id="navigation.learning_platform"/></span>
		</div>
		</div>

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
		teacherSide={teacherSide}
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
