import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { createExamSecurityRepository } from '@/server/repositories/exam-security';
import { createExamsRepository } from '@/server/repositories/exams';
import type { ExamRunState, ExamResult, SecureQuestionType, GradeChange } from '@/shared/contracts/exams';
import type { ExamAnswers } from '@/shared/exams';
import type { Json } from '@/shared/contracts/database.types';
import { z } from 'zod';

export const examFailure=(message:string,status=400)=>Object.assign(new Error(message),{status});

/** All calls retain the verified caller JWT; PostgreSQL owns every transition. */
export async function examRunnerService(scheduleId:string) {
 const client=await getSupabaseServerClient();
 const identity=await client.rpc('current_profile_id');
 if(identity.error||!identity.data) throw examFailure('Sign in required',401);
 const loaded=await createExamsRepository(client,identity.data).get(scheduleId,{studentView:true});
 if(!loaded) throw examFailure('Exam unavailable',404);
 const exam=loaded;
 const repo=createExamSecurityRepository(client);
 const checked=async<T>(query:PromiseLike<{data:T|null;error:{code?:string}|null}>)=>{
  const {data,error}=await query;
  if(error) throw examFailure('Exam operation not permitted',error.code==='PT409'?409:error.code==='42501'?403:400);
  return data;
 };
 const supported=async()=>{
  const qs=await checked(client.from('assessment_questions').select('question_type').eq('assessment_id',exam.assessmentId).limit(101));
  if(!qs?.length||qs.length>100||qs.some(q=>!['single_choice','multiple_choice','true_false','numeric','essay','short_text','file_upload'].includes(q.question_type))) throw examFailure('This question format is not available in the student runner yet.',409);
 };
 async function photoUrl(id:string|null) {
  if(!id)return null;
  const asset=await checked<{bucket:string;object_path:string;mime_type:string;status:string}>(client.from('media_assets').select('bucket,object_path,mime_type,status').eq('id',id).single());
  if(!asset||asset.status!=='ready'||!['image/jpeg','image/png','image/webp'].includes(asset.mime_type))throw examFailure('Submission photo unavailable',403);
  const signed=await client.storage.from(asset.bucket).createSignedUrl(asset.object_path,600);
  if(signed.error||!signed.data)throw examFailure('Submission photo unavailable',403);
  return signed.data.signedUrl;
 }
 const questionImage=(settings:Record<string,unknown>)=>{const value=settings.image_url;return typeof value==='string'&&value.startsWith('https://')&&z.string().url().max(2048).safeParse(value).success?value:null;};
 async function state():Promise<ExamRunState> {
  const s=await repo.sync(scheduleId);
  const content=s.current_attempt?.status==='in_progress'?await repo.content(s.current_attempt.id):[];
  if(content.some(q=>!['single_choice','multiple_choice','true_false','numeric','essay','short_text','file_upload'].includes(q.question_type)))throw examFailure('This question format is not available in the student runner yet.',409);
  const answers:ExamAnswers={};
  for(const q of content) {
   if(q.response) answers[q.id]=q.question_type==='multiple_choice'?{choices:q.options.flatMap((o,i)=>(q.response?.option_ids as string[]|undefined)?.includes(o.id)?[i]:[])}:q.question_type==='numeric'?{value:typeof q.response.value==='number'?q.response.value:null}:q.question_type==='single_choice'||q.question_type==='true_false'
    ?{choice:q.options.findIndex(o=>(q.response?.option_ids as string[]|undefined)?.includes(o.id))}
    :{text:typeof q.response.text==='string'?q.response.text:null,imageKey:q.media_asset_id,imageUrl:await photoUrl(q.media_asset_id)};
  }
  return {role:'student',revision:s.revision,attemptId:s.current_attempt?.id??null,canStart:s.can_start,canDecide:s.can_decide,
   exam:{id:scheduleId,title:exam.title,description:exam.instructions,durationMinutes:exam.timeLimitSeconds===null?null:exam.timeLimitSeconds/60,maxAttempts:exam.maxAttempts as 1|2,questionCount:exam.questionCount??0},
   status:s.attempts_state==='finalized'?'FINALIZED':s.attempts_state==='retry_decision_pending'?'AWAITING_DECISION':s.attempts_state==='in_progress'?'IN_PROGRESS':'NOT_STARTED',
   attemptNumber:s.current_attempt?.attempt_number??1,deadline:s.current_attempt?.deadline_at??null,serverNow:s.server_now,
   questions:content.map(q=>({questionType:q.question_type as SecureQuestionType,id:q.id,position:q.position+1,type:['single_choice','multiple_choice','true_false'].includes(q.question_type)?'MCQ':'WRITTEN',photoAllowed:q.question_type==='file_upload',text:q.prompt,imageUrl:questionImage(q.settings),choices:q.options.length?q.options.map(o=>o.text):null,points:q.points})),answers,
   writtenStatus:s.attempts_state==='finalized'&&s.grading_state==='pending'?'UNDER_CORRECTION':'NONE'};
 }
 async function save(attemptId:string,revision:number,answers:ExamAnswers) {
  const before=await repo.sync(scheduleId);
  if(before.current_attempt?.id!==attemptId||before.current_attempt.status!=='in_progress') throw examFailure('Exam changed. Reload before continuing.',409);
  const questions=await repo.content(attemptId);
  if(Object.keys(answers).some(id=>!questions.some(q=>q.id===id))) throw examFailure('Invalid question');
  const plans:{id:string;response:Json|null;media:string|null}[]=[];
  let current=before;
  for(const q of questions) {
   const a=answers[q.id];let response:Json|null=null;
   if((a?.imageUrl||a?.imageKey)&&q.question_type!=='file_upload') throw examFailure('This question accepts a typed answer only.',400);
   if(q.question_type==='multiple_choice'){if(a?.choices?.length){if(new Set(a.choices).size!==a.choices.length||a.choices.some(i=>!Number.isInteger(i)||!q.options[i]))throw examFailure('Invalid selections');response={option_ids:a.choices.map(i=>q.options[i].id).sort()};}}
   else if(q.question_type==='numeric'){if(a?.value!=null){if(!Number.isFinite(a.value))throw examFailure('Invalid numeric answer');response={value:a.value};}}
   else if(['single_choice','true_false'].includes(q.question_type)) {
    if(a?.choice!=null){const option=q.options[a.choice];if(!option)throw examFailure('Invalid selection');response={option_ids:[option.id]};}
   } else if(['essay','short_text'].includes(q.question_type)) {if(a?.text?.trim())response={text:a.text.trim()};}
   else if(q.question_type==='file_upload') {if(a?.imageKey){if(!z.string().uuid().safeParse(a.imageKey).success)throw examFailure('Invalid photo');response={text:a.text?.trim()??''};}else if(a?.text?.trim())throw examFailure('Attach a photo to this photo-submission question.');}
   else throw examFailure('Unsupported question format',409);
   plans.push({id:q.id,response,media:q.question_type==='file_upload'?a?.imageKey??null:null});
  }
  if(before.revision!==revision){
   if(plans.every(p=>{const q=questions.find(q=>q.id===p.id)!;const same=q.question_type==='multiple_choice'?JSON.stringify((q.response?.option_ids as string[]|undefined)?.slice().sort()??null)===JSON.stringify(p.response&&typeof p.response==='object'&&!Array.isArray(p.response)?p.response.option_ids:null):JSON.stringify(q.response)===JSON.stringify(p.response);return same&&q.media_asset_id===p.media;}))return before;
   throw examFailure('Exam changed. Reload before continuing.',409);
  }
  const batch=await client.rpc('save_exam_answers',{p_attempt_id:attemptId,p_expected_revision:revision,p_answers:plans.map(p=>({question_id:p.id,response:p.response,media_asset_id:p.media}))});
  if(batch.error?.code==='PGRST202'){for(const p of plans)current=await repo.save(attemptId,p.id,p.response,p.media,current.revision);}else{if(batch.error)throw examFailure('Answers could not be saved',batch.error.code==='PT409'?409:batch.error.code==='42501'?403:400);current=await repo.sync(scheduleId);}
  return current;
 }
 return {state,
  // The legacy photo upload wrote media_assets and the lms-submissions bucket directly. Both are closed (fix-01-direct-access, A6b-01); the route answers 410.
  photo:async(_attemptId:string,_questionId:string,_file:Blob):Promise<{imageKey:string;imageUrl:string}>=>{throw examFailure('This exam route has been retired.',410);},
  start:async()=>{await supported();await checked(client.rpc('start_assessment_attempt',{p_offering_assessment_id:scheduleId}));return state();},
  decide:async(decision:'accept'|'decline',revision:number)=>{await repo.decide(scheduleId,decision,revision);return state();},
  save:async(attemptId:string,revision:number,answers:ExamAnswers)=>{await save(attemptId,revision,answers);return state();},
  submit:async(attemptId:string,revision:number,answers:ExamAnswers)=>{
   const before=await repo.sync(scheduleId);
   if(before.current_attempt?.id!==attemptId)throw examFailure('Attempt unavailable',403);
   // Expiration freezes already-saved answers. Never accept late client work.
   if(before.current_attempt.status==='in_progress')await save(attemptId,revision,answers);
   await checked(client.rpc('submit_assessment_attempt',{p_attempt_id:attemptId}));return state();
  },
  result:async():Promise<ExamResult>=>{
   const s=await repo.sync(scheduleId);
   if(s.attempts_state!=='finalized'||!s.current_attempt)throw examFailure('Result not available',403);
   const result:ExamResult={examId:scheduleId,title:exam.title,attemptsUsed:s.current_attempt.attempt_number,maxAttempts:exam.maxAttempts as 1|2,mcqScore:null,mcqTotal:null,writtenStatus:s.grading_state==='pending'?'UNDER_CORRECTION':'NONE',writtenScore:null,writtenTotal:0,reviewNote:null,finalizedAt:null,questions:[],resultReleased:s.result_released,reviewReleased:s.review_released,finalScore:null,finalPossible:null};
   if(s.result_released) {
    const raw=await checked(client.rpc('get_assessment_results',{p_attempt_id:s.current_attempt.id})) as {score:number;max_score:number};
    result.finalScore=raw.score;result.finalPossible=raw.max_score;
   }
   if(s.result_released){const changes=await client.rpc('get_exam_grade_changes',{p_attempt_id:s.current_attempt.id});if(!changes.error)result.gradeChanges=z.array(z.object({id:z.string().uuid(),changedAt:z.string(),reason:z.string(),previousScore:z.number().nullable(),score:z.number().nullable()})).parse(changes.data) as GradeChange[];else if(changes.error.code!=='PGRST202')throw examFailure('Grade history unavailable',503);}
   if(s.review_released) {
    const [review,content]=await Promise.all([repo.review(scheduleId),repo.content(s.current_attempt.id)]);
    result.questions=await Promise.all(content.map(async q=>{const r=review.questions.find(r=>r.question_id===q.id)!;const final=r.attempts.at(-1);const correct=q.options.findIndex(o=>r.correct_option_ids.includes(o.id));return {questionType:q.question_type as SecureQuestionType,correctChoices:q.options.flatMap((o,i)=>r.correct_option_ids.includes(o.id)?[i]:[]),numericKey:r.numeric_key,feedback:final?.feedback??null,id:q.id,position:q.position+1,type:['single_choice','multiple_choice','true_false'].includes(q.question_type)?'MCQ' as const:'WRITTEN' as const,text:q.prompt,imageUrl:questionImage(q.settings),choices:q.options.map(o=>o.text),points:q.points,correctChoice:correct<0?null:correct,picks:r.attempts.map(a=>({attemptNumber:a.attempt_number,choices:q.options.flatMap((o,i)=>(a.response?.option_ids as string[]|undefined)?.includes(o.id)?[i]:[]),value:typeof a.response?.value==='number'?a.response.value:null,text:typeof a.response?.text==='string'?a.response.text:null,choice:a.response?q.options.findIndex(o=>(a.response?.option_ids as string[]|undefined)?.includes(o.id)):null})),isCorrect:final?.awarded_points===q.points,written:final?.response?{text:typeof final.response.text==='string'?final.response.text:typeof final.response.value==='number'?String(final.response.value):null,imageUrl:await photoUrl(final.media_asset_id)}:null,writtenScore:final?.awarded_points??null};}));
   }
   return result;
  },
 };
}
