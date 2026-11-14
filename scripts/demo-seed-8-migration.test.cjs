// The shape of migration 20261116120000_demo_seed_8_and_notice_links.sql (its behaviour is supabase/tests/demo-seed-8.sql).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const file = 'supabase/migrations/20261116120000_demo_seed_8_and_notice_links.sql';
const sql = fs.readFileSync(file, 'utf8');
const code = sql.replace(/--.*$/gm, '');
test('the file: LF only, pinned as text, one transaction', () => {
 assert.equal(sql.includes('\r'), false);
 assert.match(fs.readFileSync('.gitattributes', 'utf8'), /^supabase\/migrations\/20261116120000_demo_seed_8_and_notice_links\.sql -text\s*$/m);
 assert.equal((code.match(/^begin;/gm) || []).length, 1); assert.equal((code.match(/^commit;/gm) || []).length, 1);
});
test('it replaces exactly the fill, the status and the notice link, and creates nothing else', () => {
 const names = [...code.matchAll(/create or replace function ([a-z_.]+)\(/g)].map(m => m[1]);
 assert.deepEqual(names, ['private.demo_fill_core', 'private.platform_demo_status', 'private.notification_link']);
 assert.doesNotMatch(code, /create (table|function|index|trigger|policy)|alter table|drop |grant |revoke /i);
 assert.doesNotMatch(code, /auth\.uid\(\)/);
 assert.equal((code.match(/set search_path=''/g) || []).length, 3);
});
test('(a) the day is a wall time and the seed version is 8 everywhere in it', () => {
 assert.match(code, /v_day timestamp;/); assert.doesNotMatch(code, /v_day timestamptz/);
 assert.deepEqual([...code.matchAll(/seed_version=(\d+)/g)].map(m => m[1]), ['8']);
 assert.deepEqual([...code.matchAll(/'seedVersion',(\d+)/g)].map(m => m[1]), ['8', '8']);
 assert.deepEqual([...code.matchAll(/'latestSeedVersion',(\d+)/g)].map(m => m[1]), ['8', '8']);
});
test('(b) the only new link is the lesson page, for a published lesson with no part, and only for homework_released', () => {
 const added = code.match(/if part is null and off is not null and e\.event_type='homework_released'[^;]*;[^;]*;/)[0];
 assert.match(added, /x\.status='published'/); assert.match(added, /'\/courses\/'\|\|course\|\|'\/lessons\/'\|\|l\.id\|\|'\?offering='\|\|off/);
 assert.equal((code.match(/\/lessons\//g) || []).length, 1);
});
