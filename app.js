import {
  buildContext,
  parseText,
  parseRosterText,
  parseTimeRange,
  parseISO,
  timeTextOf,
  categoryOf,
  dayGap,
  CATEGORY_LABEL,
  normalizeDorm,
  normalizeGroup,
} from './parser.js';

/* ================================================================== */
/* 基础工具                                                            */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const md = (isoDate) => {
  const p = String(isoDate || '').split('-');
  return p.length === 3 ? `${+p[1]}月${+p[2]}日` : '';
};
const wd = (isoDate) => `周${WEEK_CN[new Date(`${isoDate}T12:00:00`).getDay()]}`;
const hm = (iso) => String(iso || '').slice(11, 16);

const ICONS = {
  calendar: '<path d="M7 3v3m10-3v3M3.5 9.5h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z"/>',
  paste: '<path d="M9 4h6v2.5H9zM8 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 4H16M8.5 12h7m-7 4h4"/>',
  users: '<path d="M15 19v-1.5A3.5 3.5 0 0 0 11.5 14h-4A3.5 3.5 0 0 0 4 17.5V19m5.5-8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 4.6a3 3 0 0 1 0 5.8"/>',
  bed: '<path d="M3.5 18.5V7m0 8h17v3.5M20.5 15v-3a2 2 0 0 0-2-2H12v5M7 10.5h.01M7 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/>',
  book: '<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h5v16H6a1.5 1.5 0 0 0-1.5 1.5zM19.5 5.5A1.5 1.5 0 0 0 18 4h-5v16h5a1.5 1.5 0 0 1 1.5 1.5z"/>',
  clock: '<path d="M12 7v5l3.5 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
};

const state = {
  me: (() => {
    const qp = new URLSearchParams(location.search);
    const preset = qp.get('as');
    if (preset) {
      localStorage.setItem('leave.me', preset);
      return preset;
    }
    return localStorage.getItem('leave.me') || '';
  })(),
  clientId: (() => {
    let id = localStorage.getItem('leave.cid');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('leave.cid', id);
    }
    return id;
  })(),
  revision: -1,
  settings: { org: '周六超能班', cutoff: '21:30' },
  students: [],
  weeks: [],
  week: null,
  weekId: '',
  view: 'week',
  filter: 'all',
  query: '',
  sortBy: 'group',
  selected: new Set(),
  online: [],
  preview: [],
  skipped: [],
  rosterText: '',
  rosterPreview: [],
  rosterSkipped: [],
  rosterCreate: false,
  log: [],
  requiresCode: false,
  editing: false,
  server: null,
  pendingPresence: false,
  pasteText: '',
  timers: false,
};

/* ================================================================== */
/* 网络                                                               */
/* ================================================================== */

async function api(path, opts = {}) {
  if (window.CloudAPI) return window.CloudAPI.request(path, opts);
  const headers = {
    'X-User': encodeURIComponent(state.me || '匿名'),
    'X-Client-Id': state.clientId,
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    state.requiresCode = true;
    showLogin();
    throw new Error('需要访问码');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const send = (path, method, body) => api(path, { method, body: body ? JSON.stringify(body) : undefined });

function toast(msg, kind, action) {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${kind || ''}${action ? ' has-act' : ''}`;
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.onclick = () => {
      el.remove();
      action.fn();
    };
    el.appendChild(b);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), action ? 7000 : 2400);
}

/* ================================================================== */
/* 启动                                                               */
/* ================================================================== */

async function boot() {
  try {
    const data = await api('/api/bootstrap');
    state.revision = data.revision;
    state.settings = data.settings;
    state.students = data.students;
    state.weeks = data.weeks;
    state.log = data.log;
    state.server = data.server || null;
    state.share = (data.server && data.server.share) || null;
    state.weekId = pickWeek(state.weeks);
    await loadWeek(state.weekId);
    const wanted = new URLSearchParams(location.search).get('view');
    if (wanted && NAV.some((n) => n.id === wanted)) state.view = wanted;
    renderShell();
    render();
    if (!state.me) askName(true);
    startTimers();
  } catch (err) {
    if (err.message !== '需要访问码') {
      $('#view').innerHTML = `<div class="empty"><div class="e-icon">⚠️</div><div class="e-title">连接失败</div><div class="e-sub">${esc(err.message)}</div></div>`;
    }
  }
}

async function loadWeek(id) {
  if (!id) {
    state.week = null;
    return;
  }
  const data = await api(`/api/week/${encodeURIComponent(id)}`);
  state.revision = data.revision;
  state.weekId = id;
  state.week = data.week;
  state.selected.clear();
}

function startTimers() {
  if (state.timers) return;
  state.timers = true;
  setInterval(pollSync, window.CLOUD_MODE ? 8000 : 4000);
  setInterval(pingPresence, 18000);
  pingPresence();
}

function busyTyping() {
  const el = document.activeElement;
  return el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

async function pollSync() {
  if (state.editing || document.hidden) return;
  try {
    const data = await api(`/api/sync?rev=${state.revision}`);
    if (!data.changed) {
      setSync('ok', '已同步');
      return;
    }
    state.weeks = data.weeks;
    await loadWeek(state.weekId);
    setSync('ok', '已同步');
    if (state.view !== 'paste' && !busyTyping()) {
      renderShell();
      render();
    }
  } catch {
    setSync('warn', '连接中断');
  }
}

async function pingPresence() {
  if (window.CLOUD_MODE) {
    setSync('ok', '已连接云端');
    return;
  }
  try {
    const data = await api('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ name: state.me || '匿名', page: state.view }),
    });
    state.online = data.online || [];
    renderPresence();
    setSync('ok', `已同步 · ${state.online.length} 人在线`);
  } catch {
    /* 忽略 */
  }
}

function setSync(kind, text) {
  const el = $('#syncLine');
  if (!el) return;
  el.className = `sync ${kind}`;
  el.lastElementChild.textContent = text;
}

/* ================================================================== */
/* 外壳                                                               */
/* ================================================================== */

const NAV = [
  { id: 'week', label: '本周名单', icon: 'calendar' },
  { id: 'paste', label: '粘贴识别', icon: 'paste' },
  { id: 'groups', label: '按班组看', icon: 'users' },
  { id: 'dorms', label: '按宿舍看', icon: 'bed' },
  { id: 'students', label: '学生名册', icon: 'book' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const TITLES = {
  week: ['本周名单', '按班组、时间、宿舍查看与核对'],
  paste: ['粘贴识别', '把群里的请假文案贴进来，自动拆分姓名 / 时间 / 宿舍 / 班组'],
  groups: ['按班组看', '每个班组本周谁请假、什么时候走'],
  dorms: ['按宿舍看', '按宿舍号汇总，方便宿管对账'],
  students: ['学生名册', '243 人基础信息，可补录与修改'],
  settings: ['设置', '截止时间、成员、备份与日志'],
};

function renderShell() {
  $('#brandSub').textContent = state.settings.org || '周六超能班';
  const nav = $('#nav');
  nav.innerHTML = NAV.map((item) => {
    const active = state.view === item.id ? ' active' : '';
    const count = item.id === 'week' && state.week ? `<span class="nav-count">${state.week.records.length}</span>` : '';
    return `<button class="nav-item${active}" data-action="nav" data-view="${item.id}">
      <svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg><span>${item.label}</span>${count}
    </button>`;
  }).join('');
  const [title, sub] = TITLES[state.view] || TITLES.week;
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;
  $('#meName').textContent = state.me || '未设置称呼';
  $('#meAvatar').textContent = (state.me || '?').slice(0, 1);
  renderPresence();
}

function renderPresence() {
  const box = $('#presence');
  if (!box) return;
  if (window.CLOUD_MODE) {
    box.innerHTML = '';
    return;
  }
  const list = state.online.filter((x) => x.id !== state.clientId);
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  const shown = list.slice(0, 4);
  box.innerHTML =
    shown.map((p) => `<span class="pv" title="${esc(p.name)}">${esc((p.name || '?').slice(0, 1))}</span>`).join('') +
    (list.length > 4 ? `<span class="pv more">+${list.length - 4}</span>` : '');
}

/* ================================================================== */
/* 视图分发                                                           */
/* ================================================================== */

function render() {
  const view = $('#view');
  switch (state.view) {
    case 'paste':
      view.innerHTML = '';
      view.appendChild(renderPaste());
      renderPreview();
      {
        const s = $('#parseSummary');
        if (s && state.preview.length) s.textContent = `识别 ${state.preview.length} 条，跳过 ${state.skipped.length} 行`;
      }
      break;
    case 'groups':
      view.innerHTML = renderGroups();
      break;
    case 'dorms':
      view.innerHTML = renderDorms();
      break;
    case 'students':
      view.innerHTML = renderStudents();
      renderRosterPreview();
      renderStudentTable();
      break;
    case 'settings':
      view.innerHTML = renderSettings();
      if (!state.share || !state.share.running) {
        refreshShare().then(() => {
          if (state.view === 'settings') {
            const box = $('#shareUrl');
            if (!box && state.share && state.share.running) render();
          }
        });
      }
      break;
    default:
      view.innerHTML = renderWeekShell();
      renderWeekTable();
  }
  document.body.dataset.view = state.view;
}

/* ================================================================== */
/* 本周名单                                                            */
/* ================================================================== */

function recordKey(r) {
  return `${r.name}|${r.startAt || ''}`;
}

/** 班组排序：超能一1组 → 超能一2组 → … → 超能三4组 → 丰泰班1组 */
function groupRank(g) {
  const s = String(g || '');
  const m = /超能\s*([一二三四])?\s*(\d)\s*组/.exec(s);
  if (m) return [0, m[1] ? '一二三四'.indexOf(m[1]) + 1 : 0, +m[2]];
  const f = /丰泰\s*班?\s*(\d)\s*组/.exec(s);
  if (f) return [1, 0, +f[1]];
  return [2, 0, 0];
}

function cmpGroup(a, b) {
  const A = groupRank(a);
  const B = groupRank(b);
  return A[0] - B[0] || A[1] - B[1] || A[2] - B[2] || String(a || '').localeCompare(String(b || ''), 'zh');
}

function sortedRecords() {
  return [...(state.week ? state.week.records : [])].sort((a, b) => {
    if (state.sortBy === 'group') {
      const g = cmpGroup(a.group, b.group);
      if (g) return g;
    }
    if (state.sortBy === 'dorm') {
      const d = String(a.dorm || '').localeCompare(String(b.dorm || ''), 'zh');
      if (d) return d;
    }
    if (a.startAt && b.startAt && a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
    if (a.startAt && !b.startAt) return -1;
    if (!a.startAt && b.startAt) return 1;
    return String(a.name).localeCompare(String(b.name), 'zh');
  });
}

function filteredRecords() {
  const q = state.query.trim();
  return sortedRecords().filter((r) => {
    if (state.filter !== 'all' && r.category !== state.filter) return false;
    if (!q) return true;
    return [r.name, r.dorm, r.group, r.reason, r.note].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase()));
  });
}

function renderWeekShell() {
  const w = state.week;
  if (!w) {
    return `<div class="empty"><div class="e-icon">📅</div><div class="e-title">还没有这一周</div><div class="e-sub">点右上角「添加请假」，或到「粘贴识别」导入</div></div>`;
  }
  const total = w.records.length;
  const counts = { early: 0, sat: 0, sun: 0, other: 0 };
  w.records.forEach((r) => (counts[r.category] = (counts[r.category] || 0) + 1));
  const onLeave = new Set(w.records.map((r) => r.name)).size;
  const groups = new Set(w.records.map((r) => r.group).filter(Boolean)).size;
  const sent = w.records.filter((r) => r.slip && r.slip.sent).length;
  const written = w.records.filter((r) => r.slip && r.slip.written).length;
  const paper = w.records.filter((r) => r.check === 'paper').length;
  const left = w.records.filter((r) => r.check === 'left').length;
  const pct = total ? Math.round((sent / total) * 100) : 0;
  const pctChecked = total ? Math.round(((paper + left) / total) * 100) : 0;

  const isThisWeek = w.saturday === thisSaturdayIso();
  const wkNo = termWeekNo(w.saturday);
  const sun = new Date(w.saturday + 'T12:00:00');
  sun.setDate(sun.getDate() + 1);
  const range = `${md(w.saturday)} – ${md(isoOfDate(sun))}`;
  return `
  <section class="hero">
    <div class="hero-main">
      <div class="hero-kicker">Weekend Leave · 周末请假</div>
      <div class="hero-weekbar">
        <button class="wkb-nav" data-action="prevWeek" title="上一周" aria-label="上一周"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="wkb-mid">
          <div class="wkb-title">第 ${wkNo} 周${isThisWeek ? '<span class="wkb-now">本周</span>' : ''}</div>
          <div class="wkb-range">${range}</div>
        </div>
        <button class="wkb-nav" data-action="nextWeek" title="下一周" aria-label="下一周"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        ${isThisWeek ? '' : `<button class="btn sm wkb-back" data-action="thisWeek">回到本周</button>`}
      </div>
      <div class="hero-meta">截止 ${md(w.saturday)} ${w.cutoff || '21:30'} · 覆盖 ${groups} 个班组 · ${onLeave} 人请假 · 其余 ${Math.max(0, state.students.length - onLeave)} 人在校</div>
    </div>
    <div class="hero-stats">
      <div class="hs"><b>${total}</b><span>请假总数</span></div>
      <div class="hs early"><b>${counts.early}</b><span>提前请假</span></div>
      <div class="hs sat"><b>${counts.sat}</b><span>周六</span></div>
      <div class="hs sun"><b>${counts.sun}</b><span>周日</span></div>
    </div>
    <div class="hero-progress">
      <span>假条已发 ${sent} / ${total || 0}</span>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span>已写 ${written}</span>
    </div>
    <div class="hero-progress hero-check">
      <span class="ck-dot paper"></span><span>有实物 ${paper}</span>
      <div class="bar check"><i style="width:${pctChecked}%"></i></div>
      <span class="ck-dot left"></span><span>已走 ${left}</span>
      <span class="ck-rest">未核对 ${Math.max(0, total - paper - left)}</span>
    </div>
  </section>

  <div class="toolbar">
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg>
      <input type="search" id="weekSearch" placeholder="搜索姓名 / 宿舍 / 班组 / 原因" value="${esc(state.query)}">
    </div>
    <div class="chips">
      ${chip('all', '全部', total)}
      ${chip('early', '提前', counts.early, 'c-early')}
      ${chip('sat', '周六', counts.sat, 'c-sat')}
      ${chip('sun', '周日', counts.sun, 'c-sun')}
      ${chip('other', '其他', counts.other)}
    </div>
    <span class="spacer"></span>
    <button class="btn sm" data-action="copySummary" title="按周末整理成一段文字，方便发群或打印">复制汇总</button>
    <div class="segment">
      ${seg('group', '按班组')}
      ${seg('time', '按时间')}
      ${seg('dorm', '按宿舍')}
    </div>
  </div>

  <div class="table-wrap"><div class="table-scroll" id="tableHost"></div></div>
  <div id="bulkHost"></div>`;
}

const chip = (id, label, n, cls) =>
  `<button class="chip ${cls || ''}${state.filter === id ? ' active' : ''}" data-action="filter" data-filter="${id}">${label}<span class="n">${n}</span></button>`;
const seg = (id, label) =>
  `<button class="${state.sortBy === id ? 'active' : ''}" data-action="sort" data-sort="${id}">${label}</button>`;

function timeCell(r) {
  if (!r.startAt) return `<span class="mono" style="color:var(--muted)">${esc(r.timeRaw || '未填写')}</span>`;
  const a = parseISO(r.startAt);
  const b = r.endAt ? parseISO(r.endAt) : null;
  const sameDay = b && `${b.y}-${b.m}-${b.d}` === `${a.y}-${a.m}-${a.d}`;
  return `<span class="mono t1">${a.m}月${a.d}日 ${hm(r.startAt)}</span>${
    b
      ? `<span class="mono arrow">→</span><span class="mono t2">${sameDay ? hm(r.endAt) : `${b.m}月${b.d}日 ${hm(r.endAt)}`}</span>`
      : ''
  }`;
}

function avatarClass(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return ['', 'a', 'b', 'c', 'd'][h];
}

const CHECK_ORDER = ['', 'paper', 'left'];
const CHECK_LABEL = { '': '未核对', paper: '有实物', left: '已走' };

function rowHtml(r) {
  const sel = state.selected.has(r.id);
  const slip = r.slip || {};
  const missing = !state.students.some((s) => s.name === r.name);
  return `<tr class="row chk-${r.check || 'none'}" data-action="openRecord" data-id="${r.id}">
    <td class="col-check"><input type="checkbox" data-check="${r.id}" ${sel ? 'checked' : ''}></td>
    <td>
      <div class="person">
        <span class="pav ${avatarClass(r.name)}">${esc((r.name || '?').slice(0, 1))}</span>
        <div style="min-width:0">
          <div class="pname">${esc(r.name || '未识别')}${missing ? ' <span class="badge pt-unk" style="height:18px">名册外</span>' : ''}</div>
          <div class="pnote">${esc(r.dorm || '无宿舍')}${r.group ? ' · ' + esc(r.group) : ''}</div>
        </div>
      </div>
    </td>
    <td class="hide-sm"><span class="badge plain">${esc(r.dorm || '—')}</span></td>
    <td class="hide-sm"><span class="badge b-${r.category}">${CATEGORY_LABEL[r.category] || '其他'}</span></td>
    <td class="tcell-time">${timeCell(r)}</td>
    <td class="reason hide-sm">${esc(r.reason || '—')}</td>
    <td>
      <div class="slip">
        <button data-action="slip" data-id="${r.id}" data-field="written" class="${slip.written ? 'on' : ''}" title="假条已写">写</button>
        <button data-action="slip" data-id="${r.id}" data-field="sent" class="${slip.sent ? 'on sent' : ''}" title="假条已发">发</button>
      </div>
    </td>
    <td>
      <div>
        <button class="chk ${r.check || 'none'}" data-action="chk" data-id="${r.id}" title="点一下切换：有实物（黄）→ 学生已走（蓝）→ 取消">${CHECK_LABEL[r.check || '']}</button>
      </div>
    </td>
  </tr>`;
}

function renderWeekTable() {
  const host = $('#tableHost');
  if (!host) return;
  const list = filteredRecords();
  if (!list.length) {
    host.innerHTML = `<div class="empty"><div class="e-icon">🗒️</div><div class="e-title">${state.week && state.week.records.length ? '没有匹配的记录' : '这一周还没有请假'}</div>
      <div class="e-sub">${state.week && state.week.records.length ? '换个筛选条件或清空搜索' : '去「粘贴识别」把群消息贴进来，或点右上角「添加请假」'}</div></div>`;
    renderBulk();
    return;
  }

  let rows = '';
  let lastGroup = null;
  if (state.sortBy === 'group') {
    for (const r of list) {
      const g = r.group || '未分组';
      if (g !== lastGroup) {
        const n = list.filter((x) => (x.group || '未分组') === g).length;
        rows += `<tr class="group-row"><td colspan="8">${esc(g)}<span class="gcount">${n} 人</span></td></tr>`;
        lastGroup = g;
      }
      rows += rowHtml(r);
    }
  } else {
    rows += list.map(rowHtml).join('');
  }

  host.innerHTML = `<table class="data">
    <thead><tr>
      <th class="col-check"><input type="checkbox" id="checkAll" ${list.every((r) => state.selected.has(r.id)) && list.length ? 'checked' : ''}></th>
      <th>学生</th><th class="hide-sm">宿舍</th><th class="hide-sm">分类</th><th>请假时间</th><th class="hide-sm">原因 / 备注</th><th>假条</th><th>核对</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  renderBulk();
}

function renderBulk() {
  const host = $('#bulkHost');
  if (!host) return;
  const n = state.selected.size;
  if (!n) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<div class="bulkbar">
    <span class="bt">已选 <b>${n}</b> 条</span>
    <button class="btn" data-action="bulkSlip" data-field="written" data-value="1">标记已写</button>
    <button class="btn" data-action="bulkSlip" data-field="sent" data-value="1">标记已发</button>
    <button class="btn" data-action="bulkSlip" data-field="sent" data-value="0">取消已发</button>
    <button class="btn chkbtn paper" data-action="bulkCheck" data-value="paper">核对：有实物</button>
    <button class="btn chkbtn left" data-action="bulkCheck" data-value="left">核对：已走</button>
    <button class="btn" data-action="bulkCheck" data-value="">清除核对</button>
    <button class="btn danger" data-action="bulkDelete">删除</button>
    <button class="btn" data-action="clearSel">取消选择</button>
  </div>`;
}

/* ================================================================== */
/* 粘贴识别                                                            */
/* ================================================================== */

function renderPaste() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="paste-grid">
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">粘贴请假文案</div><div class="card-sub">一行一个人，支持 <code>1.</code> 编号、一句话写多人、时间写得随意</div></div>
        <span class="spacer"></span>
        <button class="btn sm" data-action="pasteSample">填入示例</button>
        <button class="btn sm" data-action="pasteClip">读剪贴板</button>
      </div>
      <div class="card-body">
        <textarea class="paste-area" id="pasteInput" placeholder="例如：
1. 郑博洋 B513 超能二3组 8月15日21:30至8月16日20:00 回家
2. 王蕾淇 A231 超能一1组 周六晚上21点半到周日晚上8点 家里有事
8月15日 21:30-8月16日 20:00 张萌悦 A612 超能三1组">${esc(state.pasteText)}</textarea>
        <div class="paste-foot">
          <button class="btn primary" data-action="doParse">识别文案</button>
          <button class="btn ghost" data-action="pasteClear">清空</button>
          <span class="hint" id="parseSummary"></span>
        </div>
        <div class="hint" style="margin-top:10px">识别不出来的行会列在下面，可手动补时间或姓名。名册外的姓名会标红，确认后可一键补录进名册。</div>
      </div>
    </div>
    <div id="previewHost"></div>
  </div>`;
  return wrap.firstElementChild;
}

function renderPreview() {
  const host = $('#previewHost');
  if (!host) return;
  if (!state.preview.length) {
    host.innerHTML = state.skipped.length
      ? `<div class="card"><div class="card-head"><div class="card-title">未识别的内容</div></div><div class="card-body">
          <div class="skipped">以下 ${state.skipped.length} 行没能识别出姓名或时间，可修改原文后重试：<pre>${esc(state.skipped.join('\n'))}</pre></div>
        </div></div>`
      : '';
    return;
  }

  const existing = new Set((state.week ? state.week.records : []).map(recordKey));
  const rosterNames = new Set(state.students.map((s) => s.name));
  const rows = state.preview.map((p, i) => {
    const dup = existing.has(`${p.name}|${p.startAt || ''}`);
    const known = rosterNames.has(p.name);
    const far = (p.warnings || []).some((w) => w.includes('不在本周'));
    const tag =
      (far ? '<span class="preview-tag pt-far">不在本周</span>' : '') +
      (dup
        ? '<span class="preview-tag pt-dup">重复</span>'
        : !known
        ? '<span class="preview-tag pt-unk">名册外</span>'
        : p.confidence && p.confidence.name === 'fuzzy'
        ? '<span class="preview-tag pt-fuzzy">纠错</span>'
        : '<span class="preview-tag pt-new">新增</span>');
    const options = state.students
      .map((s) => `<option value="${esc(s.name)}" ${s.name === p.name ? 'selected' : ''}>${esc(s.name)}</option>`)
      .join('');
    return `<tr data-idx="${i}">
      <td class="col-check"><input type="checkbox" data-pcheck="${i}" ${p.include ? 'checked' : ''}></td>
      <td>
        <select data-pfield="name" data-idx="${i}" style="height:32px;min-width:96px">
          <option value="" ${!p.name ? 'selected' : ''}>未识别</option>
          ${options}
          ${!known && p.name ? `<option value="${esc(p.name)}" selected>${esc(p.name)}（名册外）</option>` : ''}
        </select>
        ${p.rawName && p.rawName !== p.name ? `<div class="pnote">原文：${esc(p.rawName)}</div>` : ''}
        ${p.phone ? `<div class="pnote">家长 ${esc(p.contact || '')} ${esc(p.phone)}</div>` : ''}
      </td>
      <td><input type="text" data-pfield="dorm" data-idx="${i}" value="${esc(p.dorm)}" placeholder="宿舍" style="height:32px;width:78px"></td>
      <td class="hide-sm"><input type="text" data-pfield="group" data-idx="${i}" value="${esc(p.group)}" placeholder="班组" style="height:32px;width:104px"></td>
      <td><input type="text" data-pfield="time" data-idx="${i}" value="${esc(p.timeText)}" placeholder="如 8月15日21:30至8月16日20:00" style="height:32px;min-width:230px"></td>
      <td><span class="badge b-${categoryOf(p.startAt, weekCtx())}">${CATEGORY_LABEL[categoryOf(p.startAt, weekCtx())]}</span></td>
      <td>${tag}${!known && p.name ? `<button class="btn sm" data-action="quickAdd" data-idx="${i}" style="margin-left:6px">补录</button>` : ''}</td>
      <td><button class="icon-btn" data-action="dropPreview" data-idx="${i}" title="移除">✕</button></td>
    </tr>`;
  });

  const usable = state.preview.filter((p) => p.include && p.name && p.startAt).length;

  const firstAt = (state.preview.find((p) => p.startAt) || {}).startAt || '';
  const target = weekendOfRecord(firstAt);
  const away = target && state.week && target !== state.week.saturday;
  const banner = away
    ? `<div class="banner-warn">这段文案属于 <b>${md(target)} ${wd(target)}</b> 那一周，当前打开的是 ${md(state.week.saturday)}。
        <button class="btn sm" data-action="moveWeek" data-sat="${target}">切到 ${md(target)} 这一周并导入</button></div>`
    : '';

  host.innerHTML = `<div class="card">
    <div class="card-head">
      <div><div class="card-title">识别结果</div><div class="card-sub">确认后导入到 ${state.week ? md(state.week.saturday) + ' ' + wd(state.week.saturday) : '本周'}</div></div>
      <span class="spacer"></span>
      <button class="btn primary" data-action="doImport">导入 ${usable} 条</button>
    </div>
    ${banner}
    <div class="table-scroll" style="max-height:none">
      <table class="data"><thead><tr>
        <th class="col-check"></th><th>姓名</th><th>宿舍</th><th class="hide-sm">班组</th><th>请假时间</th><th>分类</th><th>状态</th><th></th>
      </tr></thead><tbody>${rows.join('')}</tbody></table>
    </div>
  </div>`;
}

function weekCtx() {
  return { saturday: state.week ? state.week.saturday : '', cutoff: (state.week && state.week.cutoff) || state.settings.cutoff };
}

function isoOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 今天所属周末的周六（周日归前一天，周中归后面的周六） */
function weekendOfToday() {
  return weekendOfRecord(isoOfDate(new Date()));
}

/** 默认打开离今天最近的那一周 */
function pickWeek(weeks) {
  if (!weeks || !weeks.length) return '';
  const cur = weekendOfToday();
  let best = weeks[0];
  let bestD = Infinity;
  for (const w of weeks) {
    const g = Math.abs(dayGap(cur, w.saturday));
    if (g < bestD) {
      bestD = g;
      best = w;
    }
  }
  return best.id;
}

/** 学期周号：以 7 月第一个周六为第 1 周（与周表 7.11 对齐） */
function termWeekNo(satIso) {
  const d = new Date(satIso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  const y = d.getFullYear();
  const first = new Date(y, 6, 1); // 7 月 1 日
  first.setDate(first.getDate() + ((6 - first.getDay() + 7) % 7));
  let no = Math.round((d.getTime() - first.getTime()) / 604800000) + 1;
  if (no <= 0) {
    // 1–6 月归上一学年（前一年 7 月起）
    const first2 = new Date(y - 1, 6, 1);
    first2.setDate(first2.getDate() + ((6 - first2.getDay() + 7) % 7));
    no = Math.round((d.getTime() - first2.getTime()) / 604800000) + 1;
  }
  return no;
}

/** 本周（今天所属周末）的周六 ISO */
function thisSaturdayIso() {
  return weekendOfRecord(isoOfDate(new Date()));
}

/** 一条请假时间属于哪个周末（周六）；周中的请假归到后面的周六 */
function weekendOfRecord(iso) {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const wd = d.getDay();
  const shift = wd === 0 ? -1 : wd === 6 ? 0 : 6 - wd;
  return isoOfDate(new Date(d.getTime() + shift * 86400000));
}

function refOfWeek() {
  const ctx = weekCtx();
  if (!ctx.saturday) return { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() };
  const p = ctx.saturday.split('-');
  return { y: +p[0], m: +p[1], d: +p[2] };
}

function doParse() {
  const text = ($('#pasteInput') || {}).value || '';
  if (!text.trim()) {
    toast('先粘贴文案', 'err');
    return;
  }
  const ctx = buildContext(state.students, weekCtx());
  const out = parseText(text, ctx);
  state.pasteText = text;
  state.preview = out.records.map((r, i) => ({
    ...r,
    key: `p${i}`,
    include: !!r.name && !!r.startAt,
    timeText: r.startAt ? timeTextOf(r) : r.timeRaw || '',
  }));
  state.skipped = out.skipped;
  const s = $('#parseSummary');
  if (s) s.textContent = `识别 ${out.records.length} 条，跳过 ${out.skipped.length} 行`;
  renderPreview();
  if (out.records.length) toast(`识别出 ${out.records.length} 条`, 'ok');
  else toast('没识别出内容，看看下面的未识别部分', 'err');
}

/* ================================================================== */
/* 分组 / 宿舍 / 名册 / 历史 / 设置                                     */
/* ================================================================== */

function recordsOfWeek() {
  return state.week ? state.week.records : [];
}

function renderGroups() {
  const recs = sortedRecords();
  const groups = new Map();
  for (const s of state.students) {
    const g = s.group || '未分组';
    if (!groups.has(g)) groups.set(g, { name: g, total: 0, items: [] });
    groups.get(g).total++;
  }
  for (const r of recs) {
    const g = r.group || '未分组';
    if (!groups.has(g)) groups.set(g, { name: g, total: 0, items: [] });
    groups.get(g).items.push(r);
  }
  const list = [...groups.values()].sort((a, b) => cmpGroup(a.name, b.name));
  const cards = list
    .map((g) => {
      const items = g.items
        .map(
          (r) => `<div class="gitem">
            <span class="pav ${avatarClass(r.name)}" style="width:24px;height:24px;font-size:11px">${esc((r.name || '?').slice(0, 1))}</span>
            <span class="gname">${esc(r.name)}</span>
            <span class="badge plain hide-sm">${esc(r.dorm || '—')}</span>
            <span class="gtime">${r.startAt ? `${md(r.startAt.slice(0, 10))} ${hm(r.startAt)}` : '待补时间'}</span>
          </div>`
        )
        .join('');
      return `<div class="gcard">
        <div class="gcard-head"><span class="gcard-title">${esc(g.name)}</span><span class="gcard-meta">${g.items.length}/${g.total}</span></div>
        <div class="gcard-list">${items || '<div class="gitem" style="color:var(--muted);font-size:12.5px">本周无人请假</div>'}</div>
        <div class="gcard-foot"><div class="progress"><i style="width:${g.total ? Math.round((g.items.length / g.total) * 100) : 0}%"></i></div><span>${g.items.length ? `${g.items.length} 人请假` : '全勤'}</span></div>
      </div>`;
    })
    .join('');
  return `<div class="grid-cards">${cards}</div>`;
}

function renderDorms() {
  const recs = sortedRecords();
  const map = new Map();
  for (const r of recs) {
    const key = r.dorm || '未登记宿舍';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === '走读') return 1;
    if (b === '走读') return -1;
    if (a === '未登记宿舍') return 1;
    if (b === '未登记宿舍') return -1;
    return a.localeCompare(b);
  });
  if (!keys.length) {
    return `<div class="empty"><div class="e-icon">🛏️</div><div class="e-title">本周还没有请假记录</div><div class="e-sub">导入或添加后，这里会按宿舍号汇总</div></div>`;
  }
  const cards = keys
    .map((k) => {
      const items = map.get(k);
      const head = `<div class="gcard-head"><span class="gcard-title mono" style="font-size:13px">${esc(k)}</span><span class="gcard-meta">${items.length} 人</span></div>`;
      const body = items
        .map(
          (r) => `<div class="gitem">
            <span class="pav ${avatarClass(r.name)}" style="width:24px;height:24px;font-size:11px">${esc((r.name || '?').slice(0, 1))}</span>
            <span class="gname">${esc(r.name)}</span>
            <span class="badge b-${r.category}" style="height:19px;font-size:10.5px">${CATEGORY_LABEL[r.category]}</span>
            <span class="gtime">${r.startAt ? `${md(r.startAt.slice(0, 10))} ${hm(r.startAt)}` : '待补时间'}</span>
          </div>`
        )
        .join('');
      return `<div class="gcard">${head}<div class="gcard-list">${body}</div></div>`;
    })
    .join('');
  return `<div class="hint" style="margin-bottom:12px">按宿舍号汇总本周请假，宿舍号取「学生名册」里的登记值，名册没有时取文案里写的。</div><div class="grid-cards">${cards}</div>`;
}

function renderStudents() {
  return `
  <div class="card">
    <div class="card-head">
      <div>
        <div class="card-title">粘贴名单，自动更新宿舍 / 班组 / 班级</div>
        <div class="card-sub">一行一个学生，字段顺序随便写：姓名 + 宿舍 + 班组 + 班级（Excel 里直接复制、制表符分隔也行）</div>
      </div>
      <span class="spacer"></span>
      <button class="btn sm" data-action="rosterSample">填入示例</button>
      <button class="btn sm" data-action="rosterClear">清空</button>
    </div>
    <div class="card-body">
      <textarea class="paste-area" id="rosterInput" style="min-height:150px" placeholder="张三 A231 超能二1组 超能2班
李四 走读 丰泰班1组 丰泰班 13800000000
王五 B513 超能三3组">${esc(state.rosterText || '')}</textarea>
      <div class="paste-foot">
        <button class="btn primary" data-action="parseRoster">识别名单</button>
        <label class="hint" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="rosterCreate" ${state.rosterCreate ? 'checked' : ''}> 名册外的姓名一并新增
        </label>
        <span class="hint" id="rosterSummary"></span>
      </div>
    </div>
  </div>
  <div id="rosterPreviewHost"></div>

  <div class="toolbar" style="margin-top:18px">
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg>
      <input type="search" id="studentSearch" placeholder="搜索姓名 / 宿舍 / 班组" value="${esc(state.query)}">
    </div>
    <span class="spacer"></span>
    <button class="btn sm${state.onlyMissing ? ' primary' : ''}" data-action="stuMissing">缺宿舍 ${state.students.filter((s) => !s.dorm).length}</button>
    <button class="btn" data-action="exportRoster">导出名册 CSV</button>
    <button class="btn primary" data-action="addStudent">补录学生</button>
  </div>
  <div class="table-wrap"><div class="table-scroll" id="studentHost"></div></div>`;
}

function rosterDiff(oldV, newV) {
  if (!newV) return '<span class="hint">—</span>';
  const o = oldV || '';
  if (o === newV) return `<span class="mono">${esc(newV)}</span>`;
  return `<span class="mono">${esc(o || '空')}</span><span class="arrow">→</span><span class="mono newv">${esc(newV)}</span>`;
}

function renderRosterPreview() {
  const host = $('#rosterPreviewHost');
  if (!host) return;
  const rows = state.rosterPreview || [];
  if (!rows.length) {
    host.innerHTML = state.rosterSkipped && state.rosterSkipped.length
      ? `<div class="card"><div class="card-head"><div class="card-title">没认出来的行</div></div><div class="card-body"><pre class="skipped">${esc(state.rosterSkipped.join('\n'))}</pre></div></div>`
      : '';
    return;
  }
  const n = rows.filter((r) => r.include && (r.matched || state.rosterCreate)).length;
  host.innerHTML = `<div class="card">
    <div class="card-head">
      <div><div class="card-title">确认修改</div><div class="card-sub">共 ${rows.length} 行，勾选的会写进名册；「名册外」的行需要勾上上面的复选框才会新增</div></div>
      <span class="spacer"></span>
      <button class="btn primary" data-action="applyRoster" ${n ? '' : 'disabled'}>应用 ${n} 条</button>
    </div>
    <div class="table-scroll"><table class="data">
      <thead><tr><th class="col-check"></th><th>姓名</th><th>宿舍</th><th>班组</th><th class="hide-sm">班级</th><th>状态</th></tr></thead>
      <tbody>${rows
        .map(
          (r, i) => `<tr class="row">
        <td class="col-check"><input type="checkbox" data-roster-check="${i}" ${r.include ? 'checked' : ''}></td>
        <td><div class="person"><span class="pav ${avatarClass(r.name)}">${esc(r.name.slice(0, 1))}</span><span class="pname">${esc(r.name)}</span></div></td>
        <td>${rosterDiff(r.before ? r.before.dorm : '', r.dorm)}</td>
        <td>${rosterDiff(r.before ? r.before.group : '', r.group)}</td>
        <td class="hide-sm">${rosterDiff(r.before ? r.before.className : '', r.className)}</td>
        <td>${r.matched ? (r.changed ? '<span class="badge b-sat">更新</span>' : '<span class="hint">无变化</span>') : '<span class="badge pt-unk">名册外</span>'}</td>
      </tr>`
        )
        .join('')}</tbody></table></div>
  </div>`;
}

const ROSTER_SAMPLE = `刘柏萍 A231 超能一1组 超能1班
关伊萌 B312 丰泰班2组 丰泰班
陈雯睿 A533 超能一1组 超能1班
李映 A233 超能三2组 超能3班
何锦晨 A612 超能二1组 超能2班`;

function doParseRoster() {
  const text = ($('#rosterInput') || {}).value || '';
  if (!text.trim()) {
    toast('先粘贴名单', 'err');
    return;
  }
  state.rosterText = text;
  const ctx = buildContext(state.students, weekCtx());
  const out = parseRosterText(text, ctx);
  const map = new Map();
  for (const r of out.rows) {
    const before = r.before || { dorm: '', group: '', className: '' };
    const changed = !r.matched || ['dorm', 'group', 'className'].some((k) => r[k] && r[k] !== before[k]);
    map.set(r.name, { ...r, changed, include: changed });
  }
  state.rosterPreview = [...map.values()];
  state.rosterSkipped = out.skipped;
  renderRosterPreview();
  const s = $('#rosterSummary');
  if (s) s.textContent = `识别 ${state.rosterPreview.length} 人，跳过 ${out.skipped.length} 行`;
  toast(`识别 ${state.rosterPreview.length} 人`, 'ok');
}

async function applyRoster() {
  const rows = (state.rosterPreview || []).filter((r) => r.include && (r.matched || state.rosterCreate));
  if (!rows.length) {
    toast(state.rosterCreate ? '没有要应用的修改' : '没有可更新的行（名册外的人需要勾选「一并新增」）', 'err');
    return;
  }
  const students = rows.map((r) => {
    const o = { name: r.name };
    if (r.dorm) o.dorm = r.dorm;
    if (r.group) o.group = r.group;
    if (r.className) o.className = r.className;
    if (r.phone) o.phone = r.phone;
    return o;
  });
  const data = await send('/api/students/bulk', 'POST', { students, create: !!state.rosterCreate });
  state.students = data.students;
  state.revision = data.revision;
  state.rosterPreview = [];
  state.rosterSkipped = [];
  state.rosterText = '';
  render();
  toast(`已更新 ${data.updated} 人${data.added ? `，新增 ${data.added} 人` : ''}`, 'ok');
}

function renderStudentTable() {
  const host = $('#studentHost');
  if (!host) return;
  const q = state.query.trim().toLowerCase();
  const list = state.students.filter(
    (s) =>
      (!state.onlyMissing || !s.dorm) &&
      (!q || [s.name, s.dorm, s.group, s.className].some((v) => String(v || '').toLowerCase().includes(q)))
  );
  const onLeave = new Set(recordsOfWeek().map((r) => r.name));
  host.innerHTML = `<table class="data">
    <thead><tr><th>姓名</th><th>班组</th><th>宿舍</th><th class="hide-sm">班级</th><th class="hide-sm">本周</th><th></th></tr></thead>
    <tbody>${list
      .map(
        (s) => `<tr class="row">
        <td><div class="person"><span class="pav ${avatarClass(s.name)}">${esc(s.name.slice(0, 1))}</span><span class="pname">${esc(s.name)}</span></div></td>
        <td><span class="badge plain">${esc(s.group || '未分组')}</span></td>
        <td class="mono">${esc(s.dorm || '—')}</td>
        <td class="hide-sm">${esc(s.className || '—')}</td>
        <td class="hide-sm">${onLeave.has(s.name) ? '<span class="badge b-sat">请假</span>' : '<span class="hint">在校</span>'}</td>
        <td style="text-align:right"><button class="btn sm" data-action="editStudent" data-name="${esc(s.name)}">编辑</button></td>
      </tr>`
      )
      .join('')}</tbody></table>
    <div class="hint" style="padding:12px 14px;border-top:1px solid var(--line-2)">共 ${list.length} 人${list.length !== state.students.length ? `（名册 ${state.students.length} 人）` : ''}</div>`;
}

function renderShareCard() {
  if (window.CLOUD_MODE) return '';
  const sh = state.share || {};
  const running = !!sh.running;
  const code = sh.code || '';
  const dead = !running && !!sh.error;
  const body = running
    ? `<div class="field"><label>把这个地址发到群里</label>
         <div style="display:flex;gap:8px"><input type="text" id="shareUrl" readonly value="${esc(sh.url)}">
         <button class="btn sm" data-action="copyShare" data-which="url">复制</button></div></div>
       ${code ? `<div class="field"><label>访问码<span class="sub">对方第一次打开要输这个</span></label>
         <div style="display:flex;gap:8px"><input type="text" id="shareCode" readonly value="${esc(code)}">
         <button class="btn sm" data-action="copyShare" data-which="code">复制</button></div></div>` : ''}
       <div class="tip"><span>🔗</span><div>地址是临时的：<b>关掉分享或重启电脑就会变</b>，变了重新点一次「开启分享」即可。<br>
         链接谁拿到都能打开，所以系统自动加了访问码；只在本机用不需要码。</div></div>
       ${sh.provider === 'serveo' ? `<div class="tip" style="margin-top:12px"><span>👉</span><div>
         第一次打开会先看到一个<b>英文提示页</b>（Serveo Browser Warning），点页面上的 <b>Continue to Site</b> 就进来了，之后不会再出现。</div></div>` : ''}
       ${sh.healthy === false ? `<div class="tip" style="margin-top:12px;border-color:#fecaca;background:#fef2f2"><span>⚠️</span><div>
         最近一次自检没连上这个地址（免费隧道被限流时就是这样）。别人打不开的话，点下面「关闭分享」再重新开启，会拿到<b>新地址</b>。</div></div>` : ''}
       <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
         <button class="btn danger" data-action="shareStop">关闭分享</button>
         <button class="btn ghost" data-action="shareRefresh">刷新状态</button>
       </div>`
    : `<div class="hint">点下面的按钮，会生成一个 <b>https 公网地址</b>。同事在微信里点开就能用，同一个 Wi-Fi 都不需要，也不用装任何东西。</div>
       <div class="tip" style="margin-top:12px"><span>💡</span><div>
         · 不用装东西：走 Windows 自带 SSH，点一下十几秒出地址<br>
         · 地址是临时的，关掉分享或重启电脑会变，重新点一下就有新地址<br>
         · 开着的时候电脑别休眠，休眠了别人就打不开
         ${sh.error ? `<br>· <b style="color:#b91c1c">上次失败：${esc(sh.error)}</b>` : ''}
       </div></div>
       ${dead ? `<div class="tip" style="margin-top:12px;border-color:#fecaca;background:#fef2f2"><span>⚠️</span><div><b>公网地址已经断开</b>（免费隧道跑久了会被限流）。<br>重新开启会拿到一个<b>新地址</b>，记得把新链接重新发一次。</div></div>` : ''}
       <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
         <button class="btn primary" data-action="shareStart">${dead ? '重新开启（换新地址）' : '开启公网分享'}</button>
         ${sh.error ? '<button class="btn ghost" data-action="shareRefresh">刷新状态</button>' : ''}
       </div>`;
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <div><div class="card-title">远程分享（外网也能用）</div>
      <div class="card-sub">生成一个 https 地址，发给别人就能一起同步，不用同一个 Wi-Fi</div></div>
      <span class="spacer"></span>
      <span class="badge ${running ? 'ok' : dead ? 'warn' : 'plain'}">${running ? '已开启' : dead ? '已断开' : '未开启'}</span>
    </div>
    <div class="card-body">${body}</div>
  </div>`;
}

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
};

async function refreshShare() {
  try {
    const d = await api('/api/share');
    state.share = d;
  } catch {}
}

function renderSettings() {
  const s = state.settings;
  const ips = (state.server && state.server.ips) || [];
  const port = (state.server && state.server.port) || 8787;
  const weeks = state.weeks
    .map(
      (w) => `<div class="log-row"><span class="lt">${esc(w.saturday)}</span><span class="la">${md(w.saturday)} ${wd(w.saturday)}</span>
      <span class="ld">${w.total} 条请假 · 已发 ${w.sent} 张假条</span>
      <button class="btn sm" data-action="gotoWeek" data-id="${esc(w.id)}">打开</button>
      <button class="btn sm danger" data-action="delWeek" data-id="${esc(w.id)}">删除</button></div>`
    )
    .join('');
  const log = state.log
    .slice(0, 30)
    .map((l) => `<div class="log-row"><span class="lt">${esc(l.t)}</span><span class="la">${esc(l.action)}</span><span class="ld">${esc(l.detail)} — ${esc(l.by)}</span></div>`)
    .join('');
  const online = state.online.length
    ? state.online.map((p) => `<span class="badge plain" style="margin-right:6px">${esc(p.name)}</span>`).join('')
    : '<span class="hint">暂时只有你在线</span>';

  return `
  ${renderShareCard()}
  <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
    <div class="card"><div class="card-head"><div class="card-title">基础设置</div></div><div class="card-body">
      <div class="field"><label>组织名称</label><input type="text" id="setOrg" value="${esc(s.org || '')}"></div>
      <div class="field"><label>提前请假截止时间<span class="sub">早于周六的这个时间算「提前请假」</span></label>
        <input type="time" id="setCutoff" value="${esc(s.cutoff || '21:30')}"></div>
      <button class="btn primary" data-action="saveSettings">保存设置</button>
    </div></div>

    <div class="card"><div class="card-head"><div class="card-title">成员</div></div><div class="card-body">
      <div class="hint">当前在线</div>
      <div style="margin:8px 0 14px">${online}</div>
      <div class="field"><label>我的称呼</label><input type="text" id="setMe" value="${esc(state.me)}" placeholder="例如 王老师"></div>
      <button class="btn" data-action="saveMe">修改称呼</button>
    </div></div>

    <div class="card"><div class="card-head"><div class="card-title">数据</div></div><div class="card-body">
      <div class="hint">所有请假数据保存在本机 <code>data/store.json</code>，随时可备份。</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <a class="btn" href="/api/backup">下载备份 JSON</a>
        <a class="btn" href="/api/export.xlsx?week=${esc(state.weekId)}">导出本周 Excel</a>
        <a class="btn" href="/api/export.csv?week=${esc(state.weekId)}">导出 CSV</a>
      </div>
      <div class="tip" style="margin-top:12px"><span>🗂️</span><div>把备份文件放进 <b>data/</b> 目录并改名 <b>store.json</b> 即可还原。</div></div>
    </div></div>
  </div>

  <div class="section-title">本周之外的周次</div>
  <div class="card"><div class="card-body"><div class="form-grid" style="align-items:end">
    <div class="field" style="margin:0"><label>新建一周（选那个周六）</label><input type="date" id="newWeekDate"></div>
    <div class="field" style="margin:0"><button class="btn primary" data-action="createWeek">新建</button></div>
  </div>
  <div class="list-rows" style="margin-top:12px">${weeks || '<div class="hint">还没有周次</div>'}</div>
  </div></div>

  <div class="section-title">操作日志</div>
  <div class="card"><div class="card-body"><div class="list-rows">${log || '<div class="hint">暂无记录</div>'}</div></div></div>`;
}

/* ================================================================== */
/* 弹窗                                                               */
/* ================================================================== */

function closeModal() {
  $('#modalRoot').innerHTML = '';
  state.editing = false;
}

function openModal({ title, body, foot, wide, onMount, closable = true }) {
  state.editing = true;
  $('#modalRoot').innerHTML = `<div class="backdrop" id="backdrop">
    <div class="modal ${wide ? 'wide' : ''}" role="dialog">
      <div class="modal-head"><div class="modal-title">${esc(title)}</div>
        ${closable ? '<button class="icon-btn" data-action="closeModal" aria-label="关闭">✕</button>' : ''}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot || ''}</div>
    </div>
  </div>`;
  const backdrop = $('#backdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closable) closeModal();
  });
  if (onMount) onMount();
}

function openRecordModal(id) {
  const week = state.week;
  if (!week) return;
  const rec = id ? week.records.find((r) => r.id === id) : null;
  const r = rec || {
    name: '',
    dorm: '',
    group: '',
    startAt: '',
    endAt: '',
    timeRaw: '',
    reason: '',
    note: '',
    slip: {},
  };
  const cat = r.startAt ? categoryOf(r.startAt, weekCtx()) : 'other';
  const body = `
    <div class="field-row">
      <div class="field"><label>姓名</label>
        <input type="text" id="fdName" list="rosterNames" value="${esc(r.name)}" placeholder="输入姓名，可从名册选">
        <datalist id="rosterNames">${state.students.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
      </div>
      <div class="field"><label>宿舍号</label><input type="text" id="fdDorm" value="${esc(r.dorm)}" placeholder="如 B513 / 走读"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>班组</label><input type="text" id="fdGroup" list="groupNames" value="${esc(r.group)}" placeholder="如 超能二3组">
        <datalist id="groupNames">${[...new Set(state.students.map((s) => s.group).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      </div>
      <div class="field"><label>分类<span class="sub">按开始时间自动判断</span></label>
        <div class="seg-pick"><button type="button" class="on">${CATEGORY_LABEL[cat]}</button></div>
      </div>
    </div>
    <div class="field"><label>时间文案<span class="sub">可以粘一段原文，点解析</span></label>
      <div class="time-parse"><input type="text" id="fdTimeText" value="${esc(r.startAt ? timeTextOf(r) : r.timeRaw || '')}" placeholder="如 8月15日21:30至8月16日20:00">
        <button class="btn" data-action="parseTimeText">解析</button></div>
      <div class="parse-note" id="parseNote"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>开始时间</label><input type="datetime-local" id="fdStart" value="${esc(r.startAt || '')}"></div>
      <div class="field"><label>结束时间<span class="sub">可不填</span></label><input type="datetime-local" id="fdEnd" value="${esc(r.endAt || '')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>家长姓名<span class="sub">学员提供</span></label><input type="text" id="fdContact" value="${esc(r.contact || '')}" placeholder="如 蔡娟"></div>
      <div class="field"><label>联系电话<span class="sub">学员提供</span></label><input type="text" id="fdPhone" value="${esc(r.phone || '')}" placeholder="如 13800000000"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>原因</label><input type="text" id="fdReason" value="${esc(r.reason)}" placeholder="如 回家 / 家里有事"></div>
      <div class="field"><label>假条</label>
        <div class="seg-pick">
          <button type="button" data-toggle-slip="written" class="${r.slip && r.slip.written ? 'on' : ''}">已写</button>
          <button type="button" data-toggle-slip="sent" class="${r.slip && r.slip.sent ? 'on' : ''}">已发</button>
        </div>
      </div>
    </div>
    <div class="field"><label>备注</label><input type="text" id="fdNote" value="${esc(r.note)}" placeholder="可选"></div>`;

  openModal({
    title: rec ? '编辑请假记录' : '添加请假',
    body,
    foot: `<button class="btn danger" id="fdDelete">${rec ? '删除' : ''}</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">取消</button>
      <button class="btn primary" data-action="saveRecord">保存</button>`,
    onMount: () => {
      const nameEl = $('#fdName');
      nameEl.addEventListener('change', () => {
        const st = state.students.find((s) => s.name === nameEl.value.trim());
        if (!st) return;
        const dorm = $('#fdDorm');
        const group = $('#fdGroup');
        if (!dorm.value) dorm.value = st.dorm || '';
        if (!group.value) group.value = st.group || '';
      });
      const del = $('#fdDelete');
      if (rec) del.dataset.action = 'deleteRecord';
      else del.style.display = 'none';
      $('#fdTimeText').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          parseTimeIntoForm();
        }
      });
      const start = $('#fdStart');
      start.addEventListener('change', () => {
        if (start.value) {
          const note = $('#parseNote');
          note.textContent = `分类：${CATEGORY_LABEL[categoryOf(start.value, weekCtx())]}`;
          note.className = 'parse-note ok';
        }
      });
      setTimeout(() => nameEl.focus(), 60);
    },
  });
  state.editId = rec ? rec.id : null;
}

function parseTimeIntoForm() {
  const text = ($('#fdTimeText') || {}).value || '';
  const res = parseTimeRange(text, refOfWeek());
  const note = $('#parseNote');
  if (!res.start) {
    note.textContent = '没能识别出时间，可以直接填下面的开始/结束';
    note.className = 'parse-note bad';
    return;
  }
  $('#fdStart').value = res.start;
  $('#fdEnd').value = res.end || '';
  note.textContent = `已识别：${md(res.start.slice(0, 10))} ${hm(res.start)} → ${res.end ? md(res.end.slice(0, 10)) + ' ' + hm(res.end) : '未填结束'} · ${CATEGORY_LABEL[categoryOf(res.start, weekCtx())]}`;
  note.className = 'parse-note ok';
}

function summaryLine(r) {
  const start = r.startAt ? `${md(r.startAt.slice(0, 10))} ${hm(r.startAt)}` : r.timeRaw || '时间待定';
  const end = r.endAt ? ` → ${md(r.endAt.slice(0, 10))} ${hm(r.endAt)}` : '';
  const who = [r.name || '未识别', r.dorm || '', r.group || ''].filter(Boolean).join(' ');
  return `${who} ${start}${end}${r.reason ? ' ' + r.reason : ''}`;
}

function buildSummaryText() {
  const w = state.week;
  if (!w || !w.records.length) return '';
  const list = w.records.slice().sort((a, b) => {
    const A = groupRank(a.group);
    const B = groupRank(b.group);
    return A[0] - B[0] || A[1] - B[1] || A[2] - B[2] || String(a.startAt || '').localeCompare(String(b.startAt || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  });
  const counts = { early: 0, sat: 0, sun: 0, other: 0 };
  list.forEach((r) => (counts[r.category] = (counts[r.category] || 0) + 1));
  const paper = list.filter((r) => r.check === 'paper').length;
  const left = list.filter((r) => r.check === 'left').length;
  const written = list.filter((r) => r.slip && r.slip.written).length;
  const sent = list.filter((r) => r.slip && r.slip.sent).length;
  const head = `【${state.settings.org || '周六超能班'}】第 ${termWeekNo(w.saturday)} 周 ${md(w.saturday)} ${wd(w.saturday)} 周末请假 ${list.length} 人`;
  const stats = `提前 ${counts.early} 人 / 周六 ${counts.sat} 人 / 周日 ${counts.sun} 人${counts.other ? ` / 其他 ${counts.other} 人` : ''}`;
  const slips = `假条：已写 ${written} · 已发 ${sent} · 有实物 ${paper} · 已走 ${left}`;
  const blocks = ['early', 'sat', 'sun', 'other']
    .filter((cat) => cat !== 'other' || counts.other)
    .map((cat) => {
      const rows = list.filter((r) => r.category === cat);
      return `\n【${CATEGORY_LABEL[cat]}】${rows.length} 人\n${rows.length ? rows.map((r) => '· ' + summaryLine(r)).join('\n') : '（无）'}`;
    })
    .join('\n');
  return `${head}\n${stats}\n${slips}\n${blocks}`;
}

async function copySummary() {
  const text = buildSummaryText();
  if (!text) {
    toast('这一周还没有记录', 'err');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('汇总已复制，可直接发群里', 'ok');
  } catch {
    openModal({
      title: '本周汇总',
      body: `<div class="hint">浏览器不让自动复制，下面全选后手动复制（Ctrl+A / Ctrl+C）。</div>
        <textarea class="paste-area" style="min-height:260px;margin-top:10px" readonly>${esc(text)}</textarea>`,
      foot: '<span class="spacer"></span><button class="btn ghost" data-action="closeModal">关闭</button>',
    });
  }
}

function openExportMenu() {
  const id = state.weekId;
  openModal({
    title: '导出本周名单',
    body: `<div class="hint">导出后会按 提前 / 周六 / 周日 分好工作表，可以直接打印或发给家长。</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
        <a class="btn" href="/api/export.xlsx?week=${esc(id)}" style="justify-content:center">Excel（.xlsx，多工作表）</a>
        <a class="btn" href="/api/export.csv?week=${esc(id)}" style="justify-content:center">CSV（.csv，可用 Excel 打开）</a>
      </div>`,
    foot: '<span class="spacer"></span><button class="btn ghost" data-action="closeModal">关闭</button>',
  });
}

function askName(required) {
  openModal({
    title: '你是谁？',
    closable: !required,
    body: `<div class="hint">填个称呼，方便同事看到是谁在录入和修改。只存在你自己的浏览器里。</div>
      <div class="field" style="margin-top:12px"><label>称呼</label><input type="text" id="askName" placeholder="例如 王老师 / 李老师"></div>`,
    foot: `<span class="spacer"></span>${required ? '' : '<button class="btn ghost" data-action="closeModal">取消</button>'}
      <button class="btn primary" data-action="saveMe">确定</button>`,
    onMount: () => setTimeout(() => $('#askName') && $('#askName').focus(), 60),
  });
}

function showLogin() {
  if ($('#loginRoot .login-card')) return;
  $('#loginRoot').innerHTML = `<div class="login-wrap"><div class="login-card">
    <h1>需要访问码</h1>
    <p>这个请假台设了口令，输入后即可进入。</p>
    <input type="text" id="loginCode" placeholder="访问码">
    <div class="login-err" id="loginErr"></div>
    <button class="btn primary" style="width:100%;justify-content:center;margin-top:8px" data-action="login">进入</button>
  </div></div>`;
  setTimeout(() => $('#loginCode') && $('#loginCode').focus(), 50);
}

/* ================================================================== */
/* 交互                                                               */
/* ================================================================== */

document.addEventListener('click', async (e) => {
  if (e.target.closest('input, textarea, select, label, a[href]')) return;
  const slipToggle = e.target.closest('[data-toggle-slip]');
  if (slipToggle) {
    slipToggle.classList.toggle('on');
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  try {
    switch (action) {
      case 'nav':
        state.view = btn.dataset.view;
        state.query = '';
        $('#sidebar').classList.remove('open');
        if (state.view === 'week') await loadWeek(state.weekId);
        renderShell();
        render();
        break;
      case 'toggleNav':
        $('#sidebar').classList.toggle('open');
        break;
      case 'editMe':
        askName(false);
        break;
      case 'closeModal':
        closeModal();
        break;
      case 'newRecord':
        openRecordModal(null);
        break;
      case 'openRecord':
        if (e.target.closest('input[type=checkbox]')) return;
        openRecordModal(id);
        break;
      case 'saveRecord':
        await saveRecord();
        break;
      case 'deleteRecord':
        await deleteRecord(state.editId);
        break;
      case 'parseTimeText':
        parseTimeIntoForm();
        break;
      case 'slip':
        await toggleSlip(btn.dataset.id, btn.dataset.field);
        break;
      case 'chk':
        await cycleCheck(btn.dataset.id);
        break;
      case 'bulkCheck':
        await bulkCheck(btn.dataset.value || '');
        break;
      case 'parseRoster':
        doParseRoster();
        break;
      case 'applyRoster':
        await applyRoster();
        break;
      case 'rosterSample':
        state.rosterText = ROSTER_SAMPLE;
        $('#rosterInput').value = ROSTER_SAMPLE;
        break;
      case 'rosterClear':
        state.rosterText = '';
        state.rosterPreview = [];
        state.rosterSkipped = [];
        $('#rosterInput').value = '';
        renderRosterPreview();
        break;
      case 'filter':
        state.filter = btn.dataset.filter;
        render();
        break;
      case 'sort':
        state.sortBy = btn.dataset.sort;
        render();
        break;
      case 'clearSel':
        state.selected.clear();
        renderWeekTable();
        break;
      case 'bulkSlip':
        await bulkSlip(btn.dataset.field, btn.dataset.value === '1');
        break;
      case 'bulkDelete':
        await bulkDelete();
        break;
      case 'prevWeek':
        await shiftWeek(-1);
        break;
      case 'nextWeek':
        await shiftWeek(1);
        break;
      case 'thisWeek':
        await gotoThisWeek();
        break;
      case 'gotoWeek':
        await loadWeek(id);
        state.view = 'week';
        renderShell();
        render();
        break;
      case 'exportMenu':
        openExportMenu();
        break;
      case 'copySummary':
        await copySummary();
        break;
      case 'stuMissing':
        state.onlyMissing = !state.onlyMissing;
        render();
        break;
      case 'doParse':
        doParse();
        break;
      case 'pasteClear':
        $('#pasteInput').value = '';
        state.pasteText = '';
        state.preview = [];
        state.skipped = [];
        renderPreview();
        break;
      case 'pasteSample':
        state.pasteText = SAMPLE;
        $('#pasteInput').value = SAMPLE;
        doParse();
        break;
      case 'pasteClip':
        try {
          const t = await navigator.clipboard.readText();
          state.pasteText = t;
          $('#pasteInput').value = t;
          doParse();
        } catch {
          toast('浏览器不让读剪贴板，手动粘贴吧', 'err');
        }
        break;
      case 'dropPreview': {
        const i = Number(btn.dataset.idx);
        state.preview.splice(i, 1);
        renderPreview();
        break;
      }
      case 'shareStart': {
        const t = toast('正在生成公网地址…第一次会先下载小工具');
        try {
          const d = await api('/api/share', { method: 'POST' });
          state.share = d;
          render();
          toast('已开启，把地址复制发给同事', 'ok');
        } catch (e) {
          await refreshShare();
          render();
          toast(e.message || '开启失败，检查网络后重试', 'err');
        } finally {
          if (t && t.remove) t.remove();
        }
        break;
      }
      case 'shareStop':
        await api('/api/share', { method: 'DELETE' });
        state.share = { running: false };
        render();
        toast('已关闭分享', 'ok');
        break;
      case 'shareRefresh':
        await refreshShare();
        render();
        toast('状态已刷新', 'ok');
        break;
      case 'copyShare': {
        const which = btn.dataset.which || 'url';
        const el = $(which === 'code' ? '#shareCode' : '#shareUrl');
        const val = el ? el.value : '';
        if (!val) return;
        const ok = await copyText(val);
        toast(ok ? '已复制' : '复制失败，手动选中复制', ok ? 'ok' : 'err');
        break;
      }
      case 'doImport':
        await doImport();
        break;
      case 'moveWeek':
        await switchWeek(btn.dataset.sat);
        break;
      case 'quickAdd': {
        const p = state.preview[Number(btn.dataset.idx)];
        if (!p || !p.name) return;
        const data = await send('/api/students', 'POST', {
          name: p.name,
          dorm: p.dorm || '',
          group: p.group || '',
          className: '',
        });
        state.revision = data.revision;
        state.students = data.students;
        renderPreview();
        toast(`已把 ${p.name} 补录进名册`, 'ok');
        break;
      }
      case 'addStudent':
        openStudentModal(null);
        break;
      case 'editStudent':
        openStudentModal(btn.dataset.name);
        break;
      case 'deleteStudent':
        await deleteStudent(btn.dataset.name);
        break;
      case 'saveStudent':
        await saveStudent();
        break;
      case 'exportRoster': {
        const rows = [['姓名', '班组', '宿舍', '班级', '电话'], ...state.students.map((s) => [s.name, s.group, s.dorm, s.className, s.phone])];
        const csv = '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        downloadText(csv, '超能班学生名册.csv', 'text/csv;charset=utf-8');
        break;
      }
      case 'saveSettings':
        await saveSettings();
        break;
      case 'saveMe': {
        const val = ($('#askName') || $('#setMe') || {}).value;
        const name = String(val || '').trim();
        if (!name) {
          toast('填个称呼吧', 'err');
          return;
        }
        state.me = name.slice(0, 12);
        localStorage.setItem('leave.me', state.me);
        closeModal();
        renderShell();
        pingPresence();
        break;
      }
      case 'createWeek':
        await createWeek();
        break;
      case 'delWeek':
        await deleteWeek(id);
        break;
      case 'copyText':
        try {
          await navigator.clipboard.writeText(btn.dataset.text);
          toast('已复制', 'ok');
        } catch {
          toast('复制失败，手动选中吧', 'err');
        }
        break;
      case 'login':
        await doLogin();
        break;
      default:
        break;
    }
  } catch (err) {
    toast(err.message || String(err), 'err');
  }
});

document.addEventListener('change', (e) => {
  const checkbox = e.target.closest('[data-check]');
  if (checkbox) {
    const rid = checkbox.dataset.check;
    if (checkbox.checked) state.selected.add(rid);
    else state.selected.delete(rid);
    renderBulk();
    return;
  }
  if (e.target.id === 'checkAll') {
    const list = filteredRecords();
    if (e.target.checked) list.forEach((r) => state.selected.add(r.id));
    else state.selected.clear();
    renderWeekTable();
    return;
  }
  const pcheck = e.target.closest('[data-pcheck]');
  if (pcheck) {
    const i = Number(pcheck.dataset.pcheck);
    state.preview[i].include = pcheck.checked;
    renderPreview();
    return;
  }
  const rcheck = e.target.closest('[data-roster-check]');
  if (rcheck) {
    const i = Number(rcheck.dataset.rosterCheck);
    if (state.rosterPreview[i]) state.rosterPreview[i].include = rcheck.checked;
    renderRosterPreview();
    return;
  }
  if (e.target.id === 'rosterCreate') {
    state.rosterCreate = e.target.checked;
    renderRosterPreview();
    return;
  }
  const pfield = e.target.closest('[data-pfield]');
  if (pfield) {
    const i = Number(pfield.dataset.idx);
    const field = pfield.dataset.pfield;
    const p = state.preview[i];
    if (field === 'name') {
      p.name = pfield.value;
      const st = state.students.find((s) => s.name === p.name);
      if (st) {
        if (!p.dorm) p.dorm = st.dorm || '';
        if (!p.group) p.group = st.group || '';
      }
    } else if (field === 'dorm') {
      p.dorm = normalizeDorm(pfield.value) || pfield.value.trim().toUpperCase();
    } else if (field === 'group') {
      p.group = normalizeGroup(pfield.value) || pfield.value.trim();
    } else if (field === 'time') {
      p.timeText = pfield.value;
      const res = parseTimeRange(p.timeText, refOfWeek());
      if (res.start) {
        p.startAt = res.start;
        p.endAt = res.end;
        p.category = categoryOf(res.start, weekCtx());
      } else {
        p.startAt = null;
        p.endAt = null;
        toast('这段文字没解析出时间，检查一下', 'err');
      }
    }
    renderPreview();
    return;
  }
  const slipBtn = e.target.closest('[data-toggle-slip]');
  if (slipBtn) slipBtn.classList.toggle('on');
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'pasteInput') {
    state.pasteText = e.target.value;
    return;
  }
  if (e.target.id === 'rosterInput') {
    state.rosterText = e.target.value;
    return;
  }
  if (e.target.id === 'weekSearch') {
    state.query = e.target.value;
    renderWeekTable();
    return;
  }
  if (e.target.id === 'studentSearch') {
    state.query = e.target.value;
    renderStudentTable();
    return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    const s = $('#weekSearch') || $('#studentSearch');
    if (s) s.focus();
  }
});

/* ================================================================== */
/* 动作实现                                                            */
/* ================================================================== */

async function saveRecord() {
  const week = state.week;
  const payload = {
    name: $('#fdName').value.trim(),
    dorm: ($('#fdDorm').value || '').trim().toUpperCase(),
    group: $('#fdGroup').value.trim(),
    startAt: $('#fdStart').value || null,
    endAt: $('#fdEnd').value || null,
    timeRaw: $('#fdTimeText').value.trim(),
    reason: $('#fdReason').value.trim(),
    note: $('#fdNote').value.trim(),
    phone: ($('#fdPhone') ? $('#fdPhone').value : '').trim(),
    contact: ($('#fdContact') ? $('#fdContact').value : '').trim(),
    category: categoryOf($('#fdStart').value || null, weekCtx()),
    slip: {
      written: $('[data-toggle-slip="written"]').classList.contains('on'),
      sent: $('[data-toggle-slip="sent"]').classList.contains('on'),
    },
  };
  if (!payload.name) {
    toast('姓名不能为空', 'err');
    return;
  }
  if (!payload.startAt) {
    toast('先填开始时间，或用上面的时间文案解析', 'err');
    return;
  }
  let data;
  if (state.editId) {
    data = await send(`/api/records/${encodeURIComponent(week.id)}/${encodeURIComponent(state.editId)}`, 'PATCH', payload);
  } else {
    data = await send('/api/records', 'POST', { week: week.id, records: [payload] });
  }
  state.revision = data.revision;
  state.week = data.week;
  closeModal();
  renderShell();
  render();
  toast('已保存', 'ok');
}

async function deleteRecord(rid) {
  if (!rid || !state.week) return;
  const rec = state.week.records.find((r) => r.id === rid);
  const ok = await confirmDialog(`删除 ${rec ? rec.name : ''} 这条请假记录？`);
  if (!ok) return;
  const snapshot = rec ? { week: state.week.id, record: { ...rec } } : null;
  const data = await send(`/api/records/${encodeURIComponent(state.week.id)}/${encodeURIComponent(rid)}`, 'DELETE');
  state.revision = data.revision;
  state.week = data.week;
  state.selected.delete(rid);
  closeModal();
  renderShell();
  render();
  toast('已删除', 'ok', snapshot ? { label: '撤销', fn: () => undoDelete(snapshot) } : undefined);
}

async function undoDelete(snapshot) {
  const r = snapshot.record;
  try {
    await send('/api/records', 'POST', {
      week: snapshot.week,
      records: [
        {
          name: r.name,
          dorm: r.dorm,
          group: r.group,
          startAt: r.startAt,
          endAt: r.endAt,
          timeRaw: r.timeRaw,
          reason: r.reason,
          note: r.note,
          phone: r.phone,
          contact: r.contact,
          check: r.check,
        },
      ],
    });
    if (state.weekId !== snapshot.week) await loadWeek(snapshot.week);
    else state.week = (await api(`/api/week/${encodeURIComponent(snapshot.week)}`)).week;
    renderShell();
    render();
    toast('已恢复', 'ok');
  } catch (err) {
    toast(err.message || '恢复失败', 'err');
  }
}

async function toggleSlip(rid, field) {
  const rec = state.week.records.find((r) => r.id === rid);
  if (!rec) return;
  const next = !(rec.slip && rec.slip[field]);
  const data = await send(`/api/records/${encodeURIComponent(state.week.id)}/${encodeURIComponent(rid)}`, 'PATCH', {
    slip: { ...(rec.slip || {}), [field]: next },
  });
  state.revision = data.revision;
  state.week = data.week;
  renderShell();
  render();
}

async function cycleCheck(rid) {
  const rec = state.week.records.find((r) => r.id === rid);
  if (!rec) return;
  const cur = CHECK_ORDER.indexOf(rec.check || '');
  const next = CHECK_ORDER[(cur + 1) % CHECK_ORDER.length];
  const data = await send(`/api/records/${encodeURIComponent(state.week.id)}/${encodeURIComponent(rid)}`, 'PATCH', { check: next });
  state.revision = data.revision;
  state.week = data.week;
  toast(`${rec.name} → ${CHECK_LABEL[next]}`, 'ok');
  renderShell();
  render();
}

async function bulkCheck(value) {
  const ids = [...state.selected];
  if (!ids.length) return;
  const data = await send('/api/records/bulk', 'POST', { week: state.weekId, ids, field: 'check', value });
  state.revision = data.revision;
  state.week = data.week;
  toast(`${ids.length} 条 → ${CHECK_LABEL[value || '']}`, 'ok');
  renderShell();
  render();
}

async function bulkSlip(field, value) {
  const ids = [...state.selected];
  if (!ids.length) return;
  const data = await send('/api/records/bulk', 'POST', { week: state.weekId, ids, field, value });
  state.revision = data.revision;
  state.week = data.week;
  toast(`已更新 ${ids.length} 条`, 'ok');
  renderShell();
  render();
}

async function bulkDelete() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await confirmDialog(`删除选中的 ${ids.length} 条记录？`);
  if (!ok) return;
  const data = await send('/api/records/bulk', 'POST', { week: state.weekId, ids, field: 'delete' });
  state.revision = data.revision;
  state.selected.clear();
  state.week = data.week;
  renderShell();
  render();
  toast('已删除', 'ok');
}

function shiftWeek(delta) {
  const cur = state.week ? state.week.saturday : new Date().toISOString().slice(0, 10);
  const d = new Date(`${cur}T12:00:00`);
  d.setDate(d.getDate() + delta * 7);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return gotoWeek(iso);
}

async function gotoWeek(iso) {
  const data = await send('/api/weeks', 'POST', { saturday: iso });
  if (data.revision != null) state.revision = data.revision;
  if (data.week) {
    if (!state.weeks.some((w) => w.id === data.week.id)) state.weeks.unshift(data.week);
    await loadWeek(data.week.id);
  }
  state.view = 'week';
  renderShell();
  render();
}

async function gotoThisWeek() {
  await gotoWeek(thisSaturdayIso());
}

/** 把当前识别结果换到它所属的那一周（必要时新建周次） */
async function switchWeek(sat) {
  if (!sat) return;
  if (!state.weeks.some((w) => w.saturday === sat)) {
    await send('/api/weeks', 'POST', { saturday: sat });
    const b = await api('/api/bootstrap');
    state.weeks = b.weeks;
    if (b.server) state.server = b.server;
  }
  await loadWeek(sat);
  for (const p of state.preview) {
    if (p.startAt) p.category = categoryOf(p.startAt, weekCtx());
  }
  renderShell();
  render();
  toast(`已切到 ${md(sat)} 那一周`, 'ok');
}

async function doImport() {
  const ctx = weekCtx();
  const recs = state.preview
    .filter((p) => p.include && p.name && p.startAt)
    .map((p) => ({
      name: p.name,
      rawName: p.rawName || p.name,
      dorm: p.dorm,
      group: p.group,
      startAt: p.startAt,
      endAt: p.endAt,
      timeRaw: p.timeText,
      reason: p.reason,
      phone: p.phone || '',
      contact: p.contact || '',
      // 分类永远按「开始时间」重算，避免沿用预览时的旧周次
      category: categoryOf(p.startAt, ctx),
    }));
  if (!recs.length) {
    toast('没有可导入的行', 'err');
    return;
  }
  const data = await send('/api/records', 'POST', { week: state.weekId, records: recs });
  state.revision = data.revision;
  state.week = data.week;
  state.preview = [];
  state.skipped = [];
  state.view = 'week';
  renderShell();
  render();
  toast(`导入 ${data.added} 条${data.duplicates.length ? `，跳过重复 ${data.duplicates.length} 条` : ''}`, 'ok');
}

function openStudentModal(name) {
  const s = name ? state.students.find((x) => x.name === name) : null;
  openModal({
    title: s ? `编辑 ${s.name}` : '补录学生',
    body: `<div class="field"><label>姓名</label><input type="text" id="stName" value="${esc(s ? s.name : '')}"></div>
      <div class="field-row">
        <div class="field"><label>班组</label><input type="text" id="stGroup" value="${esc(s ? s.group : '')}" placeholder="如 超能二3组"></div>
        <div class="field"><label>宿舍号</label><input type="text" id="stDorm" value="${esc(s ? s.dorm : '')}" placeholder="如 B513 / 走读"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>班级</label><input type="text" id="stClass" value="${esc(s ? s.className : '')}" placeholder="如 超能2班"></div>
        <div class="field"><label>家长电话</label><input type="text" id="stPhone" value="${esc(s ? s.phone : '')}"></div>
      </div>`,
    foot: `${s ? `<button class="btn danger" data-action="deleteStudent" data-name="${esc(s.name)}">删除</button>` : ''}
      <span class="spacer"></span><button class="btn ghost" data-action="closeModal">取消</button>
      <button class="btn primary" data-action="saveStudent">保存</button>`,
    onMount: () => setTimeout(() => $('#stName') && $('#stName').focus(), 50),
  });
  state.editName = name || null;
}

async function saveStudent() {
  const payload = {
    name: $('#stName').value.trim(),
    group: $('#stGroup').value.trim(),
    dorm: $('#stDorm').value.trim().toUpperCase(),
    className: $('#stClass').value.trim(),
    phone: $('#stPhone').value.trim(),
  };
  if (!payload.name) {
    toast('姓名不能为空', 'err');
    return;
  }
  const data = await send('/api/students', 'POST', payload);
  state.revision = data.revision;
  state.students = data.students;
  closeModal();
  render();
  toast('已保存', 'ok');
}

async function deleteStudent(name) {
  const ok = await confirmDialog(`从名册删除 ${name}？已录入的请假记录不会删。`);
  if (!ok) return;
  const data = await send(`/api/students/${encodeURIComponent(name)}`, 'DELETE');
  state.revision = data.revision;
  state.students = data.students;
  closeModal();
  render();
  toast('已删除', 'ok');
}

async function saveSettings() {
  const payload = { org: $('#setOrg').value.trim(), cutoff: $('#setCutoff').value };
  const data = await send('/api/settings', 'PUT', payload);
  state.revision = data.revision;
  state.settings = data.settings;
  renderShell();
  toast('设置已保存', 'ok');
}

async function createWeek() {
  const val = $('#newWeekDate').value;
  if (!val) {
    toast('先选一个日期', 'err');
    return;
  }
  const d = new Date(`${val}T12:00:00`);
  const delta = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await gotoWeek(iso);
  toast(`已切到 ${md(iso)} ${wd(iso)}`, 'ok');
}

async function deleteWeek(id) {
  const ok = await confirmDialog(`删除 ${md(id)} 这一周的全部请假记录？`);
  if (!ok) return;
  const data = await send(`/api/weeks/${encodeURIComponent(id)}`, 'DELETE');
  state.revision = data.revision;
  state.weeks = data.weeks;
  if (state.weekId === id) {
    state.weekId = pickWeek(state.weeks);
    await loadWeek(state.weekId);
  }
  renderShell();
  render();
  toast('已删除', 'ok');
}

async function doLogin() {
  const code = ($('#loginCode') || {}).value || '';
  try {
    await send('/api/login', 'POST', { code });
    $('#loginRoot').innerHTML = '';
    await boot();
  } catch (err) {
    const e = $('#loginErr');
    if (e) e.textContent = code ? '访问码不对，再试一次' : '请先输入访问码';
  }
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    openModal({
      title: '确认一下',
      body: `<div class="hint" style="font-size:13.5px;color:var(--ink-2)">${esc(message)}</div>`,
      foot: `<span class="spacer"></span><button class="btn ghost" data-action="closeModal">取消</button>
        <button class="btn danger" id="confirmYes">确定</button>`,
      onMount: () => {
        $('#confirmYes').addEventListener('click', () => {
          closeModal();
          resolve(true);
        });
        $('#backdrop').addEventListener('click', (e) => {
          if (e.target.id === 'backdrop') resolve(false);
        });
      },
    });
  });
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const SAMPLE = `1. 郑博洋 B513 超能二3组 8月15日21:30至8月16日20:00 回家
2. 王蕾淇 A231 超能一1组 周六晚上21点半到周日晚上8点 家里有事
3. 张萌悦 A612 超能三1组 8月15日下课后至8月17日8点
4. 赖蓝琦 A616 超能一1组 8月16日早上7点走 走读`;

/* 名册表格首屏 */
boot();
