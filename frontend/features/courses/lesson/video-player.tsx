'use client';

import { cn } from '@/shared/utils';
import MuxPlayer from '@mux/mux-player-react';
import { api } from '@/frontend/lib/api';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';

interface VideoPlayerProps {
	chapterId: string;
	title: string;
	courseId: string;
	nextChapterId?: string;
	playbackId?: string;
	completeOnEnd: boolean;
	hasWatched: boolean;
	onProgressComplete?: () => void;
}

const VideoPlayer = ({
	chapterId,
	title,
	courseId,
	nextChapterId,
	playbackId,
	completeOnEnd,
	hasWatched,
	onProgressComplete,
}: VideoPlayerProps) => {
	const router = useRouter();
	const hasRecordedWatch = useRef(hasWatched);
	const [isCompletedState, setIsCompletedState] = useState(hasWatched);
	const [isReady, setIsReady] = useState(false);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

	// On Video Finished
	const onEnd = async () => {
		try {
			if (completeOnEnd) {
				await api.post('/api/progress/complete', {
					courseId,
					chapterId,
				});

				setIsCompletedState(true);
				toast.success('Segment complete!', { icon: '🎉' });
				router.refresh();

				if (nextChapterId) {
					router.push(`/courses/${courseId}/chapters/${nextChapterId}`);
				}
			}
		} catch (error) {
			console.error('[VIDEO_END_PROGRESS_ERROR]', error);
		}
	};

	// Automatic 50% Video Progress Tracking
	const onTimeUpdate = (event: any) => {
		if (hasRecordedWatch.current) return;

		const player = event.currentTarget;
		const duration = Number(player?.duration);
		const currentTime = Number(player?.currentTime);

		if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) {
			return;
		}

		const watchRatio = currentTime / duration;
		if (watchRatio < 0.5) return;

		// Lock ref so it only triggers once
		hasRecordedWatch.current = true;

		// Debounce call to prevent burst calls
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(async () => {
			try {
				await api.post('/api/progress/complete', {
					courseId,
					chapterId,
				});

				// Instantly update UI segment state and show checkmark badge
				setIsCompletedState(true);
				onProgressComplete?.();

				toast.success('Progress saved: 50% completed!', {
					icon: '✅',
					duration: 4000,
				});

				router.refresh();
			} catch (error) {
				hasRecordedWatch.current = false;
				console.error('[AUTO_50_PCT_PROGRESS_ERROR]', error);
			}
		}, 300);
	};

	return (
		<div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border-2 border-black shadow-hard-sm group">
			{!isReady && (
				<div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
					<Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
				</div>
			)}

			{/* Floating 50%+ Complete Checkmark Badge */}
			{isCompletedState && (
				<div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600/90 text-white text-xs font-semibold backdrop-blur-md shadow-lg border border-emerald-400/40 animate-in fade-in zoom-in duration-200">
					<CheckCircle2 className="h-4 w-4 text-emerald-200" />
					<span>Completed (50%+)</span>
				</div>
			)}

			<MuxPlayer
				title={title}
				className={cn(!isReady && 'hidden')}
				onCanPlay={() => setIsReady(true)}
				onEnded={onEnd}
				onTimeUpdate={onTimeUpdate}
				autoPlay={false}
				playbackId={playbackId}
			/>
		</div>
	);
};

export default VideoPlayer;
