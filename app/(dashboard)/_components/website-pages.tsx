import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BookOpen, Users, ShieldCheck } from 'lucide-react';
import { StudentLearning } from '@/frontend/features/self-learning/student-learning';
import AdminHome from '@/frontend/features/dashboard/admin-home';
import CourseCard from '@/frontend/components/course-card';
import GroupRosterView from '@/frontend/features/groups/group-roster-view';
import { GroupWorkspace } from '@/frontend/features/groups/group-workspace';
import { groupService } from '@/server/services/groups';
import { getWebsiteContext, loadWebsiteScope, courseCapability, offeringCapability } from '@/server/services/website';
import { validRosterPage } from '@/shared/website-model';
import { SelfLearningView } from '@/frontend/features/self-learning/self-learning-view';
import OriginalCourseDetail from '@/frontend/features/courses/course-detail';
import { v2Chapters, v2StudentLessons,v2OfferingChapters } from '@/shared/v2-learning-model';
import { V2TeacherCourseList } from '@/frontend/features/teacher/courses/course-list';
import SearchInput from '@/frontend/components/search-input';
import { canEditTeacherCourse } from '@/shared/teacher-course';
import { studentAdministration } from '@/server/services/student-administration';
import type { AdminMetrics } from '@/shared/contracts/student-administration';

export type WebsiteSearch = { organization?: string; offering?: string; page?: string; title?: string };
const panel = 'rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function requireWebsiteContext() {
  const context = await getWebsiteContext();
  if (!context) redirect('/sign-in');
  return context;
}
async function scopeFor(search: WebsiteSearch, courseId?: string) {
  const context = await requireWebsiteContext();
  if (Object.values(search).some(v => v !== undefined && (typeof v !== 'string' || v.length > 200))) notFound();
  if ((search.organization && !uuid.test(search.organization)) || (courseId && !uuid.test(courseId))) notFound();
  const scope = await loadWebsiteScope(context, search.organization, courseId);
  if (!scope || (courseId && !scope.courses.length)) notFound();
  return { context, scope };
}
function LimitNotice({ limited }: { limited: boolean }) {
  return limited ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This overview shows at most 100 courses/offerings and 500 lessons. Narrow your organization or open an individual course. Progress totals are unavailable for truncated data.</p> : null;
}
function Offerings({ scope, hideEmpty = false }: { scope: NonNullable<Awaited<ReturnType<typeof loadWebsiteScope>>>; hideEmpty?: boolean }) {
  if (hideEmpty && !scope.limited && !scope.offerings.length) return null;
  return <section className={panel}><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 text-cyan-600" />Your Groups &amp; Offerings</h2>
    {!scope.offerings.length && <p className="text-sm text-slate-500">{scope.limited ? 'Offering data is incomplete. Open an individual course to check its groups.' : 'No accessible offerings yet. Your teacher will arrange your course enrollment.'}</p>}
    <div className="divide-y divide-slate-100">{scope.offerings.map(o => <Link className="flex flex-wrap justify-between gap-2 py-4 text-sm hover:text-sky-700" key={o.id} href={`/offerings/${o.id}`}><span className="font-semibold">{o.name}</span><span>{o.status} · {o.delivery_mode.replace('_', ' ')}{scope.enrollments.find(e => e.offering_id === o.id) ? ` · Your enrollment: ${scope.enrollments.find(e => e.offering_id === o.id)?.status}` : ''}</span></Link>)}</div>
  </section>;
}
function Assessments({ scope }: { scope: NonNullable<Awaited<ReturnType<typeof loadWebsiteScope>>> }) {
  const now = Date.now();
  const upcoming = scope.scheduled.filter(s => scope.assessments.some(a=>a.id===s.assessment_id&&['exam','quiz'].includes(a.type))&&(!s.closes_at || Date.parse(s.closes_at) > now));
  if (!scope.limited && !upcoming.length) return null;
  return <section className={panel}><h2 className="mb-3 text-xl font-bold">Available &amp; Upcoming Assessments</h2><p className="mb-4 text-xs text-slate-500">Published exams and quizzes for your accessible course offerings.</p>
    {!upcoming.length && <p className="text-sm text-slate-500">{scope.limited ? "Assessment data is incomplete; no empty summary can be determined." : "No upcoming published assessments."}</p>}
    {upcoming.map(s => <div className="border-t py-3 text-sm" key={s.id}><Link href={'/exams/'+s.id}><strong>{scope.assessments.find(a => a.id === s.assessment_id)?.title || 'Assessment'}</strong></Link><p>{scope.offerings.find(o => o.id === s.offering_id)?.name} · Opens {s.opens_at ? new Date(s.opens_at).toISOString() : 'any time'} · Closes {s.closes_at ? new Date(s.closes_at).toISOString() : 'without a deadline'}</p></div>)}
  </section>;
}
export async function WebsiteHome({ search = {} }: { search?: WebsiteSearch }) {
  const { context, scope } = await scopeFor(search);
  const supported = scope.offerings.filter(o => {
    const course = scope.courses.find(c => c.id === o.course_id);
    return course && offeringCapability(context, course, o.id);
  });
  const staff = scope.courses.some(c => courseCapability(context, c)) || supported.length > 0 || context.memberships.some(m => m.status === 'active' && ['owner', 'admin'].includes(m.role) && (!search.organization || search.organization === m.organization_id));

  return <div className="space-y-8"><LimitNotice limited={scope.limited} />
    {staff && <nav className="flex flex-wrap gap-4 text-sm text-sky-700" aria-label="Teaching tools">{context.memberships.some(m=>m.status==='active'&&['owner','admin','teacher'].includes(m.role))&&<Link href="/teacher/create">Create a course</Link>}<Link href="/teacher/programs">Academic programs</Link><Link href="/teacher/website">Website studio</Link></nav>}
    {staff ? <AdminHome phase1 adminName={context.viewer.displayName} metrics={await studentAdministration<AdminMetrics>('metrics',search.organization?{organizationId:search.organization}:{})} recentSignups={[]} recentSubmissions={[]} /> :
    <StudentLearning home organizationId={search.organization} limited={scope.limited} chapters={[]} offerings={scope.offerings} lessons={scope.limited ? [] : v2StudentLessons({ ...scope, offerings: scope.offerings.filter(o => scope.enrollments.some(e => e.offering_id === o.id && e.status === 'active' && (!e.expires_at || Date.parse(e.expires_at) > Date.now()) && (!e.enrolled_at || Date.parse(e.enrolled_at) <= Date.now()))) })} />}
    {scope.limited && <p className="text-sm text-slate-500">Open a course for its available lessons. Dashboard lesson progress is not calculated on partial data.</p>}
    {!staff&&<p className="text-sm text-slate-600">Need course access? Use your teacher&apos;s invitation link. <Link className="underline" href="/access">View your access requests</Link>.</p>}
    <Offerings scope={scope} hideEmpty /><Assessments scope={scope} />
  </div>;
}
export async function WebsiteCourses({ search = {}, teacher = false }: { search?: WebsiteSearch; teacher?: boolean }) {
  if (!teacher) {
    const { scope } = await scopeFor(search);
    if (search.offering && !scope.offerings.some(o => o.id === search.offering)) notFound();
    const enrolled=scope.offerings.filter(o=>scope.enrollments.some(e=>e.offering_id===o.id&&e.status==='active'&&(!e.expires_at||Date.parse(e.expires_at)>Date.now())&&(!e.enrolled_at||Date.parse(e.enrolled_at)<=Date.now())));
    return <><LimitNotice limited={scope.limited}/><StudentLearning organizationId={search.organization} limited={scope.limited} offerings={enrolled} lessons={[]} chapters={scope.limited ? [] : v2OfferingChapters({...scope,offerings:enrolled}, search.offering)}/><Offerings scope={scope} hideEmpty/></>;
  }
  const context = await requireWebsiteContext();
  if (Object.values(search).some(v => v !== undefined && (typeof v !== 'string' || v.length > 200)) || (search.organization && !context.organizations.some(o => o.id === search.organization))) notFound();
  let page: number; try { page = validRosterPage(search.page); } catch { notFound(); }
  const rows = await context.repository.courses(search.organization, page, search.title);
  const courses = rows.slice(0, 100);
  const [modules, offerings] = await Promise.all([context.repository.modules(courses.map(c => c.id)), context.repository.offerings(courses.map(c => c.id))]);
  const visible = courses.filter(c => !teacher || courseCapability(context, c) || offerings.some(o => o.course_id === c.id && offeringCapability(context, c, o.id)));
  const pageUrl = (value: number) => '/teacher/courses?'+new URLSearchParams({page:String(value),...(search.organization?{organization:search.organization}:{}),...(search.title?{title:search.title}:{})});
  return <><V2TeacherCourseList courses={visible.filter(c => canEditTeacherCourse(context.memberships.find(m=>m.organization_id===c.organization_id)??null, context.courseStaff.find(s=>s.course_id===c.id)??null)).map(c => ({id:c.id,title:c.title,isPublished:c.status==='published'}))}/><nav aria-label="Course pages" className="flex gap-6 text-sm text-sky-700">{page>0&&<Link href={pageUrl(page-1)}>Previous</Link>}{rows.length>100&&<Link href={pageUrl(page+1)}>Next</Link>}</nav></>;
}
export async function WebsiteSearchCourses({search={}}:{search?:WebsiteSearch}) {
 const context=await requireWebsiteContext();
 if(Object.values(search).some(v=>v!==undefined&&(typeof v!=='string'||v.length>200))||(search.organization&&!context.organizations.some(o=>o.id===search.organization)))notFound();
 let page:number;try{page=validRosterPage(search.page)}catch{notFound()}
 const rows=await context.repository.courses(search.organization,page,search.title),courses=rows.slice(0,100);
 const modules=await context.repository.modules(courses.map(c=>c.id));
 return <><div className="px-6 pt-6 block md:hidden md:mb-0"><SearchInput/></div><div className="p-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.map(c=><CourseCard key={c.id} id={c.id} title={c.title} category={context.organizations.find(o=>o.id===c.organization_id)?.name} chaptersLength={modules.filter(m=>m.course_id===c.id).length}/>)}</div><p role="status">Search is limited to your authorized courses. Categories are awaiting a backend adapter.</p>{rows.length>100&&<Link href={'/search?'+new URLSearchParams({page:String(page+1),...(search.title?{title:search.title}:{})})}>Next</Link>}</div></>;
}

export async function WebsiteCourse({ courseId, search = {} }: { courseId: string; search?: WebsiteSearch }) {
  const { context, scope } = await scopeFor(search, courseId);
  const course = scope.courses[0];
  if (search.offering && !scope.offerings.some(o => o.id === search.offering)) notFound();
  const offering = scope.offerings.find(o => o.id === search.offering) ?? scope.offerings.find(o=>scope.enrollments.some(e=>e.offering_id===o.id&&e.status==='active'));
  return <div className="space-y-6"><OriginalCourseDetail initialCourse={course}/><LimitNotice limited={scope.limited}/><Offerings scope={scope}/><SelfLearningView chapters={scope.limited ? [] : v2Chapters(scope, offering?.id)}/><p role="status">Choose a lesson to study its parts, resources and assigned homework.</p></div>;

}
export async function WebsiteGroups({ search = {} }: { search?: WebsiteSearch }) {
  await requireWebsiteContext();
  const service = await groupService();
  const [initial,initialOfferings] = await Promise.all([service.overview(),service.view<{id:string;name:string}>(null,'offerings')]);
  return <GroupWorkspace initial={initial} initialOfferings={initialOfferings}/>;
}
export async function WebsiteOffering({ offeringId, search = {} }: { offeringId: string; search?: WebsiteSearch }) {
  const context = await requireWebsiteContext();
  if (!uuid.test(offeringId) || Object.values(search).some(v => v !== undefined && (typeof v !== 'string' || v.length > 200))) notFound();
  let page: number; try { page = validRosterPage(search.page); } catch { notFound(); }
  const [offering] = await context.repository.offering(offeringId);
  if (!offering) notFound();
  const [course] = await context.repository.course(offering.course_id);
  if (!course) notFound();
  const staff = offeringCapability(context, course, offeringId);
  const [enrollments, total] = staff ? await Promise.all([context.repository.roster(offeringId, page), context.repository.enrollmentCount([offeringId])]) : [[], null];
  const mine = (await context.repository.myEnrollments()).find(e => e.offering_id === offeringId);
  return <div className="space-y-6"><Link className="text-sm font-semibold text-sky-700" href="/group">View your groups, sessions &amp; attendance →</Link><Link className="text-sm font-semibold text-sky-700" href={`/courses/${course.id}?offering=${offering.id}`}>View {course.title} lessons &amp; progress →</Link>
    {staff ? <><GroupRosterView phase1 groupName={offering.name} nextSession={null} peers={enrollments.slice(0, 50).map(e => ({ id: e.id, name: e.profiles?.display_name || 'Learner', email: '', role: 'student', isCurrentUser: e.user_id === context.viewer.id, enrollmentStatus: e.status, latestSubmission: null }))} /><div className={panel}><p>{total} enrollment records · Page {page + 1}</p><nav className="mt-3 flex gap-6" aria-label="Roster pages">{page > 0 && <Link href={`/offerings/${offeringId}?page=${page - 1}`}>Previous</Link>}{enrollments.length > 50 && <Link href={`/offerings/${offeringId}?page=${page + 1}`}>Next</Link>}</nav></div></> : <><GroupRosterView phase1 groupName={offering.name} nextSession={null} peers={mine?[{id:mine.id,name:context.viewer.displayName,email:context.viewer.email,role:'student',isCurrentUser:true,enrollmentStatus:mine.status,latestSubmission:null}]:[]}/><p role="status" className="text-sm text-slate-500">Only your own enrollment is shown. Classmate records are private. Open Your Groups for class sessions and attendance.</p></>}
  </div>;
}
