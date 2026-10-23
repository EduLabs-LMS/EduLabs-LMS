const fs=require('fs'),vm=require('vm'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const {load:shared}=require('./localization-test-loader.cjs');
const {resumeLearning}=shared('shared/continue-learning.ts');
const now=Date.parse('2026-10-22T12:00:00Z'),orgs=[{id:'org',status:'active'}];
function sample(){return {limited:false,courses:[{id:'c',organization_id:'org',title:'Physics',status:'published'}],offerings:[{id:'A',course_id:'c',name:'Morning',status:'active'}],enrollments:[{offering_id:'A',status:'active',enrolled_at:null,expires_at:null}],modules:[{id:'m',course_id:'c',position:0}],lessons:[{id:'l',module_id:'m',title:'Motion',position:0,status:'published'}],segments:[{id:'s1',lesson_id:'l',title:'Intro',position:0,status:'published'},{id:'s2',lesson_id:'l',title:'Practice',position:1,status:'published'}],progress:[{offering_id:'A',lesson_id:'l',last_accessed_at:'2026-10-22T10:00:00Z'}],segmentProgress:[{offering_id:'A',lesson_id:'l',segment_id:'s1',status:'in_progress',video_position_seconds:37,updated_at:'2026-10-22T10:00:00Z'}]}}
module.exports={sample,orgs,now};
test('preloaded SSR video restores without a metadata event and ignores premature zero-position updates',()=>{
 const React=require('react'),refs=[],effects=[];let writes=0;
 const hooks={...React,useRef:v=>{const r={current:v};refs.push(r);return r;},useState:v=>[v,()=>{}],useCallback:f=>f,useEffect:f=>effects.push(f)};
 const {SecureLessonPlayer}=local('frontend/features/courses/lesson/secure-player.tsx',{
  '@/frontend/components/language-provider':require('./localization-test-loader.cjs').language(),react:hooks,
  'next/navigation':{useRouter:()=>({})},'@/frontend/components/ui/button':{Button:()=>null},
  '@/shared/contracts/lessons':shared('shared/contracts/lessons.ts')
 },{fetch:()=>{writes++;throw Error('Unexpected progress write')}});
 const tree=SecureLessonPlayer({courseId:'c',segmentId:'s',url:'https://example.invalid/video.webm',data:{offeringId:'A',revision:3,position:37,assetId:null,status:'in_progress'}});
 function find(n){if(n?.type==='video')return n;for(const c of [n?.props?.children].flat(Infinity)){const v=c&&find(c);if(v)return v;}}
 const video=find(tree);refs[0].current={currentTime:0,duration:60,readyState:4};
 video.props.onTimeUpdate();assert.equal(writes,0);effects[0]();
 assert.equal(refs[0].current.currentTime,37);assert.equal(writes,0);
});
function local(file,deps={},globals={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,Date,Set,Map,URL,...globals,require:n=>n in deps?deps[n]:n==='@/frontend/features/self-learning/learning-overview-freshness'?shared('frontend/features/self-learning/learning-overview-freshness.ts'):n==='server-only'?{}:require(n)});return m.exports;}
test('resume: never-started and completed students have a genuine empty result',()=>{const s=sample();s.segmentProgress=[];assert.equal(resumeLearning(s,orgs,now).items.length,0);s.segmentProgress=s.segments.map(p=>({...sample().segmentProgress[0],segment_id:p.id,status:'completed'}));assert.equal(resumeLearning(s,orgs,now).items.length,0)});
test('resume: one unfinished lesson carries real titles, offering, part and saved seconds',()=>{const s=sample(),r=resumeLearning(s,orgs,now).items[0];assert.equal(r.courseTitle,'Physics');assert.equal(r.lessonTitle,'Motion');assert.equal(r.partTitle,'Intro');assert.equal(r.href,'/courses/c/chapters/s1?offering=A');assert.equal(r.position,37);assert.equal(r.totalParts,2);assert.equal(r.completedParts,0);assert.equal(JSON.stringify(s),JSON.stringify(sample()),'projection must never mutate progress')});
test('resume: multiple lessons use explicit activity, never content edits or creation time; bounded to three',()=>{const s=sample();for(let i=2;i<=5;i++){s.lessons.push({...s.lessons[0],id:'l'+i,title:'Lesson '+i,updated_at:'2099-01-01'});s.segments.push({...s.segments[0],id:'s'+i+'1',lesson_id:'l'+i});s.segmentProgress.push({...s.segmentProgress[0],lesson_id:'l'+i,segment_id:'s'+i+'1'});s.progress.push({offering_id:'A',lesson_id:'l'+i,last_accessed_at:`2026-10-22T0${i}:00:00Z`});}const r=resumeLearning(s,orgs,now);assert.equal(r.items.length,3);assert.equal(r.items.map(i=>i.lessonId).join(','),'l,l5,l4')});
test('resume: null historic timestamps use stable IDs, not fabricated visit ordering',()=>{const s=sample();s.progress[0].last_accessed_at=null;s.offerings.push({...s.offerings[0],id:'B'});s.enrollments.push({...s.enrollments[0],offering_id:'B'});s.segmentProgress.push({...s.segmentProgress[0],offering_id:'B'});const r=resumeLearning(s,orgs,now);assert.equal(r.items.map(i=>i.offeringId).join(','),'A,B');assert.equal(JSON.stringify(r),JSON.stringify(resumeLearning(s,orgs,now+1)))});
test('resume: active, unexpired access continues after offering ends by established policy',()=>{const s=sample();s.offerings[0].ends_at='2020-01-01';assert.equal(resumeLearning(s,orgs,now).items.length,1)});
for(const status of ['suspended','cancelled','invited','completed'])test('resume: '+status+' enrollment denied',()=>{const s=sample();s.enrollments[0].status=status;assert.equal(resumeLearning(s,orgs,now).items.length,0)});
test('resume: expiry boundary, future enrollment and malformed access dates fail closed',()=>{for(const change of [{expires_at:new Date(now).toISOString()},{expires_at:'invalid'},{enrolled_at:'invalid'},{enrolled_at:'2030-01-01'}]){const s=sample();Object.assign(s.enrollments[0],change);assert.equal(resumeLearning(s,orgs,now).items.length,0)}});
test('resume: drafts, removal, inactive courses/offerings and tenants are excluded',()=>{for(const action of [s=>s.lessons[0].status='draft',s=>s.lessons=[],s=>s.segments=[],s=>s.courses[0].status='draft',s=>s.offerings[0].status='archived',s=>s.courses[0].organization_id='other',s=>s.segmentProgress[0].lesson_id='different']){const s=sample();action(s);assert.equal(resumeLearning(s,orgs,now).items.length,0)}assert.equal(resumeLearning(sample(),[{id:'org',status:'suspended'}],now).items.length,0)});
test('resume: unpublished-only stale records and orphan progress cannot create links',()=>{const s=sample();s.segments[0].status='draft';assert.equal(resumeLearning(s,orgs,now).items.length,0);s.segmentProgress[0].segment_id='deleted';assert.equal(resumeLearning(s,orgs,now).items.length,0)});
test('resume: incomplete overviews fail visibly rather than claim no progress',()=>{const s=sample();s.limited=true;const r=resumeLearning(s,orgs,now);assert.equal(r.unavailable,true);assert.equal(r.items.length,0)});
test('resume: published parts determine completion, including newly added parts',()=>{const s=sample();s.segmentProgress[0].status='completed';s.progress[0].status='completed';const r=resumeLearning(s,orgs,now).items[0];assert.equal(r.completedParts,1);assert.equal(r.href,'/courses/c/chapters/s2?offering=A');assert.equal(r.position,0)});
test('resume: most recently saved unfinished part wins; completed and draft parts do not',()=>{const s=sample();s.segmentProgress.push({...s.segmentProgress[0],segment_id:'s2',video_position_seconds:90,updated_at:'2026-10-22T11:00:00Z'});assert.equal(resumeLearning(s,orgs,now).items[0].position,90);s.segmentProgress[1].status='completed';assert.equal(resumeLearning(s,orgs,now).items[0].partTitle,'Intro')});
test('resume: the same content in different offerings never shares progress or enrollment',()=>{const s=sample();s.offerings.push({...s.offerings[0],id:'B',name:'Evening'});assert.equal(resumeLearning(s,orgs,now).items.length,1);s.enrollments.push({...s.enrollments[0],offering_id:'B'});assert.equal(resumeLearning(s,orgs,now).items.length,1);s.segmentProgress.push({...s.segmentProgress[0],offering_id:'B',status:'completed'});assert.equal(resumeLearning(s,orgs,now, 'B').items[0].href,'/courses/c/chapters/s2?offering=B');assert.equal(resumeLearning(s,orgs,now,'unknown').items.length,0)});
test('resume repository reads remain bounded, user-bound, read-only and propagate real query errors',async()=>{const calls=[];let error=null,count=0;const q=new Proxy({},{get:(_,method)=>method==='then'?(resolve=>resolve({data:[],error,count})):(...args)=>{calls.push([method,...args]);return q;}});const repo=local('server/repositories/website.ts').createWebsiteRepository({from:table=>{calls.push(['from',table]);return q;}},'verified-self');await repo.progress(['A']);await repo.segmentProgress(['A']);assert.equal(calls.filter(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]==='verified-self').length,2);assert.ok(calls.some(c=>c[0]==='select'&&c[1].includes('last_accessed_at')));assert.ok(calls.some(c=>c[0]==='select'&&c[1].includes('updated_at')));assert.equal(calls.filter(c=>c[0]==='limit').length,2);assert.ok(!calls.some(c=>['insert','update','upsert','rpc'].includes(c[0])));count=1;const incomplete=await repo.segmentProgress(['A']);assert.equal(incomplete.incomplete,true);assert.equal(incomplete.rows.length,0);count=0;error={code:'42501'};await assert.rejects(()=>repo.progress(['A']),/Unable to load learning progress/)});
test('resume target revalidates exact offering course and enrollment before private content access',async()=>{const id='10000000-0000-0000-0000-000000000001',other='20000000-0000-0000-0000-000000000002';let e={status:'active',enrolled_at:null,expires_at:null},o={id,course_id:id,status:'active'};const course={id,organization_id:id,title:'Course',status:'published'};const client={from(table){const q=new Proxy({},{get:(_,method)=>method==='then'?(resolve=>resolve({data:table==='courses'?course:table==='enrollments'?e:o,error:null})):(()=>q)});return q;}};const {learningService}=local('server/services/lessons.ts',{'./lesson-image-validation':{},'@/server/integrations/supabase':{getSupabaseServerClient:async()=>client},'@/server/services/application-auth':{getApplicationViewer:async()=>({id,backend:'firebase'})},'@/server/services/teacher-course':{},'@/shared/contracts/lessons':shared('shared/contracts/lessons.ts'),'@/server/services/lesson-media':{}});const service=await learningService(id);await service.offering(id);for(const change of [{status:'suspended'},{status:'active',expires_at:'2000-01-01'},{status:'active',enrolled_at:'2099-01-01',expires_at:null}]){e={...e,...change};await assert.rejects(()=>service.offering(id),/Active course enrollment required/);}e={status:'active',enrolled_at:null,expires_at:null};o.course_id=other;await assert.rejects(()=>service.offering(id),/Active course enrollment required/)});
test('actual native player restores and clamps saved position; embeds have no claimed native seeking',()=>{const React=require('react'),refs=[];const hooks={...React,useRef:v=>{const r={current:v};refs.push(r);return r;},useState:v=>[v,()=>{}],useCallback:f=>f,useEffect:()=>{}};const{SecureLessonPlayer}=local('frontend/features/courses/lesson/secure-player.tsx',{'@/frontend/components/language-provider':require('./localization-test-loader.cjs').language(),react:hooks,'next/navigation':{useRouter:()=>({})},'@/frontend/components/ui/button':{Button:()=>null},'@/shared/contracts/lessons':shared('shared/contracts/lessons.ts')});const props={courseId:'c',segmentId:'s',url:'https://example.invalid/video.mp4',data:{offeringId:'A',revision:4,position:37,assetId:null,status:'in_progress'}};function find(n,type){if(n?.type===type)return n;for(const c of [n?.props?.children].flat(Infinity)){const v=c&&find(c,type);if(v)return v;}}const tree=SecureLessonPlayer(props);refs[0].current={currentTime:0,duration:100,readyState:1};find(tree,'video').props.onLoadedMetadata();assert.equal(refs[0].current.currentTime,37);refs[0].current.duration=20;find(tree,'video').props.onLoadedMetadata();assert.equal(refs[0].current.currentTime,20);const embed=SecureLessonPlayer({...props,url:'https://youtu.be/abcdef12345'});assert.equal(find(embed,'video'),undefined);assert.ok(find(embed,require('./localization-test-loader.cjs').language().Localized));const unsupported=SecureLessonPlayer({...props,url:'https://unknown.invalid/page'});assert.equal(find(unsupported,'video'),undefined)});

// Review regressions: provider row ceilings and independent content availability.
function scopeRepository(progressRepository) {
 const s=sample();
 return {...progressRepository,courses:async()=>s.courses,course:async()=>s.courses,
  offerings:async()=>s.offerings,modules:async()=>s.modules,myEnrollments:async()=>s.enrollments,
  lessons:async()=>s.lessons,segments:async()=>s.segments,scheduledAssessments:async()=>[{id:'delivery',offering_id:'A',assessment_id:'exam',published:true}],assessments:async()=>[{id:'exam',title:'Authorized exam',type:'exam'}]};
}
function scopeLoader(){return local('server/services/website.ts',{
 react:{cache:f=>f},'@/server/services/application-auth':{},'@/server/integrations/supabase':{getSupabaseServerClient:async()=>({})},'@/server/repositories/website':{},'@/shared/auth-config':{},'@/server/services/lesson-media':{lessonThumbnails:async()=>({})}
}).loadWebsiteScope;}
for(const truncatedTable of ['lesson_progress','lesson_segment_progress'])test('1203 own history rows below requested '+truncatedTable+' limit preserve unrelated overview data',async()=>{
 const calls=[],seed=sample(),history=Array.from({length:1203},(_,i)=>({offering_id:'A',user_id:'verified-self',lesson_id:'20000000-0000-4000-8000-'+String(i).padStart(12,'0'),segment_id:'30000000-0000-4000-8000-'+String(i).padStart(12,'0'),status:'completed',revision:1,video_position_seconds:10,last_accessed_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}));
 const client={from(table){const q=new Proxy({},{get:(_,method)=>method==='then'?(resolve=>resolve({data:table===truncatedTable?history.slice(0,1000):table==='lesson_progress'?seed.progress:seed.segmentProgress,error:null,count:table===truncatedTable?history.length:1})):(...args)=>{calls.push([table,method,...args]);return q}});return q;}};
 const repo=local('server/repositories/website.ts').createWebsiteRepository(client,'verified-self');
 const result=await scopeLoader()({organizations:orgs,repository:scopeRepository(repo)});
 assert.equal(result.contentLimited,false);assert.equal(result.progressLimited,true);assert.equal(result.limited,true);assert.equal(result.progressAvailable,false);
 assert.equal(result.progress.length,0);assert.equal(result.segmentProgress.length,0);
 assert.equal(result.lessons.length,1);assert.equal(result.courses[0].title,'Physics');assert.equal(result.offerings[0].name,'Morning');assert.equal(result.assessments[0].title,'Authorized exam');
 assert.equal(resumeLearning(result,orgs,now).unavailable,true);assert.equal(resumeLearning(result,orgs,now).items.length,0);
 const chapter=shared('shared/v2-learning-model.ts').v2Chapters(result,'A')[0];assert.equal(chapter.progressUnavailable,true);assert.equal(chapter.lessons[0].status,'Open Lesson');assert.equal(chapter.lessons[0].href,'/courses/c/chapters/s1?offering=A');
 assert.equal(calls.filter(c=>c[1]==='limit').length,2);assert.ok(calls.every(c=>c[1]!=='eq'||c[2]!=='user_id'||c[3]==='verified-self'));assert.ok(calls.filter(c=>c[1]==='select').every(c=>c[3].count==='exact'));
});
test('missing count is explicitly incomplete while genuine provider, authorization and network failures reject',async()=>{
 let response={data:[],error:null,count:null},network=false;const client={from(){const q=new Proxy({},{get:(_,method)=>method==='then'?((resolve,reject)=>network?reject(Error('network unavailable')):resolve(response)):(()=>q)});return q;}};
 const repo=local('server/repositories/website.ts').createWebsiteRepository(client,'self');for(const count of [null,NaN,-1,0.5]){response={data:[],error:null,count};const unknown=await repo.progress(['A']);assert.equal(unknown.incomplete,true);assert.equal(unknown.rows.length,0);}
 response={data:null,error:{code:'42501'},count:null};await assert.rejects(()=>repo.progress(['A']),/Unable to load learning progress/);response={data:null,error:{code:'503'},count:null};await assert.rejects(()=>repo.segmentProgress(['A']),/Unable to load learning progress/);network=true;await assert.rejects(()=>repo.progress(['A']),/network unavailable/);
});
test('empty complete progress stays distinguishable from incomplete and empty offerings make no queries',async()=>{
 let calls=0;const client={from(){calls++;const q=new Proxy({},{get:(_,method)=>method==='then'?(resolve=>resolve({data:[],error:null,count:0})):(()=>q)});return q;}};
 const repo=local('server/repositories/website.ts').createWebsiteRepository(client,'self');assert.equal((await repo.progress(['A'])).incomplete,false);await repo.progress([]);await repo.segmentProgress([]);assert.equal(calls,1);
 const result=await scopeLoader()({organizations:orgs,repository:scopeRepository(repo)});assert.equal(result.progressLimited,false);assert.equal(result.contentLimited,false);assert.equal(resumeLearning(result,orgs,now).unavailable,false);
});
test('unavailable progress cannot reuse cached completion and missing-offering guidance remains separate',()=>{
 const s=sample();s.progressAvailable=false;s.segmentProgress[0].status='completed';const chapter=shared('shared/v2-learning-model.ts').v2Chapters(s,'A')[0];assert.equal(chapter.lessons[0].status,'Open Lesson');assert.ok(chapter.lessons[0].chapters.every(c=>!c.isCompleted));delete s.progressAvailable;const catalog=shared('shared/v2-learning-model.ts').v2Chapters(s)[0];assert.equal(catalog.progressAvailable,false);assert.equal(catalog.progressUnavailable,false);
});
test('scope still rejects unrelated provider failures and unauthorized organization selectors',async()=>{
 const repo=scopeRepository({progress:async()=>{throw Error('provider failed')},segmentProgress:async()=>({rows:[],incomplete:false})});await assert.rejects(()=>scopeLoader()({organizations:orgs,repository:repo}),/provider failed/);assert.equal(await scopeLoader()({organizations:orgs,repository:{courses(){assert.fail('Unauthorized query')}}},'other-tenant'),null);
});
test('overview dirty marker coalesces mutations, clears and unsubscribes without storing progress',()=>{
 const f=shared('frontend/features/self-learning/learning-overview-freshness.ts');f.clearLearningOverviewDirty();let events=0;const unsubscribe=f.subscribeLearningOverview(()=>events++);f.markLearningOverviewDirty();f.markLearningOverviewDirty();assert.equal(f.learningOverviewIsDirty(),true);assert.equal(f.learningOverviewServerSnapshot(),false);f.clearLearningOverviewDirty();assert.equal(f.learningOverviewIsDirty(),false);assert.equal(events,3);unsubscribe();f.markLearningOverviewDirty();assert.equal(events,3);f.clearLearningOverviewDirty();
});
test('every acknowledged player save, including completion, invalidates all overview generations',async()=>{
 const f=shared('frontend/features/self-learning/learning-overview-freshness.ts');f.clearLearningOverviewDirty();const React=require('react'),refs=[];let ok=false,refreshes=0;
 const hooks={...React,useRef:v=>{const r={current:v};refs.push(r);return r;},useState:v=>[v,()=>{}],useCallback:fn=>fn,useEffect:()=>{}};
 const{SecureLessonPlayer}=local('frontend/features/courses/lesson/secure-player.tsx',{'@/frontend/components/language-provider':require('./localization-test-loader.cjs').language(),react:hooks,'next/navigation':{useRouter:()=>({refresh:()=>refreshes++})},'@/frontend/components/ui/button':{Button:()=>null},'@/shared/contracts/lessons':shared('shared/contracts/lessons.ts')},{fetch:async()=>({ok,json:async()=>ok?{revision:2,status:'in_progress'}:{error:'Unavailable'}})});
 const tree=SecureLessonPlayer({courseId:'c',segmentId:'s',url:'https://example.invalid/video.webm',data:{offeringId:'A',revision:1,position:5,assetId:null,status:'in_progress'}});
 function find(n,type){if(n?.type===type)return n;for(const c of[n?.props?.children].flat(Infinity)){const v=c&&find(c,type);if(v)return v;}}
 const video=find(tree,'video');refs[0].current={currentTime:0,duration:60,readyState:4};video.props.onLoadedMetadata();refs[0].current.currentTime=8;video.props.onTimeUpdate();await new Promise(setImmediate);assert.equal(f.learningOverviewIsDirty(),false);ok=true;video.props.onPause();await new Promise(setImmediate);assert.equal(f.learningOverviewIsDirty(),true);assert.equal(refreshes,0);video.props.onEnded();await new Promise(setImmediate);assert.equal(refreshes,1);assert.equal(f.learningOverviewIsDirty(),true);
});
test('bounded revision proofs skip refresh only when every acknowledged save is present or newer',()=>{
 const f=shared('frontend/features/self-learning/learning-overview-freshness.ts');f.clearLearningOverviewDirty();f.markLearningOverviewDirty({key:'A:s1',revision:2});f.markLearningOverviewDirty({key:'A:s1',revision:3});f.markLearningOverviewDirty({key:'B:s1',revision:1});
 assert.equal(f.learningOverviewMatches([{key:'A:s1',revision:2},{key:'B:s1',revision:1}]),false);
 assert.equal(f.learningOverviewMatches([{key:'A:s1',revision:3}]),false);
 assert.equal(f.learningOverviewMatches([{key:'A:s1',revision:4},{key:'B:s1',revision:1}]),true);
 assert.equal(f.learningOverviewMatches([{key:'C:s1',revision:99}]),false);
 f.clearLearningOverviewDirty();for(let i=0;i<33;i++)f.markLearningOverviewDirty({key:'A:'+i,revision:1});assert.equal(f.learningOverviewMatches(Array.from({length:33},(_,i)=>({key:'A:'+i,revision:1}))),false);f.clearLearningOverviewDirty();
});
test('server reads carry distinct opaque IDs and bounded revision proofs without changing activity',async()=>{
 const s=sample();const repo=scopeRepository({progress:async()=>({rows:s.progress,incomplete:false}),segmentProgress:async()=>({rows:s.segmentProgress.map(p=>({...p,revision:4})),incomplete:false})});const context={organizations:orgs,repository:repo};
 const first=await scopeLoader()(context),second=await scopeLoader()(context);assert.match(first.progressReadId,/^[0-9a-f-]{36}$/);assert.notEqual(first.progressReadId,second.progressReadId);assert.equal(first.progressReadProofs.length,1);assert.equal(first.progressReadProofs[0].key,'A:s1');assert.equal(first.progressReadProofs[0].revision,4);assert.equal(resumeLearning(first,orgs,now).readId,first.progressReadId);assert.equal(first.progress[0].last_accessed_at,s.progress[0].last_accessed_at);
});

test('generation changes for consecutive acknowledged saves even while already dirty',()=>{
 const f=local('frontend/features/self-learning/learning-overview-freshness.ts');
 const initial=f.learningOverviewGeneration();f.markLearningOverviewDirty({key:'A:s',revision:2});f.markLearningOverviewDirty({key:'A:s',revision:3});
 assert.equal(f.learningOverviewGeneration(),initial+2);assert.equal(f.learningOverviewServerGeneration(),0);
});

function overviewHandler({signedIn=true,scope=null,failure=false,mode=true}={}){
 const calls=[];const value=scope??{...sample(),offerings:[{...sample().offerings[0],id:'10000000-0000-4000-8000-000000000001'}]};
 const handler=local('server/http/learning-overview.ts',{
  '@/shared/auth-config':{isFirebaseStaging:()=>mode},
  '@/server/http/firebase/route':{validFirebaseOrigin:r=>r.headers.get('origin')==='https://portal.example'},
  '@/shared/continue-learning':{resumeLearning:(s,organizations,now,offering)=>{calls.push({s,organizations,offering});return{items:[],unavailable:!!s.limited};}},
  '@/server/services/website':{getWebsiteContext:async()=>signedIn?{viewer:{id:'verified-self'},organizations:orgs}:null,loadWebsiteScope:async(context,organization)=>{calls.push({identity:context.viewer.id,organization});if(failure)throw Error('private provider detail');return organization==='20000000-0000-4000-8000-000000000002'?null:value;}}
 },{Buffer,process:{env:{LMS_DATA_BACKEND:'supabase-staging'}}}).learningOverviewPOST;
 const request=(body={},options={})=>new(require('next/server').NextRequest)('https://portal.example/api/learning-overview'+(options.query??''),{method:'POST',headers:{Origin:options.origin??'https://portal.example','Content-Type':options.mime??'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 return {handler,request,calls};
}
test('scoped overview requires Firebase session and exact origin, is private/no-store and read-only',async()=>{
 for(const options of [{signedIn:false},{mode:false}]){const h=overviewHandler(options),r=await h.handler(h.request());assert.equal(r.status,options.mode===false?404:401);assert.equal(h.calls.length,0);assert.match(r.headers.get('cache-control'),/private, no-store/);}
 const h=overviewHandler();assert.equal((await h.handler(h.request({}, {origin:'https://attacker.example'}))).status,403);assert.equal(h.calls.length,0);
 const id='10000000-0000-4000-8000-000000000001',r=await h.handler(h.request({organizationId:id,offeringId:id}));assert.equal(r.status,200);assert.equal(h.calls[0].identity,'verified-self');assert.equal(h.calls[0].organization,id);assert.equal(h.calls[1].offering,id);assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('overview refuses client identities, foreign scopes, query parameters, excessive bodies and provider failures',async()=>{
 for(const body of [{userId:'peer'},{organizationId:'not-a-uuid'},{offeringId:'20000000-0000-4000-8000-000000000002'}]){const h=overviewHandler(),r=await h.handler(h.request(body));assert.equal(r.status,body.offeringId?403:400);}
 const h=overviewHandler();assert.equal((await h.handler(h.request({organizationId:'20000000-0000-4000-8000-000000000002'}))).status,403);
 assert.equal((await h.handler(h.request({}, {query:'?userId=peer'}))).status,400);assert.equal((await h.handler(h.request('x'.repeat(1025)))).status,413);assert.equal((await h.handler(h.request({}, {mime:'text/plain'}))).status,415);
 const failed=overviewHandler({failure:true}),r=await failed.handler(failed.request());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private provider detail/);
});

test('overview read lifecycle rejects late responses, preserves newer generations and terminates failures without router refresh',async()=>{
 const React=require('react'),f=local('frontend/features/self-learning/learning-overview-freshness.ts'),requests=[];
 const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
 function mount(){let cursor=0,pathname='/home',queued=[],cleanups=[],values=[],dependencies=[];
  const hooks={...React,useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),useEffect:(fn,deps)=>{const i=cursor++;if(!dependencies[i]||deps.some((d,j)=>d!==dependencies[i][j])){dependencies[i]=deps;queued.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
  const {ContinueLearning}=local('frontend/features/self-learning/continue-learning.tsx',{
   react:hooks,'next/navigation':{usePathname:()=>pathname},'@/frontend/components/language-provider':{useLanguage:()=>({t:k=>k,number:n=>n,direction:'ltr'}),L:()=>null},'@/frontend/components/ui/button':{Button:'button'},'@/frontend/features/self-learning/learning-overview-freshness':f,'./learning-overview-freshness':f
  },{AbortController,fetch:(_url,options)=>{const d=deferred();requests.push({...d,options});return d.promise;}});
  const data={items:[],unavailable:false,readId:'cached',proofs:[]};
  return {render(){cursor=0;const tree=ContinueLearning({data,path:'/home'});const run=queued;queued=[];run.forEach(fn=>fn());return tree;},leave(){pathname='/courses/c';this.render();},enter(){pathname='/home';return this.render();}};
 }
 const first=mount();first.render();assert.equal(requests.length,0);
 f.markLearningOverviewDirty({key:'A:s',revision:2});assert.equal(first.render().props.loading,true);assert.equal(requests.length,1);
 f.markLearningOverviewDirty({key:'A:s',revision:3});first.render();assert.equal(requests.length,2);assert.equal(requests[0].options.signal.aborted,true);
 const result={...resumeLearning(sample(),orgs,now),readId:'fresh'};
 requests[1].resolve({ok:true,json:async()=>result});await new Promise(setImmediate);assert.equal(first.render().type,'section');
 requests[0].resolve({ok:true,json:async()=>({items:[],unavailable:true})});await new Promise(setImmediate);assert.equal(first.render().type,'section','older failure cannot replace the newest success');
 const other=mount();assert.equal(other.render().props.loading,true);assert.equal(requests.length,3,'one overview must not consume the other cached page invalidation');
 requests[2].reject(Error('offline'));await new Promise(setImmediate);const error=other.render();assert.equal(error.props.loading,undefined);assert.equal(typeof error.props.retry,'function');
 error.props.retry();other.render();assert.equal(requests.length,4);other.leave();requests[3].resolve({ok:true,json:async()=>result});await new Promise(setImmediate);other.enter();assert.equal(requests.length,5,'navigation back restarts an abandoned read without accepting its stale result');
 requests[4].resolve({ok:true,json:async()=>result});await new Promise(setImmediate);assert.equal(other.render().type,'section');
});
