import { CourseSearch } from '@/frontend/design/course-search';
import { Preview } from '@/frontend/components/preview';
import { T } from '@/frontend/design/preferences';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BookOpen, Users, ShieldCheck } from 'lucide-react';
import StudentHome from '@/frontend/features/dashboard/student-home';
import AdminHome from '@/frontend/features/dashboard/admin-home';
import CourseCard from '@/frontend/components/course-card';
import GroupRosterView from '@/frontend/features/groups/group-roster-view';
import { getWebsiteContext, loadWebsiteScope, courseCapability, offeringCapability } from '@/server/services/website';
import { studentLessons, validRosterPage } from '@/shared/website-model';
import { canEditTeacherCourse } from '@/shared/teacher-course';
import { LessonCard } from '@/frontend/features/courses/lesson-card';
import lessonCards from '@/frontend/features/courses/lesson-cards.module.css';
import { lessonNumbersByModule, lessonCardStatus, moduleDisplayLabel } from '@/shared/lesson-card-model';

export type WebsiteSearch = { organization?: string; offering?: string; page?: string; title?: string };
const panel = 'edu-card';
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
  return limited ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><T>{"This overview shows at most 100 courses/offerings and 500 lessons. Narrow your organization or open an individual course. Progress totals are unavailable for truncated data."}</T></p> : null;
}
function Offerings({ scope }: { scope: NonNullable<Awaited<ReturnType<typeof loadWebsiteScope>>> }) {
  return <section className={panel}><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 text-cyan-600" /><T>{"Your Groups & Offerings"}</T></h2>
    {!scope.offerings.length && <p className="text-sm text-slate-500"><T>{"No accessible offerings yet. Your teacher will arrange your course enrollment."}</T></p>}
    <div className="divide-y divide-slate-100">{scope.offerings.map(o => <Link className="flex flex-wrap justify-between gap-2 py-4 text-sm hover:text-sky-700" key={o.id} href={`/offerings/${o.id}`}><span className="font-semibold">{o.name}</span><span><T>{o.status}</T> · <T>{o.delivery_mode.replace('_', ' ')}</T>{scope.enrollments.find(e => e.offering_id === o.id) ? <> · <T>Your enrollment:</T>{' '}<T>{scope.enrollments.find(e => e.offering_id === o.id)?.status || 'Unavailable'}</T></> : null}</span></Link>)}</div>
  </section>;
}
function Assessments({ scope }: { scope: NonNullable<Awaited<ReturnType<typeof loadWebsiteScope>>> }) {
  const now = Date.now();
  const upcoming = scope.scheduled.filter(s => !s.closes_at || Date.parse(s.closes_at) > now);
  return <section className={panel}><h2 className="mb-3 text-xl font-bold"><T>{"Available & Upcoming Assessments"}</T></h2><p className="mb-4 text-xs text-slate-500"><T>{"Assessment participation is awaiting integration. These are published schedules for accessible offerings."}</T></p>
    {!upcoming.length && <p className="text-sm text-slate-500"><T>{"No upcoming published assessments."}</T></p>}
    {upcoming.map(s => <div className="border-t py-3 text-sm" key={s.id}><strong>{scope.assessments.find(a => a.id === s.assessment_id)?.title || 'Assessment'}</strong><p>{scope.offerings.find(o => o.id === s.offering_id)?.name} <T>{"· Opens"}</T>{s.opens_at ? new Date(s.opens_at).toISOString() : <T>{"any time"}</T>} <T>{"· Closes"}</T>{s.closes_at ? new Date(s.closes_at).toISOString() : <T>{"without a deadline"}</T>}</p></div>)}
  </section>;
}
export async function WebsiteHome({ search = {} }: { search?: WebsiteSearch }) {
  const { context, scope } = await scopeFor(search);
  const supported = scope.offerings.filter(o => {
    const course = scope.courses.find(c => c.id === o.course_id);
    return course && offeringCapability(context, course, o.id);
  });
  const staff = scope.courses.some(c => courseCapability(context, c)) || supported.length > 0 || context.memberships.some(m => m.status === 'active' && ['owner', 'admin'].includes(m.role) && (!search.organization || search.organization === m.organization_id));
  const [active, invited] = staff ? await Promise.all([context.repository.enrollmentCount(supported.map(o => o.id), 'active'), context.repository.enrollmentCount(supported.map(o => o.id), 'invited')]) : [0, 0];
  return <div className="space-y-8"><LimitNotice limited={scope.limited} />
    <nav className="flex flex-wrap gap-4 text-sm text-sky-700" aria-label="Teaching tools"><Link href="/onboarding/organization"><T>{"Create an organization"}</T></Link>{context.memberships.some(m=>m.status==='active'&&['owner','admin','teacher'].includes(m.role))&&<Link href="/teacher/create"><T>{"Create a course"}</T></Link>}</nav>
    {staff && <AdminHome phase1 adminName={context.viewer.displayName} metrics={{ totalStudents: active, pendingWaitlistCount: invited, pendingHomeworkCount: null, activeGroupsCount: supported.filter(o => o.status === 'active').length }} recentSignups={[]} recentSubmissions={[]} />}
    <StudentHome phase1 summaryAvailable={!scope.limited} lessons={scope.limited ? [] : studentLessons({ ...scope, offerings: scope.offerings.filter(o => scope.enrollments.some(e => e.offering_id === o.id && e.status === 'active' && (!e.expires_at || Date.parse(e.expires_at) > Date.now()) && (!e.enrolled_at || Date.parse(e.enrolled_at) <= Date.now()))) })} groupName={null} />
    {scope.limited && <p className="text-sm text-slate-500"><T>{"Open a course for its available lessons. Dashboard lesson progress is not calculated on partial data."}</T></p>}
    <Offerings scope={scope} /><Assessments scope={scope} />
  </div>;
}
export async function WebsiteCourses({ search = {}, teacher = false }: { search?: WebsiteSearch; teacher?: boolean }) {
  const context = await requireWebsiteContext();
  if (Object.values(search).some(v => v !== undefined && (typeof v !== 'string' || v.length > 200)) || (search.organization && !context.organizations.some(o => o.id === search.organization))) notFound();
  let page: number; try { page = validRosterPage(search.page); } catch { notFound(); }
  const rows = await context.repository.courses(search.organization, page, search.title);
  const courses = rows.slice(0, 100);
  const [modules, offerings] = await Promise.all([context.repository.modules(courses.map(c => c.id)), context.repository.offerings(courses.map(c => c.id))]);
  const visible = courses.filter(c => !teacher || courseCapability(context, c) || offerings.some(o => o.course_id === c.id && offeringCapability(context, c, o.id)));
  const catalogPath = teacher ? '/teacher/courses' : '/self-learning';
  const pageUrl = (value: number) => `${catalogPath}?${new URLSearchParams({ page: String(value), ...(search.organization ? { organization: search.organization } : {}), ...(search.title ? { title: search.title } : {}) })}`;
  return <div className="mx-auto max-w-7xl space-y-6 pb-16 pt-2"><div className="space-y-2"><div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800">{teacher ? <ShieldCheck className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}{teacher ? <T>{"Teacher Portal"}</T> : <T>{"Curriculum & Self Learning"}</T>}</div><h1 className="text-3xl font-bold">{teacher ? <T>{"Lesson Management"}</T> : <T>{"Self Learning Curriculum"}</T>}</h1><p className="text-sm text-slate-500">{teacher ? <T>{"Create courses and edit the courses you are authorized to manage."}</T> : <T>{"Explore the published lessons available through your course offerings."}</T>}</p></div>
    {teacher && <Link className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" href="/teacher/create"><T>{"Create a course"}</T></Link>}<CourseSearch action={catalogPath} organization={search.organization} title={search.title}/>
    <div className={panel}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(c => <CourseCard key={c.id} href={teacher && canEditTeacherCourse(context.memberships.find(m=>m.organization_id===c.organization_id)??null,context.courseStaff.find(s=>s.course_id===c.id)??null) ? "/teacher/courses/"+c.id : undefined} id={c.id} title={c.title} category={context.organizations.find(o => o.id === c.organization_id)?.name} chaptersLength={modules.length > 500 ? undefined : modules.filter(m => m.course_id === c.id).length} />)}</div>{!visible.length && <p className="py-12 text-center text-slate-500"><T>{"No accessible courses on this page. Try another organization or search."}</T></p>}<nav aria-label="Course pages" className="mt-6 flex gap-6 text-sm text-sky-700">{page > 0 && <Link href={pageUrl(page - 1)}><T>{"Previous"}</T></Link>}{rows.length > 100 && <Link href={pageUrl(page + 1)}><T>{"Next"}</T></Link>}</nav></div>
  </div>;
}
export async function WebsiteCourse({ courseId, search = {} }: { courseId: string; search?: WebsiteSearch }) {
  const { context, scope } = await scopeFor(search, courseId);
  const course = scope.courses[0];
  if (search.offering && !scope.offerings.some(o => o.id === search.offering)) notFound();
  const offering = scope.offerings.find(o => o.id === search.offering);
  const publishedLessons = scope.lessons.filter(l => l.status === 'published' && scope.modules.some(m => m.id === l.module_id));
  const lessonNumbers = lessonNumbersByModule(publishedLessons);
  return <div className="space-y-6 p-2 sm:p-8"><div className="grid gap-8 sm:grid-cols-2"><div><h1 className="text-3xl font-bold">{course.title}</h1><div className="mt-4 text-sm">{course.description ? <Preview value={course.description}/> : <T>No description</T>}</div><p className="mt-4 text-xs text-slate-500">{context.organizations.find(o => o.id === course.organization_id)?.name} · <T>{course.status}</T></p></div><div className="grid min-h-40 place-items-center rounded-2xl border bg-white text-cyan-600"><BookOpen className="h-12 w-12" /></div></div>
    <LimitNotice limited={scope.limited} /><Offerings scope={scope} />
    <section className={panel}><h2 className="mb-4 text-xl font-bold"><T>{"Available Lessons"}</T>{offering ? ` · ${offering.name}` : ''}</h2>{!offering && <p className="mb-4 text-sm text-slate-500"><T>{"Select a group above to view progress for that specific course run."}</T></p>}
      <div className={lessonCards.cards}>{scope.modules.map((m, moduleIndex) => {
        const label = moduleDisplayLabel(m.title, moduleIndex);
        return <div key={m.id} className="border-t py-4"><h3 className="mb-4 font-semibold">{label}</h3>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {publishedLessons.filter(l => l.module_id === m.id).map(l => {
              const progress = offering ? scope.progress.find(p => p.offering_id === offering.id && p.lesson_id === l.id) : undefined;
              return <li key={l.id} className="flex min-w-0 flex-col gap-2">
                <LessonCard moduleLabel={label} lessonNumber={lessonNumbers.get(l.id)!} title={l.title} partsCount={null}
                  status={lessonCardStatus({ published: true, offeringSelected: Boolean(offering), progressStatus: progress?.status })} />
                <p className="min-h-[1rem] text-xs text-slate-500" aria-hidden={l.estimated_duration_seconds === null}>
                  {l.estimated_duration_seconds !== null && <>{Math.ceil(l.estimated_duration_seconds / 60)} <T arabic="دقيقة">min</T></>}
                </p>
              </li>;
            })}
          </ul>
        </div>;
      })}</div>
      {!publishedLessons.length && <p className="text-sm text-slate-500"><T>{"No published lessons available."}</T></p>}<p className="mt-4 text-sm text-slate-500"><T>{"Video playback, homework and lesson editing are awaiting integration. Existing progress is shown read-only."}</T></p>
    </section><Assessments scope={scope} />
  </div>;
}
export async function WebsiteGroups({ search = {} }: { search?: WebsiteSearch }) {
  const { scope } = await scopeFor(search);
  return <div className="mx-auto max-w-5xl space-y-6"><LimitNotice limited={scope.limited} /><Offerings scope={scope} />
    <section className={panel}><h2 className="mb-3 text-xl font-bold"><T>{"Your Enrollment Status"}</T></h2><p className="mb-3 text-sm text-slate-500"><T>{"Suspended, expired, invited and cancelled enrollments do not grant course access."}</T></p>{scope.enrollments.filter(e => !search.organization || scope.offerings.some(o => o.id === e.offering_id)).map(e => <p className="border-t py-3 text-sm" key={e.id}>{scope.offerings.find(o => o.id === e.offering_id)?.name || <T>Unavailable offering</T>} · <T>{e.status}</T>{e.expires_at ? <> · <T arabic="ينتهي">Expires</T> <bdi dir="ltr">{e.expires_at}</bdi></> : null}</p>)}{!scope.enrollments.length && <p className="text-sm text-slate-500"><T>{"You have no enrollments yet."}</T></p>}</section>
  </div>;
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
  return <div className="space-y-6"><Link className="text-sm font-semibold text-sky-700" href={`/courses/${course.id}?offering=${offering.id}`}><T>{"View"}</T>{course.title} <T>{"lessons & progress →"}</T></Link>
    {staff ? <><GroupRosterView phase1 groupName={offering.name} nextSession={null} peers={enrollments.slice(0, 50).map(e => ({ id: e.id, name: e.profiles?.display_name || 'Learner', email: '', role: 'student', isCurrentUser: e.user_id === context.viewer.id, enrollmentStatus: e.status, latestSubmission: null }))} /><div className={panel}><p>{total} <T>{"enrollment records · Page"}</T>{page + 1}</p><nav className="mt-3 flex gap-6" aria-label="Roster pages">{page > 0 && <Link href={`/offerings/${offeringId}?page=${page - 1}`}><T>{"Previous"}</T></Link>}{enrollments.length > 50 && <Link href={`/offerings/${offeringId}?page=${page + 1}`}><T>{"Next"}</T></Link>}</nav></div></> : <section className={panel}><h1 className="text-2xl font-bold">{offering.name}</h1><p className="mt-4"><T>{"Your enrollment:"}</T>{' '}<T>{mine?.status || 'Unavailable'}</T></p><p className="mt-2 text-sm text-slate-500"><T>{"Classmate records are private. Live sessions and homework are awaiting integration."}</T></p></section>}
  </div>;
}
