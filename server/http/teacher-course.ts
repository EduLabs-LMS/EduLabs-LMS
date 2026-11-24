import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { createCourseInput, updateCourseInput, organizationInput } from '@/shared/teacher-course';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { teacherCourseRepository } from '@/server/repositories/teacher-course';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
const reply = (error:string,status:number) => NextResponse.json({error},{status});
export const createOrganizationPOST = (request:NextRequest) => teacherWrite(request,'organization');
export const createCoursePOST = (request:NextRequest) => teacherWrite(request,'create');
export async function updateCoursePATCH(request:NextRequest, context:{params:Promise<{courseId:string}>}) {
  return teacherWrite(request,'update',(await context.params).courseId);
}
export async function teacherWrite(request:NextRequest, action:'organization'|'create'|'update', id?:string) {
  if (!isFirebaseStaging()) return reply('Not found',404);
  if (!validFirebaseOrigin(request)) return reply('Invalid origin',403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply('JSON required',415);
  try {
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') return reply('Sign in required',401);
    const reader = request.body?.getReader();
    if (!reader) return reply('Missing body',400);
    const chunks:Uint8Array[]=[]; let size=0;
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength; if(size>32000) { await reader.cancel(); return reply('Request too large',413); }
      chunks.push(value);
    }
    let body:unknown;
    try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply('Invalid JSON',400); }
    const repository=teacherCourseRepository(await getSupabaseServerClient(),viewer.id);
    let result;
    if(action==='organization') {
      const input=organizationInput.safeParse(body); if(!input.success) return reply('Invalid name or slug',400);
      result=await repository.organization(input.data);
    } else if(action==='create') {
      const input=createCourseInput.safeParse(body); if(!input.success) return reply('Invalid course details',400);
      result=await repository.create(input.data);
    } else {
      if(!z.string().uuid().safeParse(id).success) return reply('Invalid course',400);
      const input=updateCourseInput.safeParse(body); if(!input.success) return reply('Invalid course details',400);
      if(!await repository.editable(id!)) return reply('Course not found or editing not permitted',404);
      const {updated_at,...fields}=input.data;
      result=await repository.update(id!,updated_at,fields);
      if(!result.error && !result.data) return reply('Course changed. Reload before saving.',409);
      // The function's own refusals are fixed sentences (no SQL detail), so the two that a person can act on are passed on as they are.
      if(result.error?.code==='PT409') return reply('Course changed. Reload before saving.',409);
      if(result.error?.code==='22023') return reply('Invalid course details',400);
      if(result.error?.code==='42501' && result.error.message?.startsWith('Only the')) return reply(result.error.message,403);
    }
    if(result.error) return reply(result.error.code==='23505' ? 'This slug is already in use' : 'Operation not permitted or unavailable',result.error.code==='23505'?409:403);
    return NextResponse.json({id:typeof result.data==='string'?result.data:result.data?.id});
  } catch { return reply('Unable to save. Please retry.',503); }
}
