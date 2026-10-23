'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, PlusCircle } from 'lucide-react';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { Chip, EmptyState, FilterPills, PageHeader, SearchField, buttonClass, fieldClass, primaryButtonClass } from '@/frontend/components/page-kit';
import type { CourseListRow } from '@/frontend/features/teacher/courses/list/columns';
import { cn } from '@/shared/utils';

type Status = 'all' | 'published' | 'draft';
type Sort = 'name' | 'published';
export { type CourseListRow };

export const V2TeacherCourseList = ({ courses }: { courses: CourseListRow[] }) => {
	const [query, setQuery] = useState(''), [status, setStatus] = useState<Status>('all'), [sort, setSort] = useState<Sort>('name');
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = courses.filter(c => (status === 'all' || (status === 'published') === c.isPublished) && (!q || c.title.toLowerCase().includes(q)));
		return [...list].sort((a, b) => (sort === 'published' ? Number(b.isPublished) - Number(a.isPublished) : 0) || a.title.localeCompare(b.title));
	}, [courses, query, status, sort]);
	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pb-16 pt-2">
			<PageHeader
				icon={<BookOpen aria-hidden className="h-7 w-7" />}
				title="Lesson Management"
				subtitle="Organize, edit, and publish your curriculum lessons and chapters."
				actions={<>
					<Link className={buttonClass} href="/teacher/programs">Academic programs</Link>
					<Link className={buttonClass} href="/teacher/website">Website studio</Link>
					<Link className={primaryButtonClass} href="/teacher/create"><PlusCircle aria-hidden className="h-4 w-4" />New Lesson</Link>
				</>}
			/>
			{courses.length > 0 && (
				<div className="flex flex-wrap items-center gap-3">
					<SearchField value={query} onChange={setQuery} label="Search lessons" placeholder="Search by title…" />
					<FilterPills<Status> label="Show" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }]} />
					<label className="ms-auto flex items-center gap-2 text-sm font-semibold">Sort by<Dropdown className={cn(fieldClass, '!w-auto')} value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="name">Name</option><option value="published">Published first</option></Dropdown></label>
				</div>
			)}
			{courses.length === 0 ? (
				<EmptyState icon={<BookOpen className="h-8 w-8" />} title="No lessons yet" note="Create your first lesson to start building your curriculum." action={<Link className={primaryButtonClass} href="/teacher/create"><PlusCircle aria-hidden className="h-4 w-4" />New Lesson</Link>} />
			) : shown.length === 0 ? (
				<EmptyState title="No lessons match your search or filter." action={<button type="button" className={buttonClass} onClick={() => { setQuery(''); setStatus('all'); }}>Clear search and filter</button>} />
			) : (
				<ul className="m-list grid gap-3 md:grid-cols-2">
					{shown.map(c => (
						<li key={c.id}>
							<Link href={`/self-learning/${c.id}`} className="flex items-center gap-4 rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm transition-transform duration-200 hover:-translate-y-px">
								<span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-black bg-primary font-bold">{(Array.from(c.title.trim())[0] ?? '?').toUpperCase()}</span>
								<span className="min-w-0 flex-1"><span className="block break-words font-display text-xl"><bdi dir="auto">{c.title}</bdi></span><span className="mt-1 flex items-center gap-2"><Chip tone={c.isPublished ? 'good' : 'warn'}>{c.isPublished ? 'Published' : 'Draft'}</Chip><span className="text-xs font-semibold text-slate-700">Edit</span></span></span>
								<ChevronRight aria-hidden className="h-5 w-5 shrink-0 rtl:rotate-180" />
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
