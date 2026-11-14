// Synthetic answers for /api/teacher/reports/* in the browser harnesses (fictional names, fictional numbers; no real record).
// `reportsServe(url, state)` returns { status, body } for a reports route, or null for any other path.
// state.mode: 'normal' (default) | 'empty' (nothing to show) | 'fail' (every read fails 503) | 'fail-once' (each route fails its first read, then answers).
// state.delay: milliseconds to wait before answering (the harness uses it to look at the loading state); the caller applies it.
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const range = month => ({ month: month || '2026-11', timezone: 'Africa/Cairo', from: '2026-10-31T22:00:00.000Z', to: '2026-11-30T22:00:00.000Z' });
const seen = new Set();
const line = (n, name, att, hw, ex, reasons) => ({ userId: uuid(7000 + n), name, attendance: { pct: att, present: att === null ? 0 : Math.round(att / 25), total: att === null ? 0 : 4 }, homework: { done: hw[0], given: hw[1], missing: hw[1] - hw[0] }, exams: { pct: ex, count: ex === null ? 0 : 1, absent: 0 }, reasons });
const attention = [
  line(1, 'Layla Synthetic', 50, [1, 4], 40, [{ code: 'missed_sessions', n: 2 }, { code: 'homework_missing', n: 3 }, { code: 'exams_low', pct: 40 }]),
  line(2, 'Omar Synthetic', 75, [3, 4], null, [{ code: 'exam_absent', title: 'Chapter 1 exam' }]),
];
const everyone = [line(3, 'Nour Synthetic', 100, [4, 4], 90, []), line(4, 'Karim Synthetic', 75, [3, 4], 80, []), line(5, 'Salma Synthetic', 100, [4, 4], 70, [])];

function body(path, query, mode) {
  const empty = mode === 'empty';
  if (path === '/api/teacher/reports/groups') {
    return { ...range(), groups: String(query.get('groups') || '').split(',').filter(Boolean).map((id, i) => empty || i % 3 === 2
      ? { groupId: id, hasNumbers: false, attendance: { pct: null, present: 0, total: 0 }, homework: { pct: null, done: 0, given: 0 }, exams: { pct: null, count: 0 }, attention: 0 }
      : { groupId: id, hasNumbers: true, attendance: { pct: 91, present: 10, total: 11 }, homework: { pct: 84, done: 21, given: 25 }, exams: { pct: 72, count: 2 }, attention: i % 3 === 0 ? 2 : 0 }) };
  }
  if (/^\/api\/teacher\/reports\/groups\/[^/]+$/.test(path)) {
    return { ...range(query.get('month')), firstMonth: '2026-08', group: { id: path.split('/').pop(), name: 'Synthetic group' },
      summary: empty ? { attendance: { pct: null, sessions: 0 }, homework: { pct: null, given: 0 }, exams: { pct: null, count: 0 } } : { attendance: { pct: 91, sessions: 8 }, homework: { pct: 84, given: 6 }, exams: { pct: 72, count: 2 } },
      attentionTotal: empty ? 0 : attention.length, attention: empty ? [] : attention, everyoneTotal: empty ? 0 : everyone.length, everyone: empty ? [] : everyone };
  }
  if (path === '/api/teacher/reports/attention') {
    const rows = empty ? [] : attention.map((l, i) => ({ userId: l.userId, name: l.name, offeringId: uuid(101), courseTitle: 'Synthetic Maths', group: i === 0 ? { id: uuid(301), name: 'Synthetic group' } : null, reasons: l.reasons }));
    return { ...range(), page: Number(query.get('page') || 0), pageSize: 25, total: rows.length, rows };
  }
  if (/^\/api\/teacher\/reports\/students\/[^/]+$/.test(path)) {
    const days = [2, 5, 9, 12, 16, 19];
    return { ...range(query.get('month')), firstMonth: '2026-08', groups: [{ id: uuid(301), name: 'Synthetic group' }],
      attendance: empty ? { pct: null, present: 0, total: 0 } : { pct: 67, present: 4, total: 6 }, homework: empty ? { done: 0, given: 0, missing: 0, avgPct: null } : { done: 2, given: 3, missing: 1, avgPct: 80 },
      exams: empty ? { pct: null, count: 0, absent: 0 } : { pct: 72, count: 2, absent: 1 },
      sessions: empty ? [] : days.map((d, i) => ({ id: uuid(8000 + i), groupId: uuid(301), day: d, date: '2026-11-' + String(d).padStart(2, '0'), state: i === 1 || i === 4 ? 'absent' : 'present' })),
      homeworkList: empty ? [] : [
        { id: uuid(8100), title: 'Ohm practice', groupId: uuid(301), state: 'done', score: 9, max: 10, detail: 'released', dueAt: '2026-11-03T20:00:00.000Z' },
        { id: uuid(8101), title: 'Series and parallel', groupId: uuid(301), state: 'missing', score: null, max: null, detail: null, dueAt: '2026-11-06T20:00:00.000Z' },
        { id: uuid(8102), title: 'Right-hand rule', groupId: uuid(301), state: 'done', score: null, max: null, detail: 'waiting', dueAt: '2026-11-09T20:00:00.000Z' },
        { id: uuid(8103), title: 'Magnetic field', groupId: uuid(301), state: 'open', score: null, max: null, detail: null, dueAt: '2026-11-29T20:00:00.000Z' }],
      examList: empty ? [] : [
        { id: uuid(8200), title: 'Chapter 1 exam', groupId: uuid(301), state: 'marked', score: 36, max: 40, kind: 'paper', at: '2026-11-04T10:00:00.000Z' },
        { id: uuid(8201), title: 'Quiz in class', groupId: uuid(301), state: 'marked', score: 11, max: 20, kind: 'online', at: '2026-11-11T10:00:00.000Z' },
        { id: uuid(8202), title: 'Chapter 2 exam', groupId: uuid(301), state: 'absent', score: null, max: null, kind: 'paper', at: '2026-11-18T10:00:00.000Z' }] };
  }
  if (/^\/api\/teacher\/reports\/courses\/[^/]+$/.test(path)) {
    const g = [{ id: uuid(301), name: 'Synthetic group' }, { id: uuid(302), name: 'Online group' }];
    return { ...range(query.get('month')), firstMonth: '2026-08', groups: g, chapters: empty ? [] : [
      { id: uuid(401), number: 1, title: 'Electric current', exams: 2, homework: 3, pct: 82, weakest: false, groups: [{ groupId: uuid(301), pct: 88, marks: 6 }, { groupId: uuid(302), pct: 74, marks: 5 }] },
      { id: uuid(402), number: 2, title: 'Magnetism', exams: 1, homework: 2, pct: 48, weakest: true, groups: [{ groupId: uuid(301), pct: 52, marks: 4 }, { groupId: uuid(302), pct: 41, marks: 3 }] },
      { id: uuid(403), number: 3, title: 'Induction', exams: 0, homework: 0, pct: null, weakest: false, groups: [] }] };
  }
  return null;
}

module.exports = function reportsServe(url, state = {}) {
  if (!url.pathname.startsWith('/api/teacher/reports/')) return null;
  const mode = state.mode || 'normal';
  if (mode === 'fail') return { status: 503, body: { kind: 'failed' } };
  if (mode === 'fail-once' && !seen.has(url.pathname)) { seen.add(url.pathname); return { status: 503, body: { kind: 'failed' } }; }
  const b = body(url.pathname, url.searchParams, mode);
  return b ? { status: 200, body: b } : { status: 404, body: { kind: 'denied' } };
};
module.exports.reset = () => seen.clear();
