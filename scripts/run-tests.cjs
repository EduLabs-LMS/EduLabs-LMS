// `npm test`: the unit and route tests, with a limit on how many test files run at once (default 2, so the owner's PC stays responsive).
// Raise it with LMS_TEST_JOBS=N. The list of files is "test:files" in package.json.
const { spawnSync } = require('child_process');
const files = require('../package.json').scripts['test:files'].split(/\s+/).filter(Boolean);
const jobs = Math.max(1, Math.floor(Number(process.env.LMS_TEST_JOBS)) || 2);
const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${jobs}`, ...files, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
