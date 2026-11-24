const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={}) {
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,Buffer,require:n=>n==='server-only'?{}:n in deps?deps[n]:require(n)});
 return module.exports;
}
const model=load('shared/teacher-course.ts');
const id='20000000-0000-0000-0000-000000000001';
test('teacher permissions require active contextual membership and correct course assignment',()=>{
 for(const role of ['owner','admin']) assert.equal(model.canEditTeacherCourse({role,status:'active'},null),true);
 for(const role of ['owner','instructor','editor']) assert.equal(model.canEditTeacherCourse({role:'teacher',status:'active'},{role}),true);
 for(const member of [null,{role:'teacher',status:'suspended'},{role:'teacher',status:'active'}])
   assert.equal(model.canEditTeacherCourse(member,{role:'assistant'}),false);
 assert.equal(model.canEditTeacherCourse(null,{role:'owner'}),false);
});
test('course input rejects reparenting, forged identities and privilege fields',()=>{
 const valid={title:'Physics',slug:'physics',organization_id:id};
 assert.equal(model.createCourseInput.safeParse(valid).success,true);
 for(const extra of [{created_by:id},{id},{role:'owner'},{status:'published'}]) assert.equal(model.createCourseInput.safeParse({...valid,...extra}).success,false);
 const patch={updated_at:'2026-10-10T15:00:00.000Z',title:'Physics'};
 assert.equal(model.updateCourseInput.safeParse(patch).success,true);
 for(const extra of [{organization_id:id},{created_by:id},{updated_at:'invalid'},{visibility:'everyone'},{description:'x'.repeat(20001)}]) assert.equal(model.updateCourseInput.safeParse({...patch,...extra}).success,false);
 assert.equal(model.updateCourseInput.safeParse({updated_at:patch.updated_at}).success,false);
});
function handler({viewer={id,backend:'firebase'},origin=true,editable=true,result={data:{id},error:null}}={}) {
 const writes=[];
 const repository={editable:async()=>editable?{id}:null,create:async input=>{writes.push(input);return result;},
 organization:async input=>{writes.push(input);return result;}, update:async(...args)=>{writes.push(args);return result;}};
 const {teacherWrite}=load('server/http/teacher-course.ts',{
 'next/server':{NextResponse:{json:(body,{status=200}={})=>({body,status})}},
 '@/shared/auth-config':{isFirebaseStaging:()=>true},'@/shared/teacher-course':model,
 '@/server/services/application-auth':{getApplicationViewer:async()=>viewer},
 '@/server/integrations/supabase':{getSupabaseServerClient:async()=>({})},
 '@/server/repositories/teacher-course':{teacherCourseRepository:()=>repository},
 '@/server/http/firebase/route':{validFirebaseOrigin:()=>origin},
 });
 return {run:teacherWrite,writes};
}
const request=body=>new Request('https://portal.example/api/teacher/courses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('teacher write rejects CSRF and anonymous requests before mutation',async()=>{
 for(const [options,status] of [[{origin:false},403],[{viewer:null},401]]) {
  const h=handler(options);assert.equal((await h.run(request({}),'create')).status,status);assert.equal(h.writes.length,0);
 }
});
test('teacher update denies unauthorized editors and stale revisions',async()=>{
 const body={title:'Physics',updated_at:'2026-10-10T15:00:00.000Z'};
 const denied=handler({editable:false}); assert.equal((await denied.run(request(body),'update',id)).status,404);assert.equal(denied.writes.length,0);
 const stale=handler({result:{data:null,error:null}});assert.equal((await stale.run(request(body),'update',id)).status,409);
 const saved=handler();assert.equal((await saved.run(request(body),'update',id)).status,200);
 assert.equal(saved.writes[0][0],id); assert.equal(saved.writes[0][1],body.updated_at);
 assert.equal(saved.writes[0][2].title,'Physics');assert.equal(saved.writes[0][2].updated_at,undefined);
});
test('course save maps the database function refusals: stale revision, invalid details, who may publish, and nothing else leaks',async()=>{
 const body={status:'published',updated_at:'2026-10-10T15:00:00.000Z'};
 const run=async error=>{const h=handler({result:{data:null,error}});return h.run(request(body),'update',id);};
 const stale=await run({code:'PT409',message:'Course changed; reload'});assert.equal(stale.status,409);assert.equal(stale.body.error,'Course changed. Reload before saving.');
 const invalid=await run({code:'22023',message:'Course slug is invalid'});assert.equal(invalid.status,400);
 const lead='Only the course owner, its instructor or the space owner or admin can publish, unpublish or archive a course';
 const notLead=await run({code:'42501',message:lead});assert.equal(notLead.status,403);assert.equal(notLead.body.error,lead);
 const other=await run({code:'42501',message:'private SQL detail'});assert.equal(other.status,403);assert.equal(JSON.stringify(other).includes('private SQL detail'),false);
 const duplicate=await run({code:'23505',message:'duplicate key value violates unique constraint "courses_slug_key"'});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error,'This slug is already in use');
});
test('the repository saves a course through the one database function and never writes the table',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{id,updatedAt:'2026-10-10T15:00:01.000Z'},error:null};},from:()=>assert.fail('no direct table access')};
 const repository=load('server/repositories/teacher-course.ts',{'@/shared/teacher-course':model}).teacherCourseRepository(client,id);
 const result=await repository.update(id,'2026-10-10T15:00:00.000Z',{title:'Physics',status:'published'});
 assert.equal(JSON.stringify(calls),JSON.stringify([['course_update',{p_course_id:id,p_revision:'2026-10-10T15:00:00.000Z',p_fields:{title:'Physics',status:'published'}}]]));
 assert.equal(result.data.id,id);assert.equal(result.error,null);
});
test('teacher write rejects mass assignment and oversized bodies',async()=>{
 const h=handler();assert.equal((await h.run(request({title:'Physics',slug:'physics',organization_id:id,created_by:id}),'create')).status,400);
 assert.equal((await h.run(request({description:'x'.repeat(33000)}),'update',id)).status,413);assert.equal(h.writes.length,0);
});
test('database errors never expose SQL details',async()=>{
 const h=handler({result:{data:null,error:{code:'23505',message:'private SQL detail'}}});
 const r=await h.run(request({title:'Physics',slug:'physics',organization_id:id}),'create');
 assert.equal(r.status,409);assert.equal(JSON.stringify(r).includes('private SQL detail'),false);
});
