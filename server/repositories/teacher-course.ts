import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/shared/contracts/database.types';
import { canEditTeacherCourse } from '@/shared/teacher-course';
export function teacherCourseRepository(client: SupabaseClient<Database>, userId: string) {
  return {
    async editable(id: string) {
      const result = await client.from('courses').select('id,organization_id,title,slug,description,status,visibility,updated_at').eq('id', id).maybeSingle();
      if (result.error) throw new Error('Course lookup failed');
      if (!result.data) return null;
      const course = result.data;
      const [membership,staff] = await Promise.all([
        client.from('organization_memberships').select('role,status').eq('organization_id',course.organization_id).eq('user_id',userId).maybeSingle(),
        client.from('course_staff').select('role').eq('course_id',id).eq('user_id',userId).maybeSingle(),
      ]);
      if (membership.error || staff.error) throw new Error('Permission lookup failed');
      return canEditTeacherCourse(membership.data,staff.data) ? course : null;
    },
    create: (input: {organization_id: string; title: string; slug: string}) =>
      client.rpc('create_teacher_course', {p_organization_id:input.organization_id,p_title:input.title,p_slug:input.slug}),
    organization: (input: {name:string;slug:string}) => client.rpc('create_organization',{p_name:input.name,p_slug:input.slug}),
    // A course is saved by one database function (public.course_update): it checks who may change what (publish, unpublish and archive
    // need the course owner, its instructor or the space owner or admin), locks the course row and refuses a stale revision with PT409.
    // The browser role has no direct write on courses.
    update: async (id:string, revision:string, fields: Pick<Database['public']['Tables']['courses']['Update'],'title'|'slug'|'description'|'status'|'visibility'>) => {
      const result = await client.rpc('course_update',{p_course_id:id,p_revision:revision,p_fields:fields as Json});
      const data = result.data as {id?:string;updatedAt?:string}|null;
      return {data: data?.id ? {id:data.id,updatedAt:data.updatedAt??null} : null, error: result.error};
    },
  };
}
