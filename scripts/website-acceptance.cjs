// Opt-in DEVELOPMENT acceptance: creates only uniquely named disposable Firebase users.
// SQL fixture installation/removal is reviewed and executed separately via Supabase MCP.
// Tokens/passwords stay under ignored .local/. Never run against production data.
require('@next/env').loadEnvConfig(process.cwd());
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const root = path.resolve('.local/website-acceptance');
const manifestPath = path.join(root, 'manifest.json');
const base = process.env.WEBSITE_ACCEPTANCE_URL || 'http://localhost:3111';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local acceptance server required');
assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'diagonproduction');
assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('gmvouqgjbtbkbhrdruzu.supabase.co'));
fs.mkdirSync(root, { recursive: true });
const save = state => fs.writeFileSync(manifestPath, JSON.stringify(state, null, 2));
const q = value => `'${String(value).replaceAll("'", "''")}'`;
async function firebase(method, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await res.json(); assert.equal(res.status, 200, `Firebase ${method} failed`); return data;
}
async function appPost(action, token) {
  const res = await fetch(`${base}/api/auth/firebase/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(60000) });
  const data = await res.json(); assert.equal(res.status, 200, `LMS ${action} failed`); return data;
}
function fixtureSql(state) {
  const i = state.ids, a = state.actors;
  const memberships = [['orgA', 'teacher', 'teacher'], ['orgA', 'owner', 'admin'], ['orgB', 'teacher', 'admin']];
  return `begin;
insert into public.organizations(id,name,slug) values (${q(i.orgA)},'Phase1 Physics A',${q('phase1-'+i.orgA)}),(${q(i.orgB)},'Phase1 Physics B',${q('phase1-'+i.orgB)});
insert into public.organization_memberships(organization_id,user_id,role,status) values ${memberships.map(([org, role, actor]) => `(${q(i[org])},${q(a[actor].profileId)},${q(role)},'active')`).join(',')};
insert into public.courses(id,organization_id,title,slug,status) values (${q(i.courseA)},${q(i.orgA)},'Phase1 Course A','course-a','published'),(${q(i.courseB)},${q(i.orgB)},'Phase1 Course B','course-b','published');
insert into public.course_staff(course_id,user_id,role) values (${q(i.courseA)},${q(a.teacher.profileId)},'instructor'),(${q(i.courseB)},${q(a.admin.profileId)},'instructor');
insert into public.course_modules(id,course_id,title,position) values (${q(i.moduleA)},${q(i.courseA)},'Phase1 Electricity',0),(${q(i.moduleB)},${q(i.courseB)},'Phase1 Mechanics',0);
insert into public.lessons(id,module_id,title,position,status) values (${q(i.lessonA)},${q(i.moduleA)},'Phase1 Ohm law',0,'published'),(${q(i.draft)},${q(i.moduleA)},'Phase1 Secret Draft',1,'draft'),(${q(i.lessonB)},${q(i.moduleB)},'Phase1 Newton law',0,'published');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values (${q(i.runA)},${q(i.courseA)},'Phase1 Group A','blended','active'),(${q(i.runA2)},${q(i.courseA)},'Phase1 Group A2','scheduled','active'),(${q(i.runB)},${q(i.courseB)},'Phase1 Group B','self_paced','active');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values (${q(i.runA)},${q(a.student.profileId)},'active',now()),(${q(i.runA2)},${q(a.other.profileId)},'active',now()),(${q(i.runB)},${q(a.other.profileId)},'active',now()),(${q(i.runA)},${q(a.suspended.profileId)},'suspended',now());
insert into public.lesson_progress(offering_id,lesson_id,user_id,status,completed_at) values (${q(i.runA)},${q(i.lessonA)},${q(a.student.profileId)},'completed',now()),(${q(i.runA2)},${q(i.lessonA)},${q(a.other.profileId)},'in_progress',null);
insert into public.assessments(id,course_id,title,type,status,created_by) values (${q(i.assessment)},${q(i.courseA)},'Phase1 Quiz','quiz','published',${q(a.teacher.profileId)});
insert into public.assessment_questions(id,assessment_id,question_type,prompt,points,position) values (${q(i.question)},${q(i.assessment)},'single_choice','Phase1 question',1,0);
insert into public.assessment_options(id,question_id,text,position,is_correct) values (${q(i.option)},${q(i.question)},'Phase1 correct',0,true);
insert into public.offering_assessments(id,offering_id,assessment_id,published) values (${q(i.scheduled)},${q(i.runA)},${q(i.assessment)},true);
commit;`;
}
function cleanupSql(state) {
  const i = state.ids, profiles = Object.values(state.actors).map(a => a.profileId).filter(Boolean);
  return `begin;
delete from public.offering_assessments where id=${q(i.scheduled)};
delete from public.assessment_options where id=${q(i.option)};
delete from public.assessment_questions where id=${q(i.question)};
delete from public.assessments where id=${q(i.assessment)};
delete from public.lesson_progress where offering_id in (${[i.runA,i.runA2,i.runB].map(q)});
delete from public.enrollments where offering_id in (${[i.runA,i.runA2,i.runB].map(q)});
delete from public.course_offerings where id in (${[i.runA,i.runA2,i.runB].map(q)});
delete from public.lessons where id in (${[i.lessonA,i.lessonB,i.draft].map(q)});
delete from public.course_modules where id in (${[i.moduleA,i.moduleB].map(q)});
delete from public.course_staff where course_id in (${[i.courseA,i.courseB].map(q)});
delete from public.courses where id in (${[i.courseA,i.courseB].map(q)});
delete from public.organizations where id in (${[i.orgA,i.orgB].map(q)});
${profiles.length ? `delete from private.external_identities where profile_id in (${profiles.map(q)});\ndelete from public.profiles where id in (${profiles.map(q)});` : ''}
commit;`;
}
async function prepare() {
  assert.ok(!fs.existsSync(manifestPath), 'Existing fixture manifest: clean up before creating another run');
  const state = { actors: {}, ids: Object.fromEntries(['orgA','orgB','courseA','courseB','moduleA','moduleB','lessonA','lessonB','draft','runA','runA2','runB','assessment','question','option','scheduled'].map(k => [k, crypto.randomUUID()])) };
  save(state);
  const app = initializeApp({ projectId: 'diagonproduction', credential: applicationDefault() });
  try {
    const admin = getAuth(app);
    for (const name of ['student', 'other', 'teacher', 'admin', 'suspended', 'empty']) {
      const email = `codex-phase1-${crypto.randomUUID()}@example.invalid`, password = crypto.randomBytes(32).toString('base64url');
      const user = await admin.createUser({ email, password, emailVerified: true, displayName: `Phase1 ${name}` });
      state.actors[name] = { uid: user.uid, email, password }; save(state);
      let login = await firebase('signInWithPassword', { email, password, returnSecureToken: true });
      await appPost('provision', login.idToken);
      login = await firebase('signInWithPassword', { email, password, returnSecureToken: true });
      state.actors[name].idToken = login.idToken;
      const { profileId } = await appPost('session', login.idToken);
      assert.ok(profileId); state.actors[name].profileId = profileId; save(state);
    }
    fs.writeFileSync(path.join(root, 'fixtures.sql'), fixtureSql(state));
    console.log('Six disposable Firebase accounts provisioned and onboarded. SQL fixtures prepared; not installed.');
  } finally { fs.writeFileSync(path.join(root, 'cleanup.sql'), cleanupSql(state)); await deleteApp(app); }
}
async function cleanupAuth() {
  const state = JSON.parse(fs.readFileSync(manifestPath));
  const app = initializeApp({ projectId: 'diagonproduction', credential: applicationDefault() });
  try { for (const actor of Object.values(state.actors)) {
    try { await getAuth(app).deleteUser(actor.uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    await assert.rejects(getAuth(app).getUser(actor.uid), error => error.code === 'auth/user-not-found');
  } }
  finally { await deleteApp(app); }
  // Keep only a non-secret record of fixture IDs after confirmed cleanup.
  save({ ids: state.ids, actors: Object.fromEntries(Object.entries(state.actors).map(([name,a]) => [name,{uid:a.uid,profileId:a.profileId}])), firebaseUsersDeleted: true });
  console.log('All disposable Firebase accounts deleted; local credentials erased from manifest.');
}
async function browsers() {
  const state = JSON.parse(fs.readFileSync(manifestPath));
  for (const actor of Object.values(state.actors)) { const login = await firebase('signInWithPassword', { email: actor.email, password: actor.password, returnSecureToken: true }); actor.idToken = login.idToken; }
  save(state);
  const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const report = { realAuthenticated: true, checks: [], browsers: [], exceptions: [] };
  const check = name => { report.checks.push(name); console.log(name); };
  const i = state.ids;
  async function data(actor, table, query, options = {}) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, { ...options, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${state.actors[actor].idToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, signal: AbortSignal.timeout(20000) });
    return { status: res.status, body: await res.json() };
  }
  for (const [actor, table, query] of [
    ['student','courses',`select=id&id=eq.${i.courseB}`], ['student','course_offerings',`select=id&id=eq.${i.runA2}`],
    ['student','lesson_progress',`select=user_id&user_id=eq.${state.actors.other.profileId}`],
    ['student','enrollments',`select=user_id&user_id=eq.${state.actors.other.profileId}`],
    ['student','lessons',`select=id&id=eq.${i.draft}`], ['teacher','courses',`select=id&id=eq.${i.courseB}`],
    ['teacher','enrollments',`select=id&offering_id=eq.${i.runB}`], ['suspended','course_offerings',`select=id&id=eq.${i.runA}`],
  ]) {
    const res = await data(actor,table,query); assert.equal(res.status,200); assert.equal(res.body.length,0); check(`Real JWT RLS: ${actor} denied ${table} outside authorization`);
  }
  const keys = await data('student','assessment_options',`select=is_correct&question_id=eq.${i.question}`);
  assert.ok([401,403].includes(keys.status)); check('Real student JWT cannot read answer-key column');
  const write = await data('student','courses',`id=eq.${i.courseA}`, { method: 'PATCH', body: JSON.stringify({title:'Unauthorized overwrite'}) });
  assert.ok([401,403].includes(write.status) || (write.status===200 && write.body.length===0));
  assert.equal((await data('student','courses',`select=title&id=eq.${i.courseA}`)).body[0].title,'Phase1 Course A'); check('Real student JWT cannot modify teacher content');
  assert.equal((await data('teacher','enrollments',`select=id&offering_id=eq.${i.runA}`)).body.length,2); check('Assigned instructor sees authorized roster');
  assert.equal((await data('admin','courses',`select=id&id=in.(${i.courseA},${i.courseB})`)).body.length,2); check('Organization owner A and instructor B sees both contextual courses');
  for (const [engineName, engine] of Object.entries({chromium,firefox,webkit}).filter(([name]) => !process.env.WEBSITE_BROWSER || process.env.WEBSITE_BROWSER === name)) {
    const browser = await engine.launch({headless:true}); report.browsers.push({engine:engineName,version:browser.version()});
    try {
      for (const name of ['student','teacher','admin','suspended','empty']) {
        const ctx = await browser.newContext({ignoreHTTPSErrors: new URL(base).protocol === 'https:', viewport: {width:name==='empty'?390:1280,height:name==='empty'?844:900}});
        const page = await ctx.newPage(); page.on('pageerror',error=>report.exceptions.push({engine:engineName,actor:name,message:error.message}));
        page.on('console',message=>{ if(message.type()==='error' && /hydration|hydrated|server rendered|did not match|Minified React error/i.test(message.text())) report.exceptions.push({engine:engineName,actor:name,message:message.text()}); });
        await page.goto(base+'/sign-in');
        await page.getByLabel('Email',{exact:true}).fill(state.actors[name].email);
        await page.getByLabel('Password',{exact:true}).fill(state.actors[name].password);
        await page.getByRole('button',{name:'Sign in',exact:true}).click();
        // Both the auth observer and submit completion can navigate to Home.
        // Wait for settled location rather than treating an interrupted load as failure.
        try { await page.waitForFunction(()=>window.location.pathname==='/home',null,{timeout:60000}); await page.waitForLoadState('networkidle'); } catch(error) { console.error(JSON.stringify({engine:engineName,actor:name,status:await page.getByRole('status').allTextContents().catch(()=>['Navigation still in progress'])})); await page.screenshot({path:path.join(root,`${engineName}-${name}-failure.png`),fullPage:true}).catch(()=>{});throw error; }
        await page.getByText('LIFE OF PHYSICS',{exact:true}).filter({visible:true}).first().waitFor();
        if (name === 'student') {
          await page.getByText('Phase1 Course A · Phase1 Group A',{exact:true}).first().waitFor();
          assert.equal(await page.getByText('Phase1 Course B',{exact:true}).count(),0);
          for(const route of ['/self-learning','/group',`/courses/${i.courseA}?offering=${i.runA}`,`/offerings/${i.runA}`]) { const res=await page.goto(base+route); assert.equal(res.status(),200); }
          assert.equal(await page.getByText('Phase1 other',{exact:true}).count(),0);
          for (const route of [`/courses/${i.courseB}`,`/offerings/${i.runA2}`]) { const res=await page.goto(base+route); assert.ok([200,404].includes(res.status())); await page.getByRole('heading',{name:'404',exact:true}).waitFor(); }
          await page.goto(base+'/home'); await page.reload(); await page.getByText('Phase1 Course A · Phase1 Group A',{exact:true}).first().waitFor();
          await page.screenshot({path:path.join(root,`${engineName}-student-home.png`),fullPage:true});
          const logout = page.getByRole('button',{name:'Logout',exact:true}).filter({visible:true}); await logout.click(); await page.waitForURL(base+'/sign-in');
          await page.goto(base+'/home'); await page.waitForURL(base+'/sign-in');
          check(`${engineName}: real student sign-in, original shell, course/offering access, isolation, refresh, logout`);
        } else if(name==='teacher' || name==='admin') {
          await page.getByText('Teaching Overview',{exact:true}).waitFor();
          await page.goto(base+'/self-learning'); await page.getByRole('heading',{name:'Lesson Management'}).waitFor();
          const response = await page.goto(base+`/offerings/${i.runA}`); assert.equal(response.status(),200);
          await page.getByText('Phase1 student',{exact:true}).waitFor();
          if(name==='teacher') { const denied=await page.goto(base+`/offerings/${i.runB}`);assert.ok([200,404].includes(denied.status()));await page.getByRole('heading',{name:'404',exact:true}).waitFor(); }
          if(name==='admin') { await page.goto(base+`/home?organization=${i.orgB}`);await page.getByText('Teaching Overview',{exact:true}).waitFor(); }
          check(`${engineName}: real ${name} dashboard and authorized roster`);
        } else {
          assert.equal(await page.getByText('Phase1 Course A · Phase1 Group A',{exact:true}).count(),0);
          assert.equal(await page.getByText('Teaching Overview',{exact:true}).count(),0);
          if(name==='empty') await page.screenshot({path:path.join(root,`${engineName}-empty-mobile.png`),fullPage:true});
          check(`${engineName}: real ${name} account has no unauthorized course access`);
        }
        await page.waitForLoadState('networkidle');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1), `${engineName} ${name}: horizontal overflow`);
        await ctx.close();
      }
    } finally { await browser.close();fs.writeFileSync(path.join(root,process.env.WEBSITE_BROWSER ? `report-${process.env.WEBSITE_BROWSER}.json` : 'report.json'),JSON.stringify(report,null,2)); }
  }
  assert.equal(report.exceptions.length,0,'Browser JavaScript exceptions');
  console.log(JSON.stringify({realAuthenticated:true,passed:report.checks.length,browsers:report.browsers,exceptions:report.exceptions.length}));
}
const action = process.argv[2];
({prepare,browsers,'cleanup-auth':cleanupAuth,'cleanup-sql':async()=>fs.writeFileSync(path.join(root,'cleanup.sql'),cleanupSql(JSON.parse(fs.readFileSync(manifestPath))))}[action] || (()=>{throw Error('Use prepare, browsers, cleanup-sql, or cleanup-auth')}))().catch(error=>{ let message = String(error.message); if(fs.existsSync(manifestPath)) { const state=JSON.parse(fs.readFileSync(manifestPath)); for(const a of Object.values(state.actors)) for(const key of ['password','idToken','email']) if(a[key]) message=message.replaceAll(a[key],'[redacted]'); } console.error('Acceptance failed: '+message);process.exitCode=1; });
