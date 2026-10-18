'use client';

import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Layers, LockKeyhole, PlayCircle } from 'lucide-react';

import { formatChapterLabel } from '@/shared/chapter-label';
import { cn } from '@/shared/utils';

export type LessonCardStatus = 'Completed' | 'In Progress' | 'Open Lesson' | 'Not Started' | 'Locked';

/** One rule for both the dashboard and the self-learning page. */
export const getLessonCardStatus = (parts: { isCompleted: boolean }[]): LessonCardStatus => {
	if (parts.length === 0) return 'Locked';
	if (parts.every((part) => part.isCompleted)) return 'Completed';
	if (parts.some((part) => part.isCompleted)) return 'In Progress';
	return 'Open Lesson';
};

interface LessonCardProps {
	/** Link target. Omit when the lesson has no parts yet. */
	href?: string;
	chapterType: string;
	chapterNumber: number | null;
	/** Lesson number inside its chapter (restarts at 1 in every chapter). */
	lessonNumber: number;
	title: string;
	description?: string | null;
	imageUrl?: string | null;
	partsCount: number | null;
	status: LessonCardStatus;
	className?: string;
}

/**
 * Standard lesson card.
 *   Top:    "Chapter X • Lesson Y"
 *   Title, optional description
 *   Bottom: "X parts" on the left, status/action on the right
 * With an image the picture fills the card under a dark gradient so the white text stays readable.
 */
export const LessonCard = ({
	href,
	chapterType,
	chapterNumber,
	lessonNumber,
	title,
	description,
	imageUrl,
	partsCount,
	status,
	className,
}: LessonCardProps) => {
	const [failedImage, setFailedImage] = useState<string|null>(null);
 const refreshed=useRef(false),router=useRouter();
	const hasImage = Boolean(imageUrl) && failedImage !== imageUrl;
	const text = description?.trim();

	const statusStyle: Record<LessonCardStatus, string> = {
		Completed: 'bg-emerald-100 text-emerald-800',
		'In Progress': 'bg-sky-100 text-sky-800',
		'Open Lesson': 'bg-slate-900 text-white',
  'Not Started': 'bg-slate-900 text-white',
		Locked: 'bg-slate-100 text-slate-500',
	};
	const StatusIcon =
		status === 'Completed' ? CheckCircle2 : status === 'Locked' ? LockKeyhole : PlayCircle;

	const body = (
		<article
			className={cn(
				'group relative isolate flex h-full min-h-[200px] flex-col overflow-hidden rounded-2xl border-2 border-black p-5 shadow-hard-sm transition-all duration-200 ease-out',
				hasImage ? 'bg-slate-900 text-white' : 'bg-white text-slate-950',
				href && 'hover:-translate-x-px hover:-translate-y-px hover:shadow-hard active:translate-x-0.5 active:translate-y-0.5',
				className
			)}
		>
			{hasImage && (
				<>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={imageUrl as string}
						alt=""
						referrerPolicy="no-referrer"
						draggable={false}
						onError={() => { setFailedImage(imageUrl??null); if(!refreshed.current){refreshed.current=true;router.refresh();} }}
						className="absolute inset-0 -z-20 h-full w-full object-cover"
					/>
					<div
						aria-hidden="true"
						className="absolute inset-0 -z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-slate-950/45"
					/>
				</>
			)}

			<p
				className={cn(
					'text-xs font-bold uppercase tracking-[0.14em]',
					hasImage ? 'text-sky-200' : 'text-sky-700'
				)}
			>
				{formatChapterLabel(chapterType, chapterNumber)} • Lesson {lessonNumber}
			</p>

			<h3 className={cn('mt-3 line-clamp-2 text-lg font-bold leading-snug', hasImage && 'drop-shadow-sm')}>
				{title}
			</h3>

			{text && (
				<p className={cn('mt-1.5 line-clamp-2 text-sm leading-relaxed', hasImage ? 'text-slate-200' : 'text-slate-600')}>
					{text}
				</p>
			)}

			<div
				className={cn(
					'mt-auto flex items-center justify-between gap-3 border-t pt-3',
					hasImage ? 'border-white/25' : 'border-slate-200'
				)}
			>
				{partsCount !== null && <span
					className={cn(
						'inline-flex items-center gap-1.5 text-xs font-medium',
						hasImage ? 'text-slate-200' : 'text-slate-500'
					)}
				>
					<Layers className="h-3.5 w-3.5" aria-hidden="true" />
					{partsCount} {partsCount === 1 ? 'part' : 'parts'}
				</span>}
				<span
					className={cn(
						'inline-flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 text-xs font-bold',
						statusStyle[status]
					)}
				>
					<StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
					{status}
				</span>
			</div>
		</article>
	);

	return href ? (
		<Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 rounded-2xl">
			{body}
		</Link>
	) : (
		body
	);
};
