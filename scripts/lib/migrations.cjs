// The one place that knows how to list and hash migrations. Tests that check ONE migration's own shape read it through here and never
// say where it sits in the list or what comes after it; the registry test (scripts/migrations-registry.test.cjs) keeps the list honest.
// The manifest (scripts/migrations.sha256) is a plain list, one `<sha256>  <file name>` line per migration (the format of sha256sum),
// so a new migration is exactly one new line:
//   node scripts/lib/migrations.cjs supabase/migrations/<file>.sql >> scripts/migrations.sha256
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = 'supabase/migrations';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
/** Every migration file name, sorted the way they are applied. */
const names = () => fs.readdirSync(DIR).filter(n => n.endsWith('.sql')).sort();
/** The hash of the file as stored and of its LF form (the Git blob): a Windows checkout may have converted line endings. */
const hashes = name => {
  const raw = fs.readFileSync(path.join(DIR, name));
  return { raw: sha256(raw), lf: sha256(Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')) };
};
/** The 31 migrations of the approved staging baseline, pinned in scripts/baseline-migrations.json. */
const baseline = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'baseline-migrations.json'), 'utf8'));
/** Every migration after the baseline, pinned in scripts/migrations.sha256: { name: sha256 }. */
const manifest = () => {
  const out = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', 'migrations.sha256'), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = line.match(/^([0-9a-f]{64}) {2}(\S+\.sql)$/);
    if (!m) throw new Error('Bad manifest line: ' + line);
    if (m[2] in out) throw new Error('Listed twice in the manifest: ' + m[2]);
    out[m[2]] = m[1];
  }
  return out;
};
const manifestLine = name => `${hashes(name).lf}  ${name}`;

module.exports = { DIR, names, hashes, baseline, manifest, manifestLine, sha256 };
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node scripts/lib/migrations.cjs <migration file>'); process.exit(2); }
  console.log(manifestLine(path.basename(arg)));
}
