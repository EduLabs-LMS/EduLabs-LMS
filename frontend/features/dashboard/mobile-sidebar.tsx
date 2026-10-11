'use client';

import { isFirebaseStaging } from '@/shared/auth-config';
import { EduMobileSidebar } from '@/frontend/design/application-shell';
import { useState } from 'react';
import { Menu, BookOpen } from 'lucide-react';

import { Sheet, SheetContent, SheetTrigger } from '@/frontend/components/ui/sheet';
import Sidebar from '@/frontend/components/sidebar';

interface MobileSidebarProps {
	initialRole?: string | null;
}

const LegacyMobileSidebar = ({ initialRole }: MobileSidebarProps) => {
	const [open, setOpen] = useState(false);

	return (
		<div className="md:hidden sticky top-0 z-40 bg-slate-900 text-white px-4 py-3 border-b border-slate-800 flex items-center justify-between shadow-md">
		{/* Mobile Branding Logo */}
		<div className="flex items-center gap-2.5">
		<div className="bg-cyan-500/20 p-1.5 rounded-xl border border-cyan-400/30 shrink-0">
		<BookOpen className="h-5 w-5 text-cyan-400" />
		</div>
		<div className="flex flex-col">
		<span className="font-bold text-sm text-white leading-tight">
		LIFE OF PHYSICS
		</span>
		<span className="text-[10px] font-semibold text-cyan-400">
		3rd Secondary
		</span>
		</div>
		</div>

		{/* Sheet Trigger & Drawer Content */}
		<Sheet open={open} onOpenChange={setOpen}>
		<SheetTrigger
		aria-label="Open Navigation Menu"
		className="flex items-center justify-center p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors active:scale-95"
		>
		<Menu className="h-6 w-6" />
		</SheetTrigger>

		<SheetContent
		side="left"
		className="w-72 border-none bg-transparent p-0 shadow-none outline-none [&>button]:hidden"
		>
		<Sidebar
		initialRole={initialRole}
		className="static h-full w-full border border-slate-200/80 shadow-2xl rounded-3xl overflow-hidden"
		onNavigate={() => setOpen(false)}
		/>
		</SheetContent>
		</Sheet>
		</div>
	);
};

export const MobileSidebar = (props: MobileSidebarProps) => isFirebaseStaging() ? <EduMobileSidebar /> : <LegacyMobileSidebar {...props} />;
export default MobileSidebar;
