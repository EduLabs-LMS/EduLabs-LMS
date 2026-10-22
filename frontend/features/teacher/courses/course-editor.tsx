'use client';
import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { CourseStages } from '@/frontend/features/teacher/academics/course-stages';
import { LearningTreeEditor } from '@/frontend/features/teacher/chapters/editor/learning-editor';
import type { LearningTree } from '@/shared/contracts/lessons';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutDashboard, ListChecks, ShieldCheck } from 'lucide-react';
import { IconBadge } from '@/frontend/components/icon-badge';
import Banner from '@/frontend/components/banner';
import TitleForm from './editor/title-form';
import DescriptionForm from './editor/description-form';
import ChapterNamingForm from './editor/chapter-naming-form';
import ImageForm from './editor/image-form';
import ChaptersForm from './editor/chapters-form';
import Actions from './editor/actions';
import { Input } from '@/frontend/components/ui/input';
import { Button } from '@/frontend/components/ui/button';
import { CapabilityGate } from '@/frontend/components/capability-gate';
type Record = {id:string;organization_id:string;title:string;description:string|null;slug:string;status:string;visibility:string;updated_at:string};
export function V2TeacherCourseEditor({record,tree}:{record:Record;tree:LearningTree}) {
	const courseBase = useCourseManagementPath();
 const [busy,setBusy]=useState(false);
 const course={...record,isPublished:record.status==='published'};
 const completionText='Course metadata';
 async function save(fields: {title?:string;description?:string;status?:string;slug?:string;visibility?:string}) {
   if(busy) throw new Error('Wait for the current save to finish.');
   setBusy(true);
   try {
     const response=await fetch('/api/teacher/courses/'+record.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,updated_at:record.updated_at})});
     const result=await response.json();
     if(!response.ok)throw new Error(result.error||'Unable to save course');
   } finally {setBusy(false)}
 }
	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pt-2 pb-16">
			{/* Back Link */}
			<Link
				href={courseBase}
				className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
			>
				<ArrowLeft className="h-4 w-4 mr-1.5" />
				Back to All Lessons
			</Link>

			{/* Unpublished Warning Banner */}
			{!course.isPublished && (
				<Banner
					variant="warning"
					label="This lesson is unpublished. It will not be visible to students in the curriculum."
				/>
			)}

			{/* Top Header Card */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Lesson Editor
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						{course.title || 'Lesson Setup'}
					</h1>
					<p className="text-xs sm:text-sm text-slate-500">
						{completionText} · Required: Lesson Title, Chapter Number, and at least one published segment.
					</p>
				</div>

				<Actions
					disabled={busy}
					courseId={course.id}
					isPublished={course.isPublished}
 allowDelete={false} onPublishChange={value=>save({status:value?"published":"draft"})}
				/>
			</div>

			{/* 2-Column Light Theme Cards */}
            <CourseStages courseId={course.id} organizationId={course.organization_id}/>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left Card: Customize Lesson */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={LayoutDashboard} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Customize your lesson
							</h2>
							<p className="text-xs text-slate-500">
								Configure basic metadata and chapter grouping
							</p>
						</div>
					</div>

					<div className="space-y-4">
						<TitleForm initialData={course} courseId={course.id} onSave={save} />
						<p className="text-xs text-slate-500">Choose chapters, units or weeks in each curriculum group below.</p>
<CourseMetadata course={record} save={save} busy={busy}/>
						<DescriptionForm initialData={course} courseId={course.id} onSave={save} />
						<CapabilityGate reason="Course cover uploads require a Storage/media adapter."><ImageForm initialData={{imageUrl:null}} courseId={course.id} /></CapabilityGate>
					</div>
				</div>

				{/* Right Card: Lesson Segments */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={ListChecks} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Lesson segments
							</h2>
							<p className="text-xs text-slate-500">
								Add video explanations, notes, and homework assignments
							</p>
						</div>
					</div>

					<LearningTreeEditor courseId={course.id} tree={tree}/>
				</div>
			</div>
		</div>
	);
};



function CourseMetadata({course,save,busy}:{course:Record;save:(fields:{slug:string;visibility:string;status:string})=>Promise<void>;busy:boolean}) {
 const [slug,setSlug]=useState(course.slug),[visibility,setVisibility]=useState(course.visibility),[status,setStatus]=useState(course.status),[error,setError]=useState('');
 const router=useRouter();
 return <form className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3" onSubmit={async event=>{event.preventDefault();setError('');try{await save({slug,visibility,status});router.refresh()}catch(e){setError(e instanceof Error?e.message:'Unable to save')}}}>
 <label className="block text-sm">Slug<Input required value={slug} maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={busy} onChange={e=>setSlug(e.target.value)}/></label>
 <label className="block text-sm">Visibility<select aria-label="Course visibility" className="ml-3 rounded-md border p-2" disabled={busy} value={visibility} onChange={e=>setVisibility(e.target.value)}>{['private','unlisted','public'].map(v=><option key={v}>{v}</option>)}</select></label>
 <label className="block text-sm">Status<select aria-label="Course status" className="ml-3 rounded-md border p-2" disabled={busy} value={status} onChange={e=>setStatus(e.target.value)}>{['draft','published','archived'].map(v=><option key={v}>{v}</option>)}</select></label>
 {error&&<p role="alert" className="text-red-700">{error}</p>}<Button disabled={busy}>Save metadata</Button></form>;
}
