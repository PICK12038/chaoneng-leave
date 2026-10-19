/**
 * 云端版数据适配层：把 app.js 里原来打给 Node 服务的 /api/* 请求，
 * 现场翻译成 Supabase(PostgREST) 的查询。
 *
 * 职责边界：app.js 一行业务代码都不改，只把 api(path, opts) 交给这里。
 * 映射关系：
 *   /api/bootstrap          → settings + students + weeks(含统计) + log
 *   /api/week/:id           → weeks 行 + records
 *   /api/records            → insert（带重复判定）
 *   /api/records/:w/:id     → update / delete
 *   /api/records/bulk       → 批量 update / delete
 *   /api/students           → upsert / delete
 *   /api/students/bulk      → 批量 upsert
 *   /api/weeks              → insert / delete
 *   /api/settings           → update
 *   /api/presence、/api/share、/api/login、/api/sync → 云端没有，给空实现
 */
(() => {
  const cfg = window.SUPABASE_CONFIG || {};
  const SB_URL = String(cfg.url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '');
  const KEY = cfg.key || '';
  const REST = SB_URL + '/rest/v1';

  /* ---------- 本地演示模式：地址后加 ?mock=1，不走网络，数据在内存里 ---------- */
  if (/[?&]mock=1/.test(location.search)) {
    const M = {
      settings: { org: '周六超能班', cutoff: '21:30' },
      students: [
        { name: '鄢艺菲', dorm: 'A616', group: '超能一3组', className: '超能1班', phone: '13336843280' },
        { name: '刘柏萍', dorm: 'A231', group: '超能一1组', className: '超能1班', phone: '' },
        { name: '关伊萌', dorm: 'B312', group: '丰泰班2组', className: '丰泰班', phone: '' },
      ],
      weeks: [{ id: '2026-10-24', saturday: '2026-10-24', cutoff: '21:30', note: '', records: [] }],
    };
    M.weeks[0].records.push({
      id: 'mock-1', name: '鄢艺菲', rawName: '鄢艺菲', group: '超能一3组', dorm: 'A616',
      startAt: '2026-10-18T13:00', endAt: '2026-10-18T20:00', timeRaw: '10月18日13时00分至10月18日20时00分',
      reason: '出去玩', note: '', phone: '13824383778', contact: '蔡娟', check: '', category: 'sun',
      slip: { written: false, sent: false }, by: '演示', createdAt: '2026-10-19T09:00', updatedAt: '2026-10-19T09:00',
    });
    const meta = () =>
      M.weeks.map((w) => ({
        id: w.id, saturday: w.saturday, cutoff: w.cutoff, note: w.note,
        total: w.records.length,
        counts: {
          early: w.records.filter((r) => r.category === 'early').length,
          sat: w.records.filter((r) => r.category === 'sat').length,
          sun: w.records.filter((r) => r.category === 'sun').length,
          other: w.records.filter((r) => r.category === 'other').length,
        },
        written: w.records.filter((r) => r.slip.written).length,
        sent: w.records.filter((r) => r.slip.sent).length,
        checked: {
          paper: w.records.filter((r) => r.check === 'paper').length,
          left: w.records.filter((r) => r.check === 'left').length,
        },
      }));
    const findWeek = (id) => M.weeks.find((w) => w.id === id);
    async function requestMock(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
      const p = new URL('http://x' + path).pathname;
      if (p === '/api/bootstrap')
        return { settings: M.settings, students: M.students, weeks: meta(), log: [], revision: 0, server: { share: { running: false } } };
      if (p.startsWith('/api/week/')) {
        const w = findWeek(decodeURIComponent(p.slice('/api/week/'.length)));
        if (!w) throw new Error('没找到该周');
        return { revision: 0, week: w };
      }
      if (p === '/api/records' && method === 'POST') {
        const w = findWeek(body.week);
        const added = [];
        for (const r of body.records || []) {
          if (w.records.some((x) => x.name === r.name && x.startAt === r.startAt)) continue;
          const rec = { ...r, id: 'mock-' + Math.random().toString(36).slice(2) };
          w.records.push(rec);
          added.push(rec);
        }
        return { added: added.length, duplicates: [], week: w, revision: 0 };
      }
      if (p.startsWith('/api/records/')) {
        const [, , , wid, rid] = p.split('/');
        const w = findWeek(decodeURIComponent(wid));
        const i = w.records.findIndex((r) => r.id === decodeURIComponent(rid));
        if (i >= 0 && method === 'PATCH') w.records[i] = { ...w.records[i], ...body, updatedAt: new Date().toISOString() };
        if (i >= 0 && method === 'DELETE') w.records.splice(i, 1);
        return { ok: true, week: w, revision: 0 };
      }
      if (p === '/api/records/bulk' && method === 'POST') {
        const w = findWeek(body.week);
        const set = new Set(body.ids || []);
        if (body.field === 'delete') w.records = w.records.filter((r) => !set.has(r.id));
        else
          w.records.forEach((r) => {
            if (!set.has(r.id)) return;
            if (body.field === 'check') r.check = body.value || '';
            else if (body.field === 'written' || body.field === 'sent') r.slip[body.field] = !!body.value;
          });
        return { ok: true, week: w, revision: 0 };
      }
      if (p === '/api/students' && method === 'POST') return studentsBulk({ students: [body], create: true });
      if (p === '/api/students/bulk' && method === 'POST') return studentsBulk(body);
      if (p.startsWith('/api/students/') && method === 'DELETE') {
        M.students = M.students.filter((s) => s.name !== decodeURIComponent(p.slice('/api/students/'.length)));
        return { ok: true, students: M.students, revision: 0 };
      }
      if (p === '/api/weeks' && method === 'POST') {
        const sat = body.saturday;
        if (!findWeek(sat)) M.weeks.push({ id: sat, saturday: sat, cutoff: '21:30', note: '', records: [] });
        return { ok: true, week: findWeek(sat), weeks: meta(), revision: 0 };
      }
      if (p.startsWith('/api/weeks/') && method === 'DELETE') {
        const id = decodeURIComponent(p.slice('/api/weeks/'.length));
        M.weeks = M.weeks.filter((w) => w.id !== id);
        return { ok: true, weeks: meta(), revision: 0 };
      }
      if (p === '/api/settings' && method === 'PUT') {
        Object.assign(M.settings, { org: body.org, cutoff: body.cutoff });
        return { ok: true, settings: M.settings, revision: 0 };
      }
      if (p === '/api/login') return { ok: true };
      if (p === '/api/presence') return { online: [] };
      if (p === '/api/share') return { running: false, provider: 'mock' };
      if (p === '/api/sync') return { changed: false, revision: 0 };
      return {};
    }
    async function studentsBulk({ students, create }) {
      let added = 0;
      let updated = 0;
      for (const s of students || []) {
        const hit = M.students.find((x) => x.name === s.name);
        if (hit) {
          Object.assign(hit, { dorm: s.dorm || hit.dorm, group: s.group || hit.group, className: s.className || hit.className, phone: s.phone || hit.phone });
          updated++;
        } else if (create) {
          M.students.push({ name: s.name, dorm: s.dorm || '', group: s.group || '', className: s.className || '', phone: s.phone || '' });
          added++;
        }
      }
      return { ok: true, added, updated, students: M.students, revision: 0 };
    }
    window.CloudAPI = {
      request: requestMock,
      weekData: (id) => requestMock('/api/week/' + encodeURIComponent(id)),
      bootstrap: () => requestMock('/api/bootstrap'),
    };
    console.warn('[cloud] 演示模式（?mock=1）：数据在内存里，刷新就没了');
    return;
  }

  if (!SB_URL || !KEY) {
    console.error('[cloud] 缺少 SUPABASE_CONFIG（url / key），请检查 config.js');
  }

  const enc = encodeURIComponent;

  async function pg(path, { method = 'GET', body, prefer, headers } = {}) {
    const res = await fetch(REST + '/' + path, {
      method,
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...(headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.hint || data.details)) || res.status + '';
      throw new Error('云端拒绝了这次操作：' + msg);
    }
    return data;
  }

  /* ---------------- 字段映射 ---------------- */
  const shortTime = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
  const fullTime = (v) => (v ? String(v).replace(' ', 'T').slice(0, 19) : '');

  const toStudent = (r) => ({
    name: r.name,
    dorm: r.dorm || '',
    group: r.grp || '',
    className: r.class_name || '',
    phone: r.phone || '',
  });

  const toRecord = (r) => ({
    id: r.id,
    name: r.name,
    rawName: r.raw_name || r.name,
    group: r.grp || '',
    dorm: r.dorm || '',
    startAt: shortTime(r.start_at),
    endAt: shortTime(r.end_at),
    timeRaw: r.time_raw || '',
    reason: r.reason || '',
    note: r.note || '',
    phone: r.phone || '',
    contact: r.contact || '',
    check: r.check_state || '',
    category: r.cat || 'sat',
    slip: { written: !!r.written, sent: !!r.sent },
    by: r.by_name || '',
    createdAt: shortTime(r.created_at),
    updatedAt: shortTime(r.updated_at),
  });

  const toRecordRow = (r, weekId) => {
    const row = {
      week_id: weekId,
      name: r.name || '',
      raw_name: r.rawName || r.name || '',
      grp: r.group || '',
      dorm: r.dorm || '',
      time_raw: r.timeRaw || '',
      reason: r.reason || '',
      note: r.note || '',
      phone: r.phone || '',
      contact: r.contact || '',
      cat: r.category || 'sat',
      check_state: r.check || '',
      by_name: r.by || '',
      updated_at: new Date().toISOString(),
    };
    if (r.startAt) row.start_at = fullTime(r.startAt);
    if (r.endAt) row.end_at = fullTime(r.endAt);
    if (r.slip) {
      row.written = !!r.slip.written;
      row.sent = !!r.slip.sent;
    }
    return row;
  };

  async function weekMeta() {
    const weeks = await pg('weeks?select=*&order=saturday.desc');
    if (!weeks || !weeks.length) return [];
    const ids = weeks.map((w) => w.id);
    const rows = await pg(`records?select=week_id,cat,check_state,written,sent&week_id=in.(${ids.map(enc).join(',')})`);
    const byWeek = new Map();
    for (const r of rows || []) {
      if (!byWeek.has(r.week_id)) byWeek.set(r.week_id, { total: 0, early: 0, sat: 0, sun: 0, other: 0, written: 0, sent: 0, paper: 0, left: 0 });
      const w = byWeek.get(r.week_id);
      w.total++;
      if (w[r.cat] !== undefined) w[r.cat]++;
      if (r.written) w.written++;
      if (r.sent) w.sent++;
      if (r.check_state === 'paper') w.paper++;
      if (r.check_state === 'left') w.left++;
    }
    return weeks.map((w) => {
      const s = byWeek.get(w.id) || { total: 0, early: 0, sat: 0, sun: 0, other: 0, written: 0, sent: 0, paper: 0, left: 0 };
      return {
        id: w.id,
        saturday: String(w.saturday),
        cutoff: w.cutoff || '21:30',
        note: w.note || '',
        total: s.total,
        counts: { early: s.early, sat: s.sat, sun: s.sun, other: s.other },
        written: s.written,
        sent: s.sent,
        checked: { paper: s.paper, left: s.left },
      };
    });
  }

  async function bootstrap() {
    const [settingsRows, students, weeks, log] = await Promise.all([
      pg('settings?select=*&id=eq.1'),
      pg('students?select=*&order=name.asc'),
      weekMeta(),
      pg('log?select=*&order=id.desc&limit=120'),
    ]);
    const s = (settingsRows && settingsRows[0]) || { org: '周六超能班', cutoff: '21:30' };
    return {
      settings: { org: s.org, cutoff: s.cutoff },
      students: (students || []).map(toStudent),
      weeks,
      log: (log || []).map((l) => ({ t: shortTime(l.at).replace('T', ' '), by: l.by_name, action: l.action, detail: l.detail })),
      revision: 0,
      server: { port: location.host, ips: [], code: false, share: { running: false, provider: 'supabase' } },
      me: null,
    };
  }

  async function weekData(id) {
    const [wRows, recs] = await Promise.all([
      pg(`weeks?select=*&id=eq.${enc(id)}`),
      pg(`records?select=*&week_id=eq.${enc(id)}&order=start_at.asc`),
    ]);
    if (!wRows || !wRows.length) {
      const err = new Error('没找到该周');
      err.status = 404;
      throw err;
    }
    const w = wRows[0];
    return {
      revision: 0,
      week: {
        id: w.id,
        saturday: String(w.saturday),
        cutoff: w.cutoff || '21:30',
        note: w.note || '',
        records: (recs || []).map(toRecord),
      },
    };
  }

  async function addRecords({ week, records }) {
    const rows = (records || []).map((r) => toRecordRow(r, week));
    if (!rows.length) return { added: 0, duplicates: [], week: (await weekData(week)).week, revision: 0 };

    const exist = await pg(`records?select=name,start_at&week_id=eq.${enc(week)}`);
    const seen = new Set((exist || []).map((r) => `${r.name}|${shortTime(r.start_at)}`));
    const duplicates = [];
    const fresh = [];
    for (const row of rows) {
      const k = `${row.name}|${shortTime(row.start_at)}`;
      if (seen.has(k)) {
        duplicates.push({ name: row.name, startAt: shortTime(row.start_at) });
        continue;
      }
      seen.add(k);
      fresh.push(row);
    }
    if (fresh.length) await pg('records', { method: 'POST', body: fresh, prefer: 'return=minimal' });
    return { added: fresh.length, duplicates, week: (await weekData(week)).week, revision: 0 };
  }

  async function patchRecord(weekId, id, body) {
    const T = {
      name: 'name',
      rawName: 'raw_name',
      group: 'grp',
      dorm: 'dorm',
      timeRaw: 'time_raw',
      reason: 'reason',
      note: 'note',
      phone: 'phone',
      contact: 'contact',
      category: 'cat',
      check: 'check_state',
      by: 'by_name',
    };
    const row = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(T)) if (body[k] !== undefined) row[col] = body[k];
    if (body.startAt !== undefined) row.start_at = body.startAt ? fullTime(body.startAt) : null;
    if (body.endAt !== undefined) row.end_at = body.endAt ? fullTime(body.endAt) : null;
    if (body.slip) {
      row.written = !!body.slip.written;
      row.sent = !!body.slip.sent;
    }
    await pg(`records?id=eq.${enc(id)}`, { method: 'PATCH', body: row, prefer: 'return=minimal' });
    return { ok: true, week: (await weekData(weekId)).week, revision: 0 };
  }

  async function bulkRecords({ week, ids, field, value }) {
    if (!ids || !ids.length) return { ok: true, week: (await weekData(week)).week, revision: 0 };
    const filter = `id=in.(${ids.map(enc).join(',')})`;
    if (field === 'delete') {
      await pg(`records?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
    } else if (field === 'check') {
      await pg(`records?${filter}`, { method: 'PATCH', body: { check_state: value || '', updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    } else if (field === 'written' || field === 'sent') {
      await pg(`records?${filter}`, { method: 'PATCH', body: { [field]: !!value, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    }
    return { ok: true, week: (await weekData(week)).week, revision: 0 };
  }

  async function studentsBulk({ students, create }) {
    const rows = (students || []).map((s) => ({
      name: s.name,
      dorm: s.dorm || '',
      grp: s.group || '',
      class_name: s.className || '',
      phone: s.phone || '',
      updated_at: new Date().toISOString(),
    }));
    let added = 0;
    let updated = 0;
    if (rows.length) {
      const names = rows.map((r) => r.name);
      const exist = await pg(`students?select=name&name=in.(${names.map(enc).join(',')})`);
      const have = new Set((exist || []).map((r) => r.name));
      const todo = create ? rows : rows.filter((r) => have.has(r.name));
      added = todo.filter((r) => !have.has(r.name)).length;
      updated = todo.length - added;
      if (todo.length) {
        await pg('students?on_conflict=name', { method: 'POST', body: todo, prefer: 'resolution=merge-duplicates,return=minimal' });
      }
    }
    const all = await pg('students?select=*&order=name.asc');
    return { ok: true, added, updated, students: (all || []).map(toStudent), revision: 0 };
  }

  /* ---------------- 路由分发 ---------------- */
  async function request(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : undefined;
    const u = new URL('http://x' + path);
    const p = u.pathname;
    const qs = u.searchParams;

    if (p === '/api/bootstrap') return bootstrap();
    if (p === '/api/login') return { ok: true };
    if (p === '/api/presence') return { online: [] };
    if (p === '/api/share') return { running: false, provider: 'supabase', installed: true };
    if (p === '/api/sync') return { changed: false, revision: 0 };
    if (p === '/api/log') return { log: (await bootstrap()).log };
    if (p === '/api/settings' && method === 'PUT') {
      await pg('settings?id=eq.1', { method: 'PATCH', body: { org: body.org, cutoff: body.cutoff, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
      return { ok: true, settings: body, revision: 0 };
    }
    if (p.startsWith('/api/week/')) return weekData(decodeURIComponent(p.slice('/api/week/'.length)));
    if (p === '/api/records' && method === 'POST') return addRecords(body);
    if (p === '/api/records/bulk' && method === 'POST') return bulkRecords(body);
    if (p.startsWith('/api/records/')) {
      const [, , , wid, rid] = p.split('/');
      const weekId = decodeURIComponent(wid);
      const id = decodeURIComponent(rid);
      if (method === 'PATCH') return patchRecord(weekId, id, body || {});
      if (method === 'DELETE') {
        await pg(`records?id=eq.${enc(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
        return { ok: true, week: (await weekData(weekId)).week, revision: 0 };
      }
    }
    if (p === '/api/students' && method === 'POST') return studentsBulk({ students: [body], create: true });
    if (p === '/api/students/bulk' && method === 'POST') return studentsBulk(body);
    if (p.startsWith('/api/students/') && method === 'DELETE') {
      await pg(`students?name=eq.${enc(decodeURIComponent(p.slice('/api/students/'.length)))}`, { method: 'DELETE', prefer: 'return=minimal' });
      const all = await pg('students?select=*&order=name.asc');
      return { ok: true, students: (all || []).map(toStudent), revision: 0 };
    }
    if (p === '/api/weeks' && method === 'POST') {
      const sat = body.saturday || '';
      const exists = await pg(`weeks?select=*&id=eq.${enc(sat)}`);
      if (!exists || !exists.length) {
        await pg('weeks', { method: 'POST', body: [{ id: sat, saturday: sat, cutoff: '21:30', note: '' }], prefer: 'return=minimal' });
      }
      const list = await weekMeta();
      return { ok: true, week: list.find((w) => w.id === sat) || null, weeks: list, revision: 0 };
    }
    if (p.startsWith('/api/weeks/') && method === 'DELETE') {
      await pg(`weeks?id=eq.${enc(decodeURIComponent(p.slice('/api/weeks/'.length)))}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { ok: true, weeks: await weekMeta(), revision: 0 };
    }
    if (qs.get('__') === null) {
      // 未覆盖的接口一律给个空对象，避免前端崩
    }
    return {};
  }

  window.CloudAPI = { request, pg, bootstrap, weekData };
})();
