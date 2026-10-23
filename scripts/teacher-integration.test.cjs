// Application-boundary tests with synthetic identities/scopes, not provider acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript'),React=require('react');
const {load:shared}=require('./localization-test-loader.cjs');
const c='10000000-0000-0000-0000-000000000001',org='10000000-0000-0000-0000-000000000002';
const StudentLearning=()=>null;
function scope(){return{limited:false,contentLimited:false,progressLimited:false,progressAvailable:true,courses:[{id:c,organization_id:org,title:'Physics',status:'published'}],offerings:[{id:'A',course_id:c,name:'Active',status:'active',delivery_mode:'live'},{id:'D',course_id:c,name:'Draft offering',status:'draft',delivery_mode:'live'}],enrollments:[{offering_id:'A',status:'active',enrolled_at:null,expires_at:null}],modules:[{id:'m',course_id:c,title:'Module',position:0}],lessons:[{id:'l',module_id:'m',title:'Lesson',status:'published',position:0}],segments:[{id:'s',lesson_id:'l',title:'Part',position:0,status:'published'}],progress:[{offering_id:'A',lesson_id:'l',status:'in_progress',last_accessed_at:'2026-10-22T00:00:00Z'}],segmentProgress:[{offering_id:'A',lesson_id:'l',segment_id:'s',status:'in_progress',video_position_seconds:9,updated_at:'2026-10-22T00:00:00Z'}],scheduled:[],assessments:[]};}
function pages(value,{role='student',cookie=false}={}){
 const context={viewer:{id:'synthetic',displayName:'Synthetic'},organizations:[{id:org,status:'active'}],memberships:role==='student'?[]:[{role,status:'active',organization_id:org}],courseStaff:[],offeringStaff:[]};
 const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/(dashboard)/_components/website-pages.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:n=>{
  if(n==='@/server/services/website')return{getWebsiteContext:async()=>context,loadWebsiteScope:async()=>value,courseCapability:()=>false,offeringCapability:()=>false};
  if(n==='next/headers')return{cookies:async()=>({get:()=>cookie?{value:'1'}:undefined})};
  if(n==='next/navigation')return{notFound:()=>{throw Error('404')},redirect:()=>{throw Error('Redirect')}};
  if(n==='next/link')return p=>React.createElement('a',p);
  if(n==='@/frontend/features/self-learning/student-learning')return{StudentLearning};
  if(n==='@/frontend/components/language-provider')return require('./localization-test-loader.cjs').language();
  if(n==='react/jsx-runtime')return require(n);
  if(n.startsWith('@/shared/'))return shared(n.slice(2)+'.ts');
  return new Proxy({},{get:()=>()=>null});
 }});return m.exports;
}
function find(node,type){if(node?.type===type)return node;for(const child of [node?.props?.children].flat(Infinity)){const found=child&&find(child,type);if(found)return found;}}
test('merged Home and Self Learning retain actual resume projection for students; forged preview cookie is ignored',async()=>{
 for(const cookie of [false,true]){const p=pages(scope(),{cookie});for(const tree of [await p.WebsiteHome({}),await p.WebsiteCourses({})]){const props=find(tree,StudentLearning).props;assert.equal(props.resume.unavailable,false);assert.equal(props.resume.items.length,1);assert.equal(props.resume.items[0].href,`/courses/${c}/chapters/s?offering=A`);}}
});
test('merged teacher preview hides drafts and does not fabricate Continue Learning activity',async()=>{
 const p=pages(scope(),{role:'owner',cookie:true});const home=find(await p.WebsiteHome({}),StudentLearning).props;assert.equal(home.resume,undefined);assert.equal(home.offerings.length,1);assert.equal(home.offerings[0].id,'A');const learning=find(await p.WebsiteCourses({preview:true}),StudentLearning).props;assert.equal(learning.resume,undefined);assert.equal(learning.offerings.length,1);
});
test('course preview rejects a draft offering and does not render its descriptor',async()=>{
 const p=pages(scope(),{role:'owner',cookie:true});await assert.rejects(()=>p.WebsiteCourse({courseId:c,search:{offering:'D'}}),/404/);const html=require('react-dom/server').renderToStaticMarkup(await p.WebsiteCourse({courseId:c}));assert.doesNotMatch(html,/Draft offering/);assert.match(html,/Active/);
});
test('progress truncation keeps the new student composition useful but resume unavailable',async()=>{
 const value={...scope(),limited:true,progressLimited:true,progressAvailable:false,progress:[],segmentProgress:[]};const p=pages(value);for(const tree of [await p.WebsiteHome({}),await p.WebsiteCourses({})]){const props=find(tree,StudentLearning).props;assert.equal(props.resume.unavailable,true);assert.equal(props.limited,true);assert.ok(props.home?props.lessons.length:props.chapters.length);}
});
