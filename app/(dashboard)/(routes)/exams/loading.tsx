import { Localized } from '@/frontend/components/language-provider';
export default function ExamsLoading() {
	return (
		<Localized as="div" labels={{"aria-label":"exams.loading_exams"}} className="mx-auto w-full max-w-5xl space-y-6 pb-12" role="status">
			<div className="h-24 animate-pulse rounded-3xl border-2 border-black bg-slate-100" />
			<div className="grid gap-4 md:grid-cols-2">
				{[0, 1, 2, 3].map((i) => (
					<div key={i} className="h-36 animate-pulse rounded-2xl border-2 border-slate-200 bg-slate-100" />
				))}
			</div>
		</Localized>
	);
}
