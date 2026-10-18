const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={},globals={}){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,URL,...globals,require:n=>deps[n]??require(n)});return mod.exports;}
const c=load('shared/contracts/lessons.ts');const id='10000000-0000-0000-0000-000000000001';
test('lesson edit contract rejects forged tenant/user fields and invalid status',()=>{
 const v={action:'edit_segment',id,parentId:null,updatedAt:'2026-10-12T00:00:00Z',data:{title:'Part',status:'draft'}};
 assert.equal(c.learningEdit.safeParse(v).success,true);
 for(const x of [{...v,user_id:id},{...v,data:{...v.data,organization_id:id}},{...v,data:{...v.data,status:'public'}},{...v,action:'create_organization'}])assert.equal(c.learningEdit.safeParse(x).success,false);
});
test('supported lesson sources normalize embeds and direct MP4 separately',()=>{
 assert.equal(c.lessonPlayback('https://youtu.be/abcdef12345').url,'https://www.youtube-nocookie.com/embed/abcdef12345');
 assert.equal(c.lessonPlayback('https://www.youtube.com/watch?v=abcdef12345').kind,'embed');
 assert.equal(c.lessonPlayback('https://vimeo.com/123456789').url,'https://player.vimeo.com/video/123456789');
 assert.equal(c.lessonPlayback('https://cdn.example.invalid/file.mp4').kind,'video');
 assert.equal(c.lessonPlayback('https://example.supabase.co/storage/v1/object/sign/lms-course-media/x?token=synthetic').kind,'video');
});
test('unsafe unsupported sources never become iframe or player URLs',()=>{
 for(const url of ['javascript:alert(1)','http://example.invalid/video.mp4','https://a:b@example.invalid/video.mp4','https://evil.invalid/','https://www.youtube.com/embed/<script>'])assert.equal(c.lessonPlayback(url),null);
 for(const url of ['javascript:alert(1)','http://example.invalid/video.mp4','https://a:b@example.invalid/video.mp4','https://evil.invalid/'])assert.equal(c.lessonVideo.safeParse(url).success,false);
});
test('continue selects in-progress then first unfinished within the exact offering',()=>{
 const parts=[{id:'a',position:0,status:'published'},{id:'b',position:1,status:'published'},{id:'draft',position:2,status:'draft'}];
 const progress=[{segment_id:'a',offering_id:'A',status:'completed'},{segment_id:'b',offering_id:'B',status:'completed'}];
 assert.equal(c.continuePart(parts,progress,'A').id,'b');assert.equal(c.continuePart(parts,progress,'B').id,'a');
 assert.equal(c.continuePart(parts,[{segment_id:'b',offering_id:'A',status:'in_progress'}],'A').id,'b');
 assert.equal(c.continuePart([],progress,'A'),undefined);
});
test('real card projection preserves module numbering and offering-specific unfinished links',()=>{
 const model=load('shared/v2-learning-model.ts');const scope={courses:[{id:'course',title:'Course'}],modules:[{id:'m1',course_id:'course',title:'First',position:0},{id:'m2',course_id:'course',title:'Second',position:1}],lessons:[{id:'l1',module_id:'m1',title:'One',status:'published'},{id:'l2',module_id:'m2',title:'Two',status:'published'}],offerings:[{id:'A',course_id:'course',name:'A'}],progress:[],segments:[{id:'p1',lesson_id:'l1',title:'Part',position:0,status:'published'},{id:'p2',lesson_id:'l1',title:'Part 2',position:1,status:'published'}],segmentProgress:[{segment_id:'p1',offering_id:'A',status:'completed'}]};
 const chapters=model.v2Chapters(scope,'A');assert.equal(chapters[0].lessons[0].partsCount,2);assert.equal(chapters[0].lessons[0].href,'/courses/course/chapters/p2?offering=A');assert.equal(chapters[0].lessons[0].status,'In Progress');assert.equal(chapters[1].lessons[0].status,'Locked');assert.equal(chapters[1].lessons[0].href,null);
 scope.segmentProgress=[];assert.equal(model.v2Chapters(scope,'A')[0].lessons[0].status,'Not Started');
});
test('empty parts and wrong-offering completion never invent progress or playable URLs',()=>{
 const model=load('shared/v2-learning-model.ts');const scope={courses:[],modules:[{id:'m',course_id:'c',title:'M',position:0}],lessons:[{id:'l',module_id:'m',title:'L',status:'published'}],offerings:[],progress:[{offering_id:'A',lesson_id:'l',status:'completed'}],segments:[{id:'s',lesson_id:'l',title:'S',position:0,status:'published'}],segmentProgress:[{segment_id:'s',offering_id:'B',status:'completed'}]};
 const l=model.v2Chapters(scope,'A')[0].lessons[0];assert.equal(l.status,'Not Started');assert.equal(l.chapters[0].isCompleted,false);assert.equal(l.imageUrl,null);
});
test('default self-learning cards bind every curriculum group to its actual offering',()=>{
 const model=load('shared/v2-learning-model.ts');const scope={courses:[],modules:[{id:'m',course_id:'c',title:'Week content',position:0,group_type:'Week'}],lessons:[{id:'l',module_id:'m',title:'L',status:'published',cover_url:'https://example.invalid/lesson-cover.png'}],offerings:[{id:'A',course_id:'c',name:'Group A'},{id:'B',course_id:'c',name:'Group B'}],progress:[],segments:[{id:'s',lesson_id:'l',title:'S',position:0,status:'published',thumbnail_url:'https://example.invalid/synthetic.png'}],segmentProgress:[{segment_id:'s',offering_id:'A',status:'completed'}]};
 const groups=model.v2OfferingChapters(scope);assert.equal(groups.length,2);assert.equal(groups[0].type,'Week');assert.equal(groups[0].subtitle,'Group A');assert.equal(groups[0].lessons[0].status,'Completed');assert.equal(groups[1].lessons[0].status,'Not Started');assert.equal(groups[1].lessons[0].href,'/courses/c/chapters/s?offering=B');assert.equal(groups[1].lessons[0].imageUrl,'https://example.invalid/lesson-cover.png');
});
test('URL validation rejects malformed provider links while permitting native WebM',()=>{
 assert.equal(c.lessonVideo.safeParse('https://youtube.com/not-a-video').success,false);assert.equal(c.lessonVideo.safeParse('https://vimeo.com/not-an-id').success,false);assert.equal(c.lessonVideo.safeParse('https://cdn.example.invalid/video.webm').success,true);
});
test('teacher preview renders native video and thumbnail without learner progress controls',()=>{
 const React=require('react'),render=require('react-dom/server').renderToStaticMarkup;
 const {SecureLessonPlayer}=load('frontend/features/courses/lesson/secure-player.tsx',{'@/shared/contracts/lessons':c,'react':React,'next/navigation':{useRouter:()=>({refresh(){}})},'@/frontend/components/ui/button':{Button:p=>React.createElement('button',p)}});
 const props={courseId:id,segmentId:id,url:'https://cdn.example.invalid/video.mp4',data:{offeringId:id,revision:0,position:0,assetId:null,status:'preview',preview:true,thumbnailUrl:'https://cdn.example.invalid/thumbnail.png'}};
 const preview=render(React.createElement(SecureLessonPlayer,props));assert.match(preview,/<video/);assert.match(preview,/poster="https:\/\/cdn.example.invalid\/thumbnail.png"/);assert.doesNotMatch(preview,/Mark part complete|Save progress/);
 const student=render(React.createElement(SecureLessonPlayer,{...props,data:{...props.data,preview:false}}));assert.match(student,/Not Started|Mark part complete/);
});
test('video completion queues behind autosave and refresh does not create an extra revision',async()=>{
 const React=require('react'),requests=[],refs=[];let refreshes=0;
 const hooks={...React,useRef:v=>{const ref={current:v};refs.push(ref);return ref;},useState:v=>[v,()=>{}],useCallback:fn=>fn,useEffect:()=>{}};
 const api=(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve}));
 const {SecureLessonPlayer}=load('frontend/features/courses/lesson/secure-player.tsx',{'@/shared/contracts/lessons':c,'react':hooks,'next/navigation':{useRouter:()=>({refresh:()=>refreshes++})},'@/frontend/components/ui/button':{Button:()=>null}},{fetch:api});
 const tree=SecureLessonPlayer({courseId:id,segmentId:id,url:'https://cdn.example.invalid/video.mp4',data:{offeringId:id,revision:0,position:0,assetId:null,status:'not_started'}});
 function find(node){if(node?.type==='video')return node;for(const child of [node?.props?.children].flat(Infinity)){const match=child&&find(child);if(match)return match;}}
 const player=find(tree);assert.ok(player);refs[0].current={currentTime:10,duration:20};player.props.onTimeUpdate();assert.equal(requests.length,1);
 refs[0].current.currentTime=20;player.props.onTimeUpdate();player.props.onEnded();assert.equal(requests.length,1);
 requests[0].resolve({ok:true,json:async()=>({revision:1,status:'in_progress'})});await new Promise(setImmediate);
 assert.equal(requests.length,2);assert.equal(requests[1].body.complete,true);assert.equal(requests[1].body.revision,1);assert.equal(requests[1].body.position,20);
 requests[1].resolve({ok:true,json:async()=>({revision:2,status:'completed'})});await new Promise(setImmediate);assert.equal(refreshes,1);
 player.props.onPause();assert.equal(requests.length,2);
});
test('file validation checks actual signatures and declared type, including PDF/image limits',()=>{
 assert.equal(c.validLessonFile(Buffer.from('%PDF-1.7\n'), 'application/pdf'),true);
 assert.equal(c.validLessonFile(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true);
 assert.equal(c.validLessonFile(Buffer.from([255,216,255,0]),'image/jpeg'),true);
 assert.equal(c.validLessonFile(Buffer.from('RIFF0000WEBP'),'image/webp'),true);
 assert.equal(c.validLessonFile(Buffer.from('0000ftypisom'),'video/mp4'),true);
 for(const mime of Object.keys(c.lessonFileFormats))assert.equal(c.validLessonFile(Buffer.from('<html>unsafe</html>'),mime),false);
 assert.equal(c.validLessonFile(new Uint8Array(5*1024*1024+1),'image/png'),false);
 assert.equal(c.validLessonFile(new Uint8Array(20*1024*1024+1),'application/pdf'),false);
});
test('existing Supabase blocks retain safe text and scoped resource links without legacy data reads',async()=>{
 const {lessonBlockViews}=load('server/services/lesson-blocks.ts',{'server-only':{}});
 const tree={blocks:[{id:'text',lesson_id:'L',block_type:'text',content:{text:'<p>Actual notes</p>'},media_asset_id:null},{id:'pdf',lesson_id:'L',block_type:'pdf',content:{title:'Actual PDF'},media_asset_id:'media'},{id:'foreign',lesson_id:'Other',block_type:'text',content:{text:'Hidden'},media_asset_id:null}]};
 const views=await lessonBlockViews(tree,'L','C',async()=>assert.fail('PDF link must authorize on each open'));
 assert.equal(views.length,2);assert.equal(views[0].text,'Actual notes');assert.equal(views[1].downloadUrl,'/api/learning/C/blocks/pdf');
});
