// The migration registry: ONE test for what is true of the migrations as a set. A migration's own shape (its transaction, its functions, its
// grants) is checked in its own test file, which never says where the migration sits in the list or what comes after it. A new migration
// needs exactly one new line in scripts/migrations.sha256 (node scripts/lib/migrations.cjs supabase/migrations/<file>.sql >> scripts/migrations.sha256).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const { names, hashes, baseline, manifest } = require('./lib/migrations.cjs');

test('registry: names are unique, sorted, and each starts with its own 14-digit timestamp', () => {
  const all = names();
  assert.ok(all.length > 0);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(all, [...all].sort());
  for (const n of all) assert.match(n, /^\d{14}_[a-z0-9_]+\.sql$/, n);
  const stamps = all.map(n => n.slice(0, 14));
  assert.equal(new Set(stamps).size, stamps.length, 'two migrations share a timestamp');
});

test('registry: every migration is pinned once (31 baseline, the rest in migrations.sha256) and nothing pinned is missing', () => {
  const base = baseline(), list = manifest(), all = names();
  assert.equal(Object.keys(base).length, 31);
  const both = Object.keys(base).filter(n => n in list);
  assert.deepEqual(both, [], 'a migration is pinned in both lists');
  const unpinned = all.filter(n => !(n in base) && !(n in list));
  assert.deepEqual(unpinned, [], 'add ONE line per new migration to scripts/migrations.sha256: node scripts/lib/migrations.cjs supabase/migrations/<file>.sql >> scripts/migrations.sha256');
  const missing = [...Object.keys(base), ...Object.keys(list)].filter(n => !all.includes(n));
  assert.deepEqual(missing, [], 'a pinned migration file is gone or renamed');
  const lines = fs.readFileSync(require('path').join(__dirname, 'migrations.sha256'), 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('  ')[1]);
  assert.deepEqual(lines, [...lines].sort(), 'the manifest is in migration order');
});

test('registry: every pinned migration is byte-identical to its pin (a Windows checkout may convert line endings, the Git blob is what counts)', () => {
  const pins = { ...baseline(), ...manifest() };
  for (const [name, pin] of Object.entries(pins)) {
    const h = hashes(name);
    assert.ok(h.raw === pin || h.lf === pin, name + ' differs from its pin: a migration that was applied is never edited, a new one is a new file');
  }
});
