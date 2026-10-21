'use client';

import { cn } from '@/shared/utils';
import { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarItemProps {
	icon: LucideIcon;
	label: string;
	href?: string;
	badge?: string;
}

const SidebarItem = ({ icon: Icon, label, href, badge }: SidebarItemProps) => {
	const pathname = usePathname();

	const isActive =
		href === '/home'
			? pathname === '/' || pathname === '/home'
			: !!href && (pathname === href || pathname?.startsWith(`${href}/`));

	const content = (
		<>
			<Icon
				size={20}
				className={cn('shrink-0 text-slate-500', isActive && 'text-sky-700')}
			/>
			<span className="flex-1">{label}</span>
			{badge && (
				<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
					{badge}
				</span>
			)}
		</>
	);

	const className = cn(
		'flex min-h-11 items-center gap-x-3 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors',
		href
			? 'hover:bg-slate-100 hover:text-slate-950'
			: 'cursor-default opacity-80',
		isActive && 'bg-sky-50 text-sky-700 hover:bg-sky-50 hover:text-sky-700'
	);

	if (!href) {
		return <div className={className}>{content}</div>;
	}

	return (
		<Link href={href} aria-current={isActive?'page':undefined} className={className}>
			{content}
		</Link>
	);
};

export default SidebarItem;
