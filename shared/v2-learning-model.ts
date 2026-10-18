import type { SelfLearningChapter, StudentLesson } from '@/shared/contracts/dashboard';

type Scope = {
  courses: { id: string; title: string }[];
  modules: { id: string; course_id: string; title: string; position: number;group_type?:string }[];
  lessons: { id: string; module_id: string; title: string; status: string;cover_url?:string|null }[];
  offerings: { id: string; course_id: string; name: string }[];
  progress: { offering_id: string; lesson_id: string; status: string }[];
  segments?: {id:string;lesson_id:string;title:string;position:number;status:string;thumbnail_url?:string|null}[];
  segmentProgress?: {offering_id:string;segment_id:string;status:string}[];
};

/** V2 grouping keys must carry real IDs, never a shared module title/number. */
export function v2Chapters(scope: Scope, offeringId?: string): SelfLearningChapter[] {
  return scope.modules.map<SelfLearningChapter>((module, index) => ({
    id: `${offeringId ?? 'catalog'}:${module.id}`,
    type: module.group_type??'Module', number: index + 1, title: module.title, subtitle: '', description: '',
    lessonCount: scope.lessons.filter(l => l.module_id === module.id && l.status === 'published').length,
    progressAvailable: Boolean(offeringId),
    lessons: scope.lessons.filter(l => l.module_id === module.id && l.status === 'published').map(lesson => {
      const status = offeringId ? scope.progress.find(p => p.offering_id === offeringId && p.lesson_id === lesson.id)?.status : undefined;
      if(scope.segments){
        const parts=scope.segments.filter(s=>s.lesson_id===lesson.id&&s.status==='published').sort((a,b)=>a.position-b.position);
        const progress=scope.segmentProgress?.filter(p=>p.offering_id===offeringId)??[];
        const isComplete=(id:string)=>progress.some(p=>p.segment_id===id&&p.status==='completed');
        const next=parts.find(s=>progress.some(p=>p.segment_id===s.id&&p.status==='in_progress'))??parts.find(s=>!isComplete(s.id))??parts[0];
        const description=('description' in lesson&&typeof lesson.description==='string')?lesson.description.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim():null;
        return {id:lesson.id,title:lesson.title,chapterType:module.group_type??'Module',chapterNumber:index+1,description,imageUrl:lesson.cover_url??null,partsCount:parts.length,
          href:offeringId&&next?`/courses/${module.course_id}/chapters/${next.id}?offering=${offeringId}`:null,
          chapters:parts.map(s=>({id:s.id,title:s.title,isCompleted:isComplete(s.id)})),
          status:!parts.length?'Locked':parts.every(s=>isComplete(s.id))?'Completed':parts.some(s=>progress.some(p=>p.segment_id===s.id))?'In Progress':'Not Started'};
      }
      return { id: lesson.id, href: null, title: lesson.title, chapterType: 'Module', chapterNumber: index + 1,
        description: null, imageUrl: null, partsCount: null,
        // This is a progress projection, not an invented video/segment record.
        chapters: offeringId ? [{ id: lesson.id, title: lesson.title, isCompleted: status === 'completed' }] : [],
        status: status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In Progress' : 'Open Lesson',
      };
    }),
  })).filter(module => module.lessons.length > 0);
}

export function v2StudentLessons(scope: Scope): StudentLesson[] {
  return scope.offerings.flatMap(offering => v2Chapters({ ...scope,
    modules: scope.modules.filter(m => m.course_id === offering.course_id),
  }, offering.id).flatMap(module => module.lessons.map(lesson => ({ ...lesson,
    id: `${offering.id}:${lesson.id}`, groupKey: module.id,
    href: scope.segments?lesson.href:`/courses/${offering.course_id}?offering=${offering.id}`,
  }))));
}

/** Each card carries one actual offering, including when no filter was selected. */
export function v2OfferingChapters(scope:Scope,offeringId?:string):SelfLearningChapter[] {
 return scope.offerings.filter(o=>!offeringId||o.id===offeringId).flatMap(o=>v2Chapters({...scope,modules:scope.modules.filter(m=>m.course_id===o.course_id)},o.id).map(m=>({...m,subtitle:scope.offerings.filter(x=>x.course_id===o.course_id).length>1?o.name:m.subtitle})));
}
