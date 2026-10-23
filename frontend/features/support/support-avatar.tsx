import { User } from 'lucide-react';
import { cn } from '@/shared/utils';

/**
 * Round avatar. Only the signed-in user's own photo is ever available (account photos are private to their owner),
 * so everyone else gets the initial of their name, or a neutral person when the name is not known yet.
 */
export function SupportAvatar({ name, url, staff = false, className }: { name: string | null; url?: string | null; staff?: boolean; className?: string }) {
	const initial = name?.trim() ? Array.from(name.trim())[0]!.toUpperCase() : null;
	return url ? (
		// eslint-disable-next-line @next/next/no-img-element
		<img src={url} alt="" referrerPolicy="no-referrer" className={cn('h-11 w-11 shrink-0 rounded-full border-2 border-black object-cover', className)} />
	) : (
		<span aria-hidden className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-black text-base font-bold', staff ? 'bg-primary' : 'bg-white', className)}>
			{initial ?? <User className="h-5 w-5" />}
		</span>
	);
}
