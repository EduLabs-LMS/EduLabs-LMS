// A fictional PostgREST for the local speed measurement: synthetic rows, a simulated round-trip delay, and a count of every
// request by name. It is NOT the database: SQL time is measured separately against a disposable PostgreSQL.
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const H = 3600000, D = 24 * H, iso = t => new Date(t).toISOString();
const ids = { org: uuid(50), profile: uuid(900) };

function fixtures() {
  const now = Date.now();
  const courses = [0, 1, 2].map(i => ({ id: uuid(10 + i), organization_id: ids.org, title: 'Synthetic course ' + (i + 1), description: 'Synthetic', status: i === 2 ? 'draft' : 'published', updated_at: iso(now - D) }));
  const offerings = courses.map((c, i) => ({ id: uuid(100 + i), course_id: c.id, name: 'Synthetic run ' + (i + 1), status: 'active', delivery_mode: 'live', starts_at: iso(now - 30 * D), ends_at: null, timezone: 'Africa/Cairo' }));
  const groups = Array.from({ length: 6 }, (_, i) => ({ id: uuid(1 + i), offering_id: offerings[i % 3].id, offering_name: offerings[i % 3].name, name: 'Synthetic group ' + (i + 1), description: '', mode: 'center', location: 'Room ' + (i + 1), join_url: '', instructions: '', capacity: 30, status: 'active', version: 3, staff: true, instructor: true }));
  const mkSession = (g, n, start, extra = {}) => ({ id: uuid(1000 + g * 100 + n), group_id: uuid(g), title: 'Synthetic lesson ' + n, starts_at: iso(start), ends_at: iso(start + H), mode: 'center', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: start > now ? 'draft' : 'finalized', ...extra });
  const sessions = {}, members = {};
  groups.forEach((g, i) => {
    const gi = i + 1;
    sessions[g.id] = [mkSession(gi, 1, now - 2 * H, { attendance_state: 'draft' }), mkSession(gi, 2, now + 2 * D), mkSession(gi, 3, now + 5 * D), ...Array.from({ length: 12 }, (_, k) => mkSession(gi, 10 + k, now - (k + 1) * 3 * D))];
    members[g.id] = Array.from({ length: 28 }, (_, k) => ({ id: uuid(5000 + gi * 100 + k), user_id: uuid(6000 + gi * 100 + k), display_name: 'Synthetic student ' + gi + '-' + String(k + 1).padStart(2, '0'), starts_at: iso(now - 90 * D), ends_at: null, eligible: true }));
  });
  const roster = {};
  offerings.forEach((o, i) => { roster[o.id] = Array.from({ length: 40 }, (_, k) => ({ id: uuid(20000 + i * 100 + k), user_id: uuid(6000 + (i * 2 + 1) * 100 + (k % 28)), display_name: 'Synthetic student ' + (i * 2 + 1) + '-' + String((k % 28) + 1).padStart(2, '0'), status: 'active', version: 1, expires_at: null, enrolled_at: iso(now - 40 * D) })); });
  return { courses, offerings, groups, sessions, members, roster, marks: {} };
}

async function startFakeSupabase({ latencyMs = 0, port = 0 } = {}) {
  let F = fixtures(); const counts = new Map(); let delay = latencyMs;
  const count = name => counts.set(name, (counts.get(name) || 0) + 1);
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const url = new URL(req.url, 'http://x'), accept = req.headers.accept || '';
    if (url.pathname === '/__stats') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.fromEntries(counts))); return; }
    if (url.pathname === '/__reset') { counts.clear(); F = fixtures(); res.writeHead(204); res.end(); return; }
    const send = (data, status = 200, headers = {}) => {
      const asObject = accept.includes('pgrst.object') && Array.isArray(data);
      if (asObject && data.length !== 1) { res.writeHead(406, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 'PGRST116', message: 'no rows' })); return; }
      res.writeHead(status, { 'content-type': 'application/json', 'content-range': Array.isArray(data) ? `0-${Math.max(0, data.length - 1)}/${data.length}` : '*/*', ...headers });
      res.end(JSON.stringify(asObject ? data[0] : data));
    };
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname), table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    count(rpc ? 'rpc_' + rpc[1] : table ? 'rest_' + table[1] : 'other');
    await sleep(delay);
    const body = raw ? JSON.parse(raw) : {};
    if (rpc) {
      const fn = rpc[1];
      if (fn === 'current_profile_id') return send(ids.profile);
      if (fn === 'space_is_demo') return send(false);
      if (fn === 'notification_command') return send({ rows: [], page: 0, unread: 0 });
      if (fn === 'group_view') {
        const g = body.p_group, section = body.p_section || 'summary', page = body.p_page || 0, now = Date.now();
        if (!g) {
          if (section === 'upcoming') return send({ rows: Object.values(F.sessions).flat().filter(s => Date.parse(s.ends_at) > now).slice(0, 10).map(s => ({ ...s, group_name: 'Synthetic group' })), page: 0, serverNow: iso(now) });
          return send({ rows: F.groups, page: 0, hasMore: false, serverNow: iso(now) });
        }
        const group = F.groups.find(x => x.id === g);
        if (!group) return send({ code: '42501' }, 403);
        if (section === 'detail') return send({ group, schedules: [{ weekday: 3, time: '17:00', durationMinutes: 90 }], serverNow: iso(now) });
        if (section === 'sessions') {
          const list = F.sessions[g];
          return send({ rows: list.slice(page * 25, page * 25 + 25).map(s => ({ ...s, state: Date.parse(s.ends_at) <= now ? 'completed' : Date.parse(s.starts_at) <= now ? 'ongoing' : 'upcoming' })), page, serverNow: iso(now), nextSession: list.find(s => Date.parse(s.ends_at) > now) ?? null, catchingUp: false, hasMore: list.length > (page + 1) * 25 });
        }
        if (section === 'members' || section === 'eligible') { const list = F.members[g]; return send({ rows: list.slice(page * 25, page * 25 + 25), page, hasMore: list.length > (page + 1) * 25 }); }
        const session = (F.sessions[g] || []).find(s => s.id === section);
        if (session) {
          const marks = F.marks[session.id] || {}, all = F.members[g].map(m => ({ user_id: m.user_id, display_name: m.display_name, status: marks[m.user_id] || 'not_marked' }));
          return send({ rows: all, page: 0, hasMore: false, session, counts: { attended: all.filter(r => r.status === 'attended').length, absent: all.filter(r => r.status === 'absent').length, not_marked: all.filter(r => r.status === 'not_marked').length } });
        }
        return send({ rows: [], page: 0 });
      }
      if (fn === 'group_command') {
        const g = body.p_group, data = body.p_data || {};
        if (body.p_action === 'attendance') {
          const s = F.sessions[g].find(x => x.id === data.sessionId), m = F.marks[s.id] || (F.marks[s.id] = {});
          for (const x of data.marks || []) m[x.userId] = x.status;
          s.version++;
          return send({ id: g, version: s.version, sessionId: s.id });
        }
        if (body.p_action === 'create') return send({ id: uuid(300), version: 1 });
        return send({ id: g, version: 4 });
      }
      if (fn === 'student_administration') {
        const data = body.p_data || {}, p = data.page || 0;
        if (body.p_action === 'offerings') return send({ rows: F.offerings.map((o, i) => ({ id: o.id, name: o.name, course_title: F.courses[i].title, organization_name: 'Synthetic space', manage: true })), page: 0, hasMore: false });
        if (body.p_action === 'roster') {
          const q = (data.search || '').toLowerCase(), list = (F.roster[body.p_offering] || []).filter(r => r.display_name.toLowerCase().includes(q));
          return send({ rows: list.slice(p * 25, p * 25 + 25), page: p, hasMore: list.length > (p + 1) * 25 });
        }
        if (body.p_action === 'approve') return send({ id: uuid(777), status: 'active', version: 2 });
        return send({ rows: [], page: 0, hasMore: false });
      }
      return send({});
    }
    if (table) {
      const t = table[1];
      if (req.method === 'PATCH' && t === 'courses') { const c = F.courses[0]; Object.assign(c, body, { updated_at: iso(Date.now()) }); return send([c]); }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send([]);
      const rows = {
        organizations: [{ id: ids.org, name: 'Synthetic space', status: 'active' }],
        organization_memberships: [{ organization_id: ids.org, role: 'owner', status: 'active' }],
        profiles: [{ id: ids.profile, display_name: 'Synthetic Teacher', status: 'active' }],
        courses: F.courses, course_offerings: F.offerings, course_staff: [], offering_staff: [],
      }[t];
      let result = rows || [];
      for (const [col, value] of url.searchParams) { const m = /^eq.(.*)$/.exec(value); if (m && result.length && col in result[0]) result = result.filter(r => String(r[col]) === m[1]); }
      return send(result);
    }
    send({ message: 'fictional supabase: not served' }, 404);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { port: server.address().port, ids, uuid, fixtures: () => F, counts: () => Object.fromEntries(counts), resetCounts: () => counts.clear(), setLatency: ms => { delay = ms; }, close: () => new Promise(r => server.close(r)) };
}
module.exports = { startFakeSupabase, uuid };
