import { cn } from '@/shared/utils';

interface AvatarProps {
	name: string;
	url: string | null;
	isAdmin?: boolean;
	className?: string;
}

/** Profile picture with a lettered fallback. Staff avatars get a distinct color. */
export const Avatar = ({ name, url, isAdmin = false, className }: AvatarProps) => {
	const initial = (name.trim()[0] ?? '?').toUpperCase();
	return url ? (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={url}
			alt={name}
			referrerPolicy="no-referrer"
			className={cn('h-11 w-11 shrink-0 rounded-full border-2 border-black object-cover', className)}
		/>
	) : (
		<span
			aria-label={name}
			className={cn(
				'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-black text-base font-bold',
				isAdmin ? 'bg-rose-200' : 'bg-primary',
				className
			)}
		>
			{initial}
		</span>
	);
};
