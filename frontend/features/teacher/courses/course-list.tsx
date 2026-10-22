'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, Eye, GraduationCap, Globe, PlusCircle, Search } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import type { CourseListRow } from '@/frontend/features/teacher/courses/list/columns';
import { EmptyBlock, FOCUS, StatusPill, TeacherHeader } from '@/frontend/features/teacher/ui/teacher-ui';
import { PREVIEW_PATH, previewCourseHref } from '@/shared/student-preview';
import { cn } from '@/shared/utils';

const SEARCH_FROM = 7;

export const V2TeacherCourseList = ({ courses }: { courses: CourseListRow[] }) => {
	const { t, number } = useLanguage();
	const courseBase = useCourseManagementPath();
	const [query, setQuery] = useState('');
	const shown = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? courses.filter((c) => c.title.toLowerCase().includes(needle)) : courses;
	}, [courses, query]);
	const publishedCount = courses.filter((c) => c.isPublished).length;

	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 pb-16 pt-2">
			<TeacherHeader
				pill={t('teach.portal')}
				title={t('teach.home.title')}
				subtitle={courses.length ? t('teach.home.subtitle_count', { total: number(courses.length), published: number(publishedCount) }) : t('teach.home.subtitle')}
				actions={
					<Button asChild className="min-h-[48px] px-6 text-base">
						<Link href="/teacher/create">
							<PlusCircle className="me-2 h-5 w-5" aria-hidden />
							{t('teach.home.create')}
						</Link>
					</Button>
				}
			>
				<nav aria-label={t('teach.home.tools')} className="mt-4 flex flex-wrap gap-2 border-t border-slate-300 pt-4">
					<Button asChild variant="outline" className="min-h-[44px]">
						<Link data-student-preview-toggle href={PREVIEW_PATH}>
							<Eye aria-hidden className="me-2 h-4 w-4" />
							{t('navigation.view_as_student')}
						</Link>
					</Button>
					<Button asChild variant="outline" className="min-h-[44px]">
						<Link href="/teacher/programs">
							<GraduationCap aria-hidden className="me-2 h-4 w-4" />
							{t('teach.home.programs')}
						</Link>
					</Button>
					<Button asChild variant="outline" className="min-h-[44px]">
						<Link href="/teacher/website">
							<Globe aria-hidden className="me-2 h-4 w-4" />
							{t('teach.home.website')}
						</Link>
					</Button>
				</nav>
			</TeacherHeader>

			{courses.length === 0 ? (
				<section className="rounded-3xl border-2 border-black bg-white p-6 shadow-hard-sm sm:p-8">
					<EmptyBlock
						icon={<BookOpen className="h-6 w-6" />}
						title={t('teach.home.empty_title')}
						body={t('teach.home.empty_body')}
						action={
							<Button asChild className="min-h-[48px] px-6 text-base">
								<Link href="/teacher/create">
									<PlusCircle className="me-2 h-5 w-5" aria-hidden />
									{t('teach.home.create_first')}
								</Link>
							</Button>
						}
					/>
					<ol className="mx-auto mt-2 grid max-w-3xl gap-3 sm:grid-cols-3">
						{(['one', 'two', 'three'] as const).map((step, i) => (
							<li key={step} className="rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm">
								<span className="mb-2 grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-950" aria-hidden>
									{number(i + 1)}
								</span>
								<strong className="block">{t(`teach.home.step_${step}_title` as 'teach.home.step_one_title')}</strong>
								<span className="text-slate-800">{t(`teach.home.step_${step}_body` as 'teach.home.step_one_body')}</span>
							</li>
						))}
					</ol>
				</section>
			) : (
				<section aria-labelledby="your-courses" className="space-y-3">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<h2 id="your-courses" className="font-display text-2xl">
							{t('teach.home.list_title')}
						</h2>
						{courses.length >= SEARCH_FROM && (
							<label className="relative block sm:w-72">
								<span className="sr-only">{t('teach.home.search')}</span>
								<Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-600" aria-hidden />
								<Input dir="auto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('teach.home.search')} className="min-h-[44px] ps-9" />
							</label>
						)}
					</div>
					{shown.length === 0 && <p className="rounded-2xl border border-dashed border-slate-500 bg-white p-6 text-center text-sm text-slate-800">{t('teach.home.no_match')}</p>}
					<ul className="grid gap-3 sm:grid-cols-2">
						{shown.map((course) => (
							<li key={course.id} className="flex flex-col justify-between gap-4 rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm">
								<div className="min-w-0 space-y-2">
									<StatusPill published={Boolean(course.isPublished)} />
									<h3 dir="auto" className="font-display text-xl leading-snug [overflow-wrap:anywhere]">
										{course.title}
									</h3>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button asChild className="min-h-[44px] flex-1">
										<Link href={`${courseBase}/${course.id}`} aria-label={t('teach.home.open_named', { name: course.title })}>
											{t('teach.home.open')}
											<ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
										</Link>
									</Button>
									<Button asChild variant="outline" className="min-h-[44px]">
										<Link href={previewCourseHref(course.id)} aria-label={t('teach.preview_named', { name: course.title })} className={cn(FOCUS)}>
											<Eye className="h-4 w-4" aria-hidden />
											<span className="ms-2">{t('teach.preview')}</span>
										</Link>
									</Button>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
};
