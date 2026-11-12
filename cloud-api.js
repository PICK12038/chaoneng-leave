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
        { name: '苏甜', dorm: 'A217', group: '超能二4组', className: '超能2班', phone: '' },
        { name: '陈雯睿', dorm: 'A533', group: '超能一1组', className: '超能1班', phone: '' },
      ],
      weeks: [{ id: '2026-10-24', saturday: '2026-10-24', cutoff: '21:30', note: '', records: [] }],
    };
    // 演示模式里的分类计算（和线上同一个规则）
    // 演示模式的分类计算：与线上同一套规则（最多三个时间点，可带等号前缀）
    const mockCatOf = (startAt, sat, rawCut) => {
      if (!startAt) return 'sat';
      const [a, b, c] = String(rawCut || '21:30').trim().replace(/^=/, '').split('|');
      const ok = (v) => /^\d{1,2}:\d{2}$/.test(String(v || '').trim());
      const pad = (v, d) => {
        if (!ok(v)) return d;
        const [h, m] = String(v).trim().split(':');
        return String(Math.min(23, Number(h))).padStart(2, '0') + ':' + String(Math.min(59, Number(m))).padStart(2, '0');
      };
      const cutoff = pad(a, '21:30');
      const sunStart = pad(b, '00:00');
      const sunEnd = pad(c, '23:59');
      const s0 = String(startAt).replace(' ', 'T').slice(0, 16);
      const d = new Date(sat + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      const sun = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (s0 < sat + 'T' + cutoff) return 'early';
      if (s0 < sun + 'T' + sunStart) return 'sat';
      if (s0 <= sun + 'T' + sunEnd) return 'sun';
      return 'other';
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
      // 单条 PATCH / DELETE 放在 bulk 之后判断，否则 /api/records/bulk 会被误当成周 id
      if (p.startsWith('/api/records/')) {
        const [, , , wid, rid] = p.split('/');
        const w = findWeek(decodeURIComponent(wid));
        const i = w.records.findIndex((r) => r.id === decodeURIComponent(rid));
        if (i >= 0 && method === 'PATCH') w.records[i] = { ...w.records[i], ...body, updatedAt: new Date().toISOString() };
        if (i >= 0 && method === 'DELETE') w.records.splice(i, 1);
        return { ok: true, week: w, revision: 0 };
      }
      if (p === '/api/students' && method === 'POST') return studentsBulk({ students: [body], create: true });
      if (p === '/api/students/bulk' && method === 'POST') return studentsBulk(body);
      if (p.startsWith('/api/students/') && method === 'DELETE') {
        M.students = M.students.filter((s) => s.name !== decodeURIComponent(p.slice('/api/students/'.length)));
        return { ok: true, students: M.students, revision: 0 };
      }
      if (p.startsWith('/api/week-rule/')) {
        const wid = decodeURIComponent(p.slice('/api/week-rule/'.length));
        const w = findWeek(wid);
        if (!w) throw new Error('没找到该周');
        const raw = body && body.cutoff ? String(body.cutoff).trim() : '';
        w.cutoff = raw ? (raw.startsWith('=') ? raw : '=' + raw) : M.settings.cutoff;
        w.records.forEach((r) => {
          if (r.startAt) r.category = mockCatOf(r.startAt, w.saturday, w.cutoff);
        });
        return { ok: true, week: w, weeks: meta(), revision: 0 };
      }
      if (p === '/api/weeks' && method === 'POST') {
        const sat = body.saturday;
        if (!findWeek(sat)) M.weeks.push({ id: sat, saturday: sat, cutoff: M.settings.cutoff, note: '', records: [] });
        return { ok: true, week: findWeek(sat), weeks: meta(), revision: 0 };
      }
      if (p.startsWith('/api/weeks/') && method === 'DELETE') {
        const id = decodeURIComponent(p.slice('/api/weeks/'.length));
        M.weeks = M.weeks.filter((w) => w.id !== id);
        return { ok: true, weeks: meta(), revision: 0 };
      }
      if (p === '/api/settings' && method === 'PUT') {
        Object.assign(M.settings, { org: body.org, cutoff: body.cutoff });
        M.weeks.forEach((w) => {
          if (String(w.cutoff || '').startsWith('=')) return;
          w.cutoff = body.cutoff;
          w.records.forEach((r) => {
            if (r.startAt) r.category = mockCatOf(r.startAt, w.saturday, body.cutoff);
          });
        });
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

  async function pgCount(path) {
    const res = await fetch(REST + '/' + path, {
      method: 'HEAD',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'count=exact' },
    });
    const range = res.headers.get('content-range') || '';
    const n = Number((range.split('/')[1] || '0').trim());
    return Number.isFinite(n) ? n : 0;
  }

  let fpCache = { at: 0, value: '' };

  async function fingerprint() {
    const [recCount, recMax, stuCount, weekCount] = await Promise.all([
      pgCount('records?select=id'),
      pg('records?select=updated_at&order=updated_at.desc&limit=1'),
      pgCount('students?select=name'),
      pgCount('weeks?select=id'),
    ]);
    return [recCount, (recMax && recMax[0] && recMax[0].updated_at) || '', stuCount, weekCount].join('|');
  }

  // 3 秒内复用，避免同一次操作里重复查询
  async function revision() {
    if (Date.now() - fpCache.at < 3000) return fpCache.value;
    try {
      const value = await fingerprint();
      fpCache = { at: Date.now(), value };
      return value;
    } catch {
      return fpCache.value || '0';
    }
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

  const toRecord = (r, weekCutoff) => ({
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
    category: r.start_at ? catOfWeek(shortTime(r.start_at), r.week_id, weekCutoff) : r.cat || 'sat',
    slip: { written: !!r.written, sent: !!r.sent },
    by: r.by_name || '',
    createdAt: shortTime(r.created_at),
    updatedAt: shortTime(r.updated_at),
  });

  /* 分类以「开始时间」为准：周六 21:30 前=提前请假，周六当天=周六，次日(周日)=周日 */
  /* 时间规则：cutoff 列里用竖线串 1~3 个时间点
        "21:30"             → 提前截止 21:30 / 周日 00:00 起 / 周日 23:59 止（默认口径）
        "21:30|06:00"       → 周日从 06:00 起算
        "19:00|05:00|18:00" → 调休周：提前截止 19:00、周日 05:00 起、18:00 后算其他
     以等号开头（"=19:00|..."）表示「这一周单独设定」，不带等号就是全局设置。 */
  const splitCut = (raw) => {
    const [a, b, c] = String(raw == null ? '' : raw).trim().replace(/^=/, '').split('|');
    const ok = (v) => /^\d{1,2}:\d{2}$/.test(String(v || '').trim());
    const norm = (v, d) => {
      if (!ok(v)) return d;
      const [h, m] = String(v).trim().split(':');
      return String(Math.min(23, Number(h))).padStart(2, '0') + ':' + String(Math.min(59, Number(m))).padStart(2, '0');
    };
    return { cutoff: norm(a, '21:30'), sunStart: norm(b, '00:00'), sunEnd: norm(c, '23:59') };
  };

  const catOfWeek = (startAt, weekId, rawCutoff) => {
    if (!startAt) return 'sat';
    const { cutoff, sunStart, sunEnd } = splitCut(rawCutoff);
    const s = String(startAt).replace(' ', 'T').slice(0, 16);
    const sat = String(weekId || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sat)) return 'sat';
    if (s < `${sat}T${cutoff}`) return 'early';
    const d = new Date(`${sat}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const sunday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (s < `${sunday}T${sunStart}`) return 'sat';
    if (s <= `${sunday}T${sunEnd}`) return 'sun';
    return 'other';
  };

  /* 一周实际生效的规则：周次自己写过（带等号）就用它，否则用全局设置 */
  const effCut = (weekRow, globalCut) => {
    const w = (weekRow && weekRow.cutoff) || '';
    return String(w).startsWith('=') ? w : globalCut || w || '21:30';
  };

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
      cat: r.category || catOfWeek(r.startAt, weekId, r.cutoff),
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

  /* 全局设置里的时间规则（settings.cutoff） */
  async function globalCut() {
    try {
      const r = await pg('settings?select=cutoff&id=eq.1');
      return (r && r[0] && r[0].cutoff) || '21:30';
    } catch {
      return '21:30';
    }
  }

  async function weekMeta() {
    const weeks = await pg('weeks?select=*&order=saturday.desc');
    if (!weeks || !weeks.length) return [];
    const ids = weeks.map((w) => w.id);
    const rows = await pg(`records?select=week_id,start_at,cat,check_state,written,sent&week_id=in.(${ids.map(enc).join(',')})`);
    const gCut = await globalCut();
    const cutByWeek = new Map(weeks.map((w) => [w.id, effCut(w, gCut)]));
    const byWeek = new Map();
    for (const r of rows || []) {
      if (!byWeek.has(r.week_id)) byWeek.set(r.week_id, { total: 0, early: 0, sat: 0, sun: 0, other: 0, written: 0, sent: 0, paper: 0, left: 0 });
      const w = byWeek.get(r.week_id);
      const cat = r.start_at ? catOfWeek(shortTime(r.start_at), r.week_id, cutByWeek.get(r.week_id)) : r.cat || 'sat';
      w.total++;
      if (w[cat] !== undefined) w[cat]++;
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
        cutoff: effCut(w, gCut),
        override: String(w.cutoff || '').startsWith('='),
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
      revision: await revision(),
      server: { port: location.host, ips: [], code: false, share: { running: false, provider: 'supabase' } },
      me: null,
    };
  }

  async function weekData(id) {
    const [wRows, recs, gCut] = await Promise.all([
      pg(`weeks?select=*&id=eq.${enc(id)}`),
      pg(`records?select=*&week_id=eq.${enc(id)}&order=start_at.asc`),
      globalCut(),
    ]);
    if (!wRows || !wRows.length) {
      const err = new Error('没找到该周');
      err.status = 404;
      throw err;
    }
    const w = wRows[0];
    const cut = effCut(w, gCut);
    return {
      revision: await revision(),
      week: {
        id: w.id,
        saturday: String(w.saturday),
        cutoff: cut,
        override: String(w.cutoff || '').startsWith('='),
        note: w.note || '',
        records: (recs || []).map((r) => toRecord(r, cut)),
      },
    };
  }

  async function addRecords({ week, records }) {
    // 本周的截止口径要传进 toRecordRow，否则会用默认 21:30 算错分类
    const wk = (await pg(`weeks?select=cutoff&id=eq.${enc(week)}`)) || [];
    const cut = (wk[0] && wk[0].cutoff) || '21:30';
    const rows = (records || []).map((r) => toRecordRow({ ...r, cutoff: cut }, week));
    if (!rows.length) return { added: 0, duplicates: [], week: (await weekData(week)).week, revision: await revision() };

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
    return { added: fresh.length, duplicates, week: (await weekData(week)).week, revision: await revision() };
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
    return { ok: true, week: (await weekData(weekId)).week, revision: await revision() };
  }

  async function bulkRecords({ week, ids, field, value }) {
    if (!ids || !ids.length) return { ok: true, week: (await weekData(week)).week, revision: await revision() };
    const filter = `id=in.(${ids.map(enc).join(',')})`;
    if (field === 'delete') {
      await pg(`records?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
    } else if (field === 'check') {
      await pg(`records?${filter}`, { method: 'PATCH', body: { check_state: value || '', updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    } else if (field === 'written' || field === 'sent') {
      await pg(`records?${filter}`, { method: 'PATCH', body: { [field]: !!value, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    }
    return { ok: true, week: (await weekData(week)).week, revision: await revision() };
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
    return { ok: true, added, updated, students: (all || []).map(toStudent), revision: await revision() };
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
    if (p === '/api/sync') {
      const rev = await revision();
      const changed = qs.get('rev') !== rev;
      return { changed, revision: rev, weeks: changed ? await weekMeta() : undefined };
    }
    if (p === '/api/log') return { log: (await bootstrap()).log };
    if (p === '/api/settings' && method === 'PUT') {
      await pg('settings?id=eq.1', { method: 'PATCH', body: { org: body.org, cutoff: body.cutoff, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
      // 截止时间变了 → 已有记录的分类要跟着重算，否则统计口径会前后不一致
      let recat = 0;
      try {
        const weeks = await pg('weeks?select=id,cutoff');
        const cutByWeek = new Map((weeks || []).map((w) => [w.id, effCut(w, body.cutoff)]));
        for (const w of weeks || []) {
          // 亲手给某周设过规则的，不要被全局设置覆盖
          if (String(w.cutoff || '').startsWith('=')) continue;
          await pg(`weeks?id=eq.${enc(w.id)}`, { method: 'PATCH', body: { cutoff: body.cutoff }, prefer: 'return=minimal' }).catch(() => null);
        }
        const ids = (weeks || []).map((w) => w.id);
        if (ids.length) {
          const rows = await pg(`records?select=id,week_id,start_at,cat&week_id=in.(${ids.map(enc).join(',')})`);
          const groups = new Map();
          for (const r of rows || []) {
            if (!r.start_at) continue;
            const want = catOfWeek(shortTime(r.start_at), r.week_id, cutByWeek.get(r.week_id));
            if (want === r.cat) continue;
            if (!groups.has(want)) groups.set(want, []);
            groups.get(want).push(r.id);
          }
          for (const [cat, list] of groups) {
            await pg(`records?id=in.(${list.map(enc).join(',')})`, { method: 'PATCH', body: { cat }, prefer: 'return=minimal' });
            recat += list.length;
          }
        }
      } catch (e) {
        console.warn('[cloud] 重算分类失败：', e.message);
      }
      return { ok: true, settings: body, recategorized: recat, revision: await revision() };
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
        return { ok: true, week: (await weekData(weekId)).week, revision: await revision() };
      }
    }
    if (p === '/api/students' && method === 'POST') return studentsBulk({ students: [body], create: true });
    if (p === '/api/students/bulk' && method === 'POST') return studentsBulk(body);
    if (p.startsWith('/api/students/') && method === 'DELETE') {
      await pg(`students?name=eq.${enc(decodeURIComponent(p.slice('/api/students/'.length)))}`, { method: 'DELETE', prefer: 'return=minimal' });
      const all = await pg('students?select=*&order=name.asc');
      return { ok: true, students: (all || []).map(toStudent), revision: await revision() };
    }
    if (p.startsWith('/api/week-rule/') && (method === 'POST' || method === 'PUT')) {
      // 给某一周单独设时间规则；body.cutoff 传空 = 恢复跟随全局设置
      const wid = decodeURIComponent(p.slice('/api/week-rule/'.length));
      const raw = body && body.cutoff ? String(body.cutoff).trim() : '';
      const val = raw ? (raw.startsWith('=') ? raw : '=' + raw) : '';
      await pg(`weeks?id=eq.${enc(wid)}`, { method: 'PATCH', body: { cutoff: val }, prefer: 'return=minimal' });
      // 规则变了 → 这一周已有记录的分类立刻重算
      const wk = await pg(`weeks?select=*&id=eq.${enc(wid)}`);
      if (wk && wk[0]) {
        const cut = effCut(wk[0], await globalCut());
        const rows = await pg(`records?select=id,start_at,cat&week_id=eq.${enc(wid)}`);
        const groups = new Map();
        for (const r of rows || []) {
          if (!r.start_at) continue;
          const want = catOfWeek(shortTime(r.start_at), wid, cut);
          if (want === r.cat) continue;
          if (!groups.has(want)) groups.set(want, []);
          groups.get(want).push(r.id);
        }
        for (const [cat, list] of groups) {
          await pg(`records?id=in.(${list.map(enc).join(',')})`, { method: 'PATCH', body: { cat }, prefer: 'return=minimal' });
        }
      }
      return { ok: true, week: (await weekData(wid)).week, weeks: await weekMeta(), revision: await revision() };
    }
    if (p === '/api/weeks' && method === 'POST') {
      const sat = body.saturday || '';
      const exists = await pg(`weeks?select=*&id=eq.${enc(sat)}`);
      if (!exists || !exists.length) {
        const cur = await pg('settings?select=cutoff&id=eq.1');
        const cut = (cur && cur[0] && cur[0].cutoff) || '21:30';
        await pg('weeks', { method: 'POST', body: [{ id: sat, saturday: sat, cutoff: cut, note: '' }], prefer: 'return=minimal' });
      }
      const list = await weekMeta();
      return { ok: true, week: list.find((w) => w.id === sat) || null, weeks: list, revision: await revision() };
    }
    if (p.startsWith('/api/weeks/') && method === 'DELETE') {
      await pg(`weeks?id=eq.${enc(decodeURIComponent(p.slice('/api/weeks/'.length)))}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { ok: true, weeks: await weekMeta(), revision: await revision() };
    }
    if (qs.get('__') === null) {
      // 未覆盖的接口一律给个空对象，避免前端崩
    }
    return {};
  }

  window.CloudAPI = { request, pg, bootstrap, weekData };
})();
