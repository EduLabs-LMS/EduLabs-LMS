'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';

export default function SelfLearningError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const { t } = useLanguage();

	useEffect(() => {
		// Log error client-side
		console.error('Self-learning error:', error);
	}, [error]);

	return (
		<div className="mx-auto w-full max-w-2xl pb-16 pt-8">
			<div className="rounded-3xl border-2 border-black bg-white p-6 shadow-hard sm:p-8">
				<div className="flex items-center gap-3">
					<span className="grid h-12 w-12 place-items-center rounded-2xl border-2 border-black bg-red-100 text-red-900" aria-hidden>
						<AlertCircle className="h-6 w-6" />
					</span>
					<div>
						<h1 className="font-display text-2xl font-bold text-slate-900">{t('teach.home.error')}</h1>
						<p className="mt-1 text-sm text-slate-700">{error.message || t('teach.home.error_body')}</p>
					</div>
				</div>
				<div className="mt-6 flex flex-wrap gap-3">
					<Button type="button" onClick={() => reset()} className="min-h-[44px]">
						<RefreshCw className="me-2 h-4 w-4" aria-hidden />
						{t('teach.home.error_retry')}
					</Button>
					<Button asChild variant="outline" className="min-h-[44px]">
						<Link href="/self-learning">{t('teach.home.error_back')}</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
