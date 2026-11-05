import 'server-only';
import { cache } from 'react';
import { randomUUID } from 'node:crypto';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { createWebsiteRepository } from '@/server/repositories/website';
import { isFirebaseStaging } from '@/shared/auth-config';
import { lessonThumbnails } from '@/server/services/lesson-media';

/**
 * Who the caller is and what they may see, read once per request.
 * Rounds: (1) the profile lookup (two reads), the spaces, and the courses followed by their offerings, all side by side (none of
 * those three needs the profile id), then (2) memberships, course staff and offering staff together. Authorization is unchanged:
 * every read still runs with the caller's own token under RLS, and nothing from round (1) is used if the profile is missing.
 */
export const getWebsiteContext = cache(async () => {
  if (!isFirebaseStaging()) throw new Error('Firebase staging required');
  const session = await getFirebaseSession();
  if (!session || session.identity.role !== 'authenticated' || !session.identity.email_verified) return null;
  const client = await getSupabaseServerClient();
  // organizations(), courses() and offerings() never use the profile id, so they can start before the profile is known.
  const early = createWebsiteRepository(client, '');
  const spacesAndCourses = Promise.all([early.organizations(), early.courses().then(async courses => ({ courses, offerings: await early.offerings(courses.map(c => c.id)) }))]);
  spacesAndCourses.catch(() => {}); // when there is no profile the result is dropped; a failure must not surface as an unhandled rejection
  const viewer = await getApplicationViewer();
  if (!viewer) return null;
  const repository = createWebsiteRepository(client, viewer.id);
  const [[organizations, { courses, offerings }], memberships, courseStaff, offeringStaff] = await Promise.all([
    spacesAndCourses, repository.memberships(), repository.courseStaff(), repository.offeringStaff(),
  ]);
  return { viewer, repository, organizations, memberships, courseStaff, offeringStaff, courses, offerings };
});

export type WebsiteContext = NonNullable<Awaited<ReturnType<typeof getWebsiteContext>>>;

export function courseCapability(context: Pick<WebsiteContext, 'memberships' | 'courseStaff'>, course: { id: string; organization_id: string }) {
  const membership = context.memberships.find(m => m.organization_id === course.organization_id && m.status === 'active');
  const staff = context.courseStaff.find(s => s.course_id === course.id);
  return !!membership && (['owner', 'admin'].includes(membership.role) || !!staff);
}

export function offeringCapability(context: Pick<WebsiteContext, 'memberships' | 'courseStaff' | 'offeringStaff'>, course: { id: string; organization_id: string }, offeringId: string) {
  const membership = context.memberships.find(m => m.organization_id === course.organization_id && m.status === 'active');
  if (!membership) return false;
  return ['owner', 'admin'].includes(membership.role) || context.courseStaff.some(s => s.course_id === course.id && ['owner', 'instructor'].includes(s.role)) || context.offeringStaff.some(s => s.offering_id === offeringId);
}

export async function loadWebsiteScope(context: WebsiteContext, organizationId?: string, courseId?: string) {
  if (organizationId && !context.organizations.some(o => o.id === organizationId)) return null;
  const courseRows = courseId ? await context.repository.course(courseId) : await context.repository.courses(organizationId);
  const courses = courseRows.slice(0, 100);
  const [offeringRows, moduleRows, enrollmentRows] = await Promise.all([
    context.repository.offerings(courses.map(c => c.id)), context.repository.modules(courses.map(c => c.id)), context.repository.myEnrollments(),
  ]);
  const offerings = offeringRows.slice(0, 100), modules = moduleRows.slice(0, 500);
  const [lessonRows, progressResult, scheduledRows] = await Promise.all([
    context.repository.lessons(modules.map(m => m.id)), context.repository.progress(offerings.map(o => o.id)), context.repository.scheduledAssessments(offerings.map(o => o.id)),
  ]);
  const scheduled = scheduledRows.slice(0, 100);
  const [segments,segmentResult]=await Promise.all([context.repository.segments(lessonRows.map(l=>l.id)),context.repository.segmentProgress(offerings.map(o=>o.id))]);
  const progressLimited = progressResult.incomplete || segmentResult.incomplete || progressResult.rows.length > 1000 || segmentResult.rows.length > 5000;
  // Discard both projections together. Even a complete lesson summary must not
  // infer completion when its current part-level evidence is incomplete.
  const progressRows = progressLimited ? [] : progressResult.rows;
  const segmentProgress = progressLimited ? [] : segmentResult.rows;
  const thumbnailUrls=await lessonThumbnails(await getSupabaseServerClient(),[...segments.flatMap(s=>s.thumbnail_asset_id?[s.thumbnail_asset_id]:[]),...lessonRows.flatMap(l=>l.cover_asset_id?[l.cover_asset_id]:[])]);
  const parts=segments.map(s=>({...s,thumbnail_url:s.thumbnail_asset_id?thumbnailUrls[s.thumbnail_asset_id]??null:null}));
  // New delivery status is computed from actual published parts. Adding another
  // published part must not leave a cached lesson completion authoritative.
  const progress=progressRows.map(p=>{
    const parts=segments.filter(s=>s.lesson_id===p.lesson_id);
    if(!parts.length)return p;
    const mine=segmentProgress.filter(s=>s.offering_id===p.offering_id&&s.lesson_id===p.lesson_id);
    return {...p,status:parts.every(s=>mine.some(x=>x.segment_id===s.id&&x.status==='completed'))?'completed':mine.length?'in_progress':'not_started'};
  });
  const assessments = await context.repository.assessments(Array.from(new Set(scheduled.map(a => a.assessment_id))));
  const contentLimited = courseRows.length > 100 || offeringRows.length > 100 || moduleRows.length > 500 || enrollmentRows.length > 100 || lessonRows.length > 500 || scheduledRows.length > 100 || assessments.length > 100;
  return { courses, offerings, modules, lessons: lessonRows.slice(0, 500).map(l=>({...l,cover_url:l.cover_asset_id?thumbnailUrls[l.cover_asset_id]??null:null})), progress: progress.slice(0, 1000),segments:parts,segmentProgress,
    enrollments: enrollmentRows.slice(0, 100), scheduled, assessments,
    progressReadId: randomUUID(), progressReadProofs: segmentProgress.slice().sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)||a.segment_id.localeCompare(b.segment_id)).slice(0,8).map(p=>({key:`${p.offering_id}:${p.segment_id}`,revision:p.revision})),
    progressAvailable: !progressLimited, progressLimited, contentLimited, limited: contentLimited || progressLimited };
}
