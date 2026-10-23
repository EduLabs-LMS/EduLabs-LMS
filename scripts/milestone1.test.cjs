const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,deps={},globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:n=>n==='@/frontend/components/language-provider'?require('./localization-test-loader.cjs').language():n in deps?deps[n]:require(n),console,...globals});return module.exports;}
const link=({children,...props})=>React.createElement('a',props,children);
test('Firebase sidebar labels contextual students/staff and places its only bell beside the account',()=>{
 for(const staff of[false,true]){
  const Sidebar=load('frontend/components/sidebar.tsx',{
   'next/link':link,'next/navigation':{usePathname:()=>'/home'},'@/shared/auth-config':{isFirebaseStaging:()=>true},
   '@/frontend/components/providers/application-auth-provider':{useWebsiteNavigation:()=>({staffOrganizationIds:staff?['org']:[]})},
   '@/frontend/components/providers/v2-identity':{useUser:()=>({user:{fullName:'Fictional Student'}}),useClerk:()=>({signOut:()=>{}}),UserButton:()=>React.createElement('button',null,'Account')},
   '@/frontend/features/dashboard/student-preview':{StudentPreviewToggle:()=>null},
   '@/frontend/lib/api':{api:{}},'@/frontend/components/edulabs-mark':()=>null,'@/shared/utils':{cn:(...x)=>x.filter(Boolean).join(' ')},
   '@/frontend/features/notifications/notifications-view':{NotificationBell:()=>React.createElement('button',null,'Notification preview')},
  }).default;
  const html=renderToStaticMarkup(React.createElement(Sidebar));
  assert.match(html,staff?/>STAFF</:/>STUDENT</);assert.doesNotMatch(html,/LEARNER|>Logout</);
  assert.equal((html.match(/Notification preview/g)||[]).length,1);assert.ok(html.indexOf('Notification preview')>html.indexOf('Fictional Student'));assert.match(html,/Sign out/);
  assert.equal(html.includes('Admin &amp; Teacher'),staff);
  assert.match(html,/font-family:&#x27;Times New Roman&#x27;, Times, serif/);
 }
});
test('shared tree mark defaults to its existing black offset shadow and retains explicit opt-out',()=>{
 const Mark=load('frontend/components/edulabs-mark.tsx').default;
 const html=renderToStaticMarkup(React.createElement(Mark,{grow:true}));
 assert.match(html,/translate\(12 12\)/);assert.match(html,/fill="#000000"/);assert.match(html,/fill="#7ed957"/);assert.match(html,/tree-grow/);
 const plain=renderToStaticMarkup(React.createElement(Mark,{shadow:false}));assert.doesNotMatch(plain,/fill="#000000"/);
});
test('notification transport carries cancellation without changing scoped command or permitting recipient fields',async()=>{
 let args;const controller=new AbortController();
 const {communicate}=load('frontend/lib/communications.ts',{}, {fetch:async(...v)=>{args=v;return{ok:true,json:async()=>({rows:[],unread:0})}}});
 await communicate('notifications','list',{filter:'unread',page:0},undefined,{signal:controller.signal});
 assert.equal(args[0],'/api/communications');assert.equal(args[1].signal,controller.signal);assert.equal(args[1].cache,'no-store');
 assert.deepEqual(JSON.parse(args[1].body),{domain:'notifications',action:'list',data:{filter:'unread',page:0}});
});
test('notification transport preserves authorization failures as errors instead of an empty preview',async()=>{
 const {communicate}=load('frontend/lib/communications.ts',{}, {fetch:async()=>({ok:false,status:403,json:async()=>({error:'Permission denied'})})});
 await assert.rejects(communicate('notifications','list',{filter:'unread',page:0}),e=>e.status===403&&e.message==='Permission denied');
});
test('Firebase exam retry refreshes the current server route rather than linking to cached list',()=>{
 let refreshed=0;const {ExamsRetry}=load('frontend/features/exams/exams-retry.tsx',{
  react:{useTransition:()=>[false,fn=>fn()]},'next/navigation':{useRouter:()=>({refresh:()=>{refreshed++}})},'@/frontend/components/ui/button':{Button:'button'},
 });const node=ExamsRetry();node.props.onClick();assert.equal(refreshed,1);assert.equal(node.props.children,'Try again');
});
