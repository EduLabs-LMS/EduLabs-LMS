import { Localized } from '@/frontend/components/language-provider';

export default function SelfLearningLoading() {
	return (
		<Localized as="div" labels={{ 'aria-label': 'teach.home.loading' }} className="mx-auto w-full max-w-5xl space-y-6 pb-16 pt-2" role="status">
			<div className="rounded-3xl border-2 border-black bg-white p-6 shadow-hard-sm sm:p-8">
				<div className="h-6 w-32 animate-pulse rounded-full bg-slate-200" />
				<div className="mt-3 h-10 w-64 animate-pulse rounded-2xl bg-slate-200" />
				<div className="mt-2 h-4 w-80 animate-pulse rounded-xl bg-slate-100" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{[0, 1, 2, 3].map((i) => (
					<div key={i} className="h-36 animate-pulse rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm">
						<div className="h-5 w-20 rounded-full bg-slate-200" />
						<div className="mt-3 h-6 w-3/4 rounded-xl bg-slate-200" />
					</div>
				))}
			</div>
		</Localized>
	);
}
