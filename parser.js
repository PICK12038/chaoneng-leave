/**
 * 请假文案解析引擎 —— 前端与 Node 服务端共用。
 *
 * 输入示例：
 *   1. 郑博洋 B513 超能二3组 8月15日21时30分至8月16日20时 回家
 *   8月15日 21:30-8月16日 20:00 王蕾淇 A231 喜事
 *   21点30分 至 7月12日22时00分 刘宝康 走读
 *   8月2日中午11.30到晚上8点半 张岚 A616
 */

const PER = '(上午|下午|晚上|晚|早上|早|中午|傍晚|凌晨|夜里|夜)';
const HN = '(?:\\d(?:\\s?\\d)?|[一二三四五六七八九十]{1,3})';
const TAIL =
  '(?:(?<h>' + HN + ')\\s*(?:(?<sep>[:：])\\s*(?<mi>' + HN + '|[半])|[时点]\\s*(?:(?<mi2>' + HN + '|[半])\\s*(?:分|钟)?)?|(?<dot>[.．])\\s*(?<mi3>\\d{2})))';

const RE_FULL = new RegExp(
  '(?:(?<y>\\d(?:\\s?\\d){3})\\s*年\\s*)?(?<mo>\\d(?:\\s?\\d)?)\\s*月\\s*(?<d>\\d(?:\\s?\\d)?)\\s*[日号]?\\s*' +
    '(?:(?<per>' + PER.slice(1, -1) + ')\\s*)?' +
    '(?:' + TAIL + ')?',
  'y'
);
const RE_DOT = new RegExp(
  '(?<mo>\\d(?:\\s?\\d)?)\\s*[.．]\\s*(?<d>\\d(?:\\s?\\d)?)\\s*[日号]?\\s*' +
    '(?:(?<per>' + PER.slice(1, -1) + ')\\s*)?' +
    '(?:' + TAIL + ')?',
  'y'
);
const RE_DAY = new RegExp(
  '(?<d>\\d(?:\\s?\\d)?)\\s*[日号]\\s*' +
    '(?:(?<per>' + PER.slice(1, -1) + ')\\s*)?' +
    '(?:' + TAIL + ')?',
  'y'
);
const RE_TIME = new RegExp('(?:(?<per>' + PER.slice(1, -1) + ')\\s*)?(?:' + TAIL + ')', 'y');
const RE_TIME_DOT = /(?<h>\d(?:\s?\d)?)\s*[.．]\s*(?<mi>\d{2})(?!\d)/y;

export const PERIOD_WORDS = ['上午', '下午', '晚上', '晚', '早上', '早', '中午', '傍晚', '凌晨', '夜里', '夜'];

const STOP = new Set(
  (
    '请假 周末 周六 周日 周天 星期 宿舍 班级 组别 班组 家长 信息 原因 备注 已写 已发 假条 接龙 序号 ' +
    '超能 丰泰 老师 同学 谢谢 收到 麻烦 你好 您好 走读 回家 提前 下课后 晚自习 放学 请假条 已写假条 ' +
    '各位 家长群 本周 周末请假 以上 以下 请 知悉 出勤 考勤 左右 分钟 小时'
  ).split(/\s+/)
);

/* 原因清洗用的词表：只丢掉纯格式词，不丢「回家 / 看病」这类真实原因 */
const REASON_STOP = new Set(
  '请假 周末 周六 周日 周天 星期 宿舍 姓名 序号 备注 已写 已发 假条 接龙 老师 家长 谢谢 收到 麻烦 ' +
    '你好 您好 走读 请假条 以上 以下 各位 知悉 出勤 考勤 信息 原因 提前 下课后 晚自习 放学 本周 周末请假 学生 ' +
    '我是 我 妈妈 爸爸 母亲 父亲 监护人 家长您好 的 因 因为'
    .split(/\s+/)
);
const REASON_LEFTOVER = /^(?:[到至]?\s*(?:周|星期)[一二三四五六日天]?|[到至上下前后]{1,2}|[半]|\d+[点时分])$/;

/* 家长请假模板里的固定话术：出现的整句都不是原因 */
const REASON_NOISE = [
  /教务老师|班主任|老师您?好|您好|打扰了/g,
  /我是[^，。；\n]{0,10}?学生(?:的)?家长/g,
  /(?:需要|申请|想)?请假(?:外出|离校|回家)?|离校期间[^。；\n]*|一切安全[^。；\n]*|安全问题[^。；\n]*|自行负责|责任自负/g,
  /请假时间|请假学生|学生家长|家长姓名|家长联系电话|联系电话|学生姓名|学生电话|班级|宿舍号|身份证号/g,
];

/* 「因为出去玩原因需要请假」→ 直接把中间的词当原因 */
const REASON_HINT = /(?:因为|由于|因)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,12}?)(?:的)?(?:原因)?(?=[，。；,;\n]|需要|需|申请|要|请假|离校|回家|$)/;

/* ------------------------------------------------------------------ */
/* 文本归一化                                                          */
/* ------------------------------------------------------------------ */

export function normalizeLine(input) {
  let s = String(input == null ? '' : input);
  s = s.normalize('NFKC');
  s = s.replace(/[\u00a0\u3000]/g, ' ').replace(/\t/g, ' ');
  s = s.replace(/[—–－]+/g, '-');
  s = s.replace(/[~～]/g, '~');
  s = s.replace(/\s*至\s*/g, '至');
  // 中文数字日期：十月二十五日 → 10月25日、二十五号 → 25日
  s = s.replace(/([一二三四五六七八九十]{1,3})\s*月\s*([一二三四五六七八九十]{1,3})\s*[日号]/g, (m, a, b) => {
    const mo = cnToInt(a);
    const d = cnToInt(b);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${mo}月${d}日` : m;
  });
  s = s.replace(/([一二三四五六七八九十]{1,3})\s*[号日]/g, (m, a) => {
    const d = cnToInt(a);
    return d >= 1 && d <= 31 && !/[〇零]/.test(a) ? `${d}日` : m;
  });
  // 10/24、10／24 这类斜杠日期统一成点号，交给 RE_DOT 处理
  s = s.replace(/(\d{1,2})\s*[\/／]\s*(\d{1,2})(?!\d)/g, '$1.$2');
  s = s.replace(/ {2,}/g, ' ');
  return s.trim();
}

const p2 = (n) => String(n).padStart(2, '0');

function cnToInt(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s/g, '');
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t === '半') return 30;
  const map = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (t === '十') return 10;
  if (t.includes('十')) {
    const [a, b] = t.split('十');
    return (a ? map[a] || 0 : 1) * 10 + (b ? map[b] || 0 : 0);
  }
  return map[t] ?? null;
}

/* ------------------------------------------------------------------ */
/* 时间识别                                                            */
/* ------------------------------------------------------------------ */

function atomFromMatch(kind, m, index) {
  const g = m.groups || {};
  const per = g.per || null;
  const h = g.h == null ? null : cnToInt(g.h);
  let mi = g.mi ?? g.mi2 ?? g.mi3 ?? null;
  mi = mi == null ? null : cnToInt(mi);
  return {
    kind,
    y: g.y == null ? null : cnToInt(g.y),
    mo: g.mo == null ? null : cnToInt(g.mo),
    d: g.d == null ? null : cnToInt(g.d),
    per,
    h,
    mi,
    hasTime: h != null,
    hasDate: g.mo != null || g.d != null,
    start: index,
    end: index + m[0].length,
    raw: m[0],
  };
}

const PATTERNS = [
  ['full', RE_FULL],
  ['dot', RE_DOT],
  ['day', RE_DAY],
  ['time', RE_TIME],
  ['timedot', RE_TIME_DOT],
];

export function scanAtoms(line) {
  const atoms = [];
  let i = 0;
  while (i < line.length) {
    let hit = null;
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (!m || !m[0]) continue;
      const a = atomFromMatch(kind, m, i);
      if (a.mo != null && (a.mo < 1 || a.mo > 12)) continue;
      if (a.d != null && (a.d < 1 || a.d > 31)) continue;
      if (a.h != null && (a.h > 24 || a.h < 0)) continue;
      if (a.mi != null && (a.mi > 59 || a.mi < 0)) continue;
      if (kind === 'timedot' && !(a.h > 12)) continue;
      if (!a.hasDate && !a.hasTime) continue;
      hit = a;
      break;
    }
    if (hit) {
      atoms.push(hit);
      i = Math.max(hit.end, i + 1);
    } else {
      i += 1;
    }
  }
  return atoms;
}

function parseWeekDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

const DAY = 86400000;
const utc = (y, m, d) => Date.UTC(y, m - 1, d, 12);

function inferYear(m, d, ref) {
  let y = ref.y;
  const diff = utc(y, m, d) - utc(ref.y, ref.m, ref.d);
  if (diff > 180 * DAY) y -= 1;
  if (diff < -180 * DAY) y += 1;
  return y;
}

function normalizeYM(y, m) {
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { y, m };
}

function resolveDate(atom, ref) {
  let y, m, d;
  if (atom.mo != null) {
    m = atom.mo;
    d = atom.d;
    y = atom.y != null ? atom.y : inferYear(m, d, ref);
  } else if (atom.d != null) {
    d = atom.d;
    m = ref.m;
    y = ref.y;
    const delta = d - ref.d;
    if (delta < -15) ({ y, m } = normalizeYM(y, m + 1));
    else if (delta > 15) ({ y, m } = normalizeYM(y, m - 1));
  } else {
    y = ref.y;
    m = ref.m;
    d = ref.d;
  }
  ({ y, m } = normalizeYM(y, m));
  return { y, m, d };
}

function applyPeriod(h, per) {
  if (h == null) return null;
  let hh = h;
  if (per && ['下午', '晚上', '晚', '傍晚', '夜里', '夜', '中午'].includes(per) && hh < 12) hh += 12;
  if (hh === 24) hh = 0;
  return hh;
}

const toMinutes = (o) => (o.hh == null ? null : o.hh * 60 + (o.mi || 0));

function addDays(o, n) {
  const t = new Date(utc(o.y, o.m, o.d) + n * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const isoOf = (o) => `${o.y}-${p2(o.m)}-${p2(o.d)}T${p2(o.hh == null ? 0 : o.hh)}:${p2(o.mi == null ? 0 : o.mi)}`;

export function fmtPoint(o) {
  if (!o) return '';
  return `${o.m}月${o.d}日${p2(o.hh == null ? 0 : o.hh)}时${p2(o.mi == null ? 0 : o.mi)}分`;
}

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mi: +m[5] };
}

export function addDaysStr(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function mdOf(isoDate) {
  const m = String(isoDate || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${+m[1]}月${+m[2]}日` : String(isoDate || '');
}

/** 两个 YYYY-MM-DD[THH:MM] 之间相差的天数（后减前），解析不了返回 null */
export function dayGap(fromIso, toIso) {
  const a = String(fromIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const b = String(toIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!a || !b) return null;
  const ta = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const tb = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round((tb - ta) / 86400000);
}

function gapKind(gap) {
  if (gap == null) return 'none';
  if (/[至到\-~]/.test(gap)) return 'sep';
  const stripped = gap.replace(/[\s,，、;；:：日号分点左右前后钟]/g, '');
  if (!stripped) return 'ws';
  if (PERIOD_WORDS.some((p) => stripped === p)) return 'period';
  return 'other';
}

/**
 * 解析一段文本里的请假起止时间。
 * @param {string} line 已归一化的文本
 * @param {{y:number,m:number,d:number}} ref 参考日期（周六）
 */
export function parseTimeRange(line, ref) {
  const atoms = scanAtoms(line);
  const warnings = [];
  if (!atoms.length) return { start: null, end: null, raw: '', warnings: ['未识别到时间'] };

  const used = new Set();
  const list = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const b = atoms[i + 1];
    const gap = b ? line.slice(a.end, b.start) : null;
    const g = gapKind(gap);
    const bHasTimeOnly = b && (b.kind === 'time' || b.kind === 'timedot') && !b.hasDate;
    if (b && (g === 'ws' || g === 'period') && a.hasDate && !a.hasTime && bHasTimeOnly) {
      list.push({
        ...a,
        h: b.h,
        mi: b.mi,
        per: b.per || PERIOD_WORDS.find((p) => gap.includes(p)) || a.per,
        hasTime: true,
        end: b.end,
        raw: a.raw + gap + b.raw,
      });
      i += 1;
    } else {
      list.push(a);
    }
  }

  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const a = list[i];
    const b = list[i + 1];
    const gap = b ? line.slice(a.end, b.start) : null;
    const g = gapKind(gap);
    if (b && !used.has(i + 1) && g === 'sep') {
      pairs.push([a, b]);
      used.add(i + 1);
    } else {
      pairs.push([a]);
    }
  }

  const [first, second] = pairs[0];
  const startDate = resolveDate(first, ref);
  const start = { ...startDate, hh: applyPeriod(first.h, first.per), mi: first.mi == null ? 0 : first.mi };

  let end = null;
  if (second) {
    const endDate = resolveDate(second, startDate);
    end = { ...endDate, hh: applyPeriod(second.h, second.per), mi: second.mi == null ? 0 : second.mi };
    if (end.hh == null) {
      end = null;
      warnings.push('结束时间不完整');
    } else if (!second.hasDate) {
      const tstart = toMinutes(start);
      if (tstart != null && toMinutes(end) <= tstart) Object.assign(end, addDays(endDate, 1));
    }
  }

  if (start.hh == null) {
    warnings.push('开始时间不完整');
  } else if (end) {
    const a = utc(start.y, start.m, start.d) + start.hh * 3600000 + start.mi * 60000;
    const b = utc(end.y, end.m, end.d) + end.hh * 3600000 + end.mi * 60000;
    if (b <= a) {
      Object.assign(end, addDays(end, 1));
      if (utc(end.y, end.m, end.d) + end.hh * 3600000 + end.mi * 60000 <= a) {
        warnings.push('结束时间早于开始时间');
        end = null;
      }
    }
  }

  if (pairs.length > 1) warnings.push('识别到多段区间，已取第一段');

  return {
    start: start.hh == null ? null : isoOf(start),
    end: end ? isoOf(end) : null,
    raw: atoms.map((x) => x.raw).join(' '),
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------------ */
/* 姓名 / 宿舍 / 组别                                                  */
/* ------------------------------------------------------------------ */

export function buildContext(students, week) {
  const list = (students || [])
    .filter((s) => s && s.name)
    .map((s) => ({ ...s, name: String(s.name).trim() }));
  const sorted = [...list].sort((a, b) => b.name.length - a.name.length);
  const byName = new Map(list.map((s) => [s.name, s]));
  return { students: list, sorted, byName, week: week || {} };
}

function maskSpans(text, spans) {
  const arr = text.split('');
  for (const [s, e] of spans) {
    for (let i = Math.max(0, s); i < Math.min(arr.length, e); i++) arr[i] = '\u0001';
  }
  return arr.join('');
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const LABEL_STUDENT = /(?:请假学生|学生姓名|学生)\s*[:：]\s*([\u4e00-\u9fa5·]{2,4})/;
const LABEL_PARENT = /(?:学生家长|家长姓名|家长)\s*[:：]?\s*([\u4e00-\u9fa5]{2,4})/;
const LABEL_PHONE = /(?:家长联系电话|联系电话|家长电话|电话)\s*[:：]?\s*(\d{6,12})/;
// 「我是某某学生的家长」「我是某某」——自我介绍里的名字不算请假学生
const SELF_INTRO = /我(?:是|叫)[^，。；,、\n]{0,12}?(?:学生)?(?:的)?(?:家长|妈妈|爸爸|母亲|父亲|监护人)|我(?:是|叫)[^，。；,、\n]{0,6}?老师/g;

export function extractHints(text) {
  const src = String(text || '').replace(/\r/g, '');
  const sm = src.match(LABEL_STUDENT);
  const student = sm ? sm[1] : '';
  const pm = src.match(LABEL_PARENT);
  let parent = pm ? pm[1] : '';
  if (parent && parent === student) parent = '';
  const ph = src.match(LABEL_PHONE);
  const phone = ph ? ph[1] : '';
  let masked = src.replace(SELF_INTRO, ' ');
  if (parent) masked = masked.split(parent).join(' ');
  if (phone) masked = masked.split(phone).join(' ');
  masked = masked.replace(/(?:学生家长|家长姓名|家长)\s*[:：]?/g, ' ');
  masked = masked.replace(/(?:请假学生|学生姓名)\s*[:：]?/g, ' ');
  return { student, parent, phone, masked };
}

function resolveHintName(hint, ctx) {
  const exact = ctx.byName.get(hint) || ctx.sorted.find((s) => s.name === hint);
  if (exact) return { name: exact.name, confidence: 'exact', student: exact };
  const name = String(hint || '').replace(/\s/g, '');
  const spaced = ctx.sorted.find((s) => s.name === name);
  if (spaced) return { name: spaced.name, confidence: 'exact', student: spaced };
  const cand = findName(hint, ctx);
  if (cand.student && cand.confidence === 'fuzzy') return cand;
  return { name: hint, rawName: hint, confidence: 'unknown', student: null };
}

function findName(masked, ctx) {
  for (const st of ctx.sorted) {
    if (masked.includes(st.name)) return { name: st.name, confidence: 'exact', student: st };
  }
  const compact = masked.replace(/\s+/g, '');
  for (const st of ctx.sorted) {
    if (compact.includes(st.name)) return { name: st.name, confidence: 'exact', student: st, spaced: true };
  }
  const tokens = masked.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  let best = null;
  for (const t of tokens) {
    if (STOP.has(t)) continue;
    for (const st of ctx.sorted) {
      if (Math.abs(st.name.length - t.length) > 1) continue;
      const d = levenshtein(st.name, t);
      if (d <= 1 && (!best || d < best.d)) best = { name: st.name, raw: t, d, student: st };
    }
  }
  if (best) return { name: best.name, rawName: best.raw, confidence: 'fuzzy', student: best.student };
  for (const t of tokens) {
    if (STOP.has(t)) continue;
    if (t.length < 2) continue;
    return { name: t, rawName: t, confidence: 'unknown', student: null };
  }
  return { name: '', confidence: 'none', student: null };
}

const GROUP_RE = /(超能|丰泰)[\s-]*(?:班)?[\s-]*([一二三123])?[\s-]*(?:班)?[\s-]*([一二三四1-4])[\s-]*组/;
const CN2N = { 一: '1', 二: '2', 三: '3', 四: '4' };
const N2CN = { 1: '一', 2: '二', 3: '三', 4: '四' };

export function normalizeGroup(text) {
  if (!text) return '';
  const m = GROUP_RE.exec(String(text).replace(/\s/g, ''));
  if (!m) return '';
  const prefix = m[1];
  const cls = m[2] ? CN2N[m[2]] || m[2] : '';
  const no = m[3] ? CN2N[m[3]] || m[3] : '';
  if (prefix === '丰泰') return `丰泰班${no}组`;
  return `超能${cls ? N2CN[cls] || cls : ''}${no}组`;
}

const DORM_RE = /(?:^|[^A-Za-z0-9])([ABab])[\s-]?(\d{3})(?!\d)/;

export function normalizeDorm(text) {
  if (!text) return '';
  if (/走读/.test(text)) return '走读';
  const m = DORM_RE.exec(String(text));
  return m ? (m[1] + m[2]).toUpperCase() : '';
}

/* ------------------------------------------------------------------ */
/* 分类                                                                */
/* ------------------------------------------------------------------ */

export function categoryOf(startIso, week) {
  if (!startIso) return 'other';
  const sat = (week && week.saturday) || '2026-08-15';
  const cutoff = (week && week.cutoff) || '21:30';
  if (startIso < `${sat}T${cutoff}`) return 'early';
  const sun = addDaysStr(sat, 1);
  if (startIso < `${sun}T00:00`) return 'sat';
  if (startIso <= `${sun}T23:59`) return 'sun';
  return 'other';
}

export const CATEGORY_LABEL = { early: '提前请假', sat: '周六', sun: '周日', other: '其他' };
export const CATEGORY_ORDER = ['early', 'sat', 'sun', 'other'];

export function timeTextOf(r) {
  if (!r.startAt) return r.timeRaw || '';
  const a = parseISO(r.startAt);
  const b = r.endAt ? parseISO(r.endAt) : null;
  return fmtPoint(a) + (b ? '至' + fmtPoint(b) : '');
}

/* ------------------------------------------------------------------ */
/* 单行解析                                                            */
/* ------------------------------------------------------------------ */

export function parseOne(rawLine, ctx) {
  const line = normalizeLine(rawLine);
  const warnings = [];
  if (!line) return null;

  const ref = parseWeekDate(ctx.week && ctx.week.saturday) || { y: 2026, m: 8, d: 15 };
  const atoms = scanAtoms(line);
  const time = parseTimeRange(line, ref);
  warnings.push(...time.warnings);

  const compact = line.replace(/\s/g, '');
  const dormMatch = DORM_RE.exec(line);
  const walk = /走读/.test(line);
  let dorm = walk ? '走读' : dormMatch ? (dormMatch[1] + dormMatch[2]).toUpperCase() : '';

  const gMatch = GROUP_RE.exec(compact);
  const groupRaw = gMatch ? normalizeGroup(gMatch[0]) : '';

  // 组别在 compact 文本里的位置 → 换算回原文本的近似区间
  const gSpan = gMatch ? findCompactSpan(line, gMatch.index, gMatch[0].length) : null;

  const spans = [
    ...atoms.map((a) => [a.start, a.end]),
    ...(dormMatch ? [[dormMatch.index, dormMatch.index + dormMatch[0].length]] : []),
    ...(gSpan ? [gSpan] : []),
  ];
  const masked = maskSpans(line, spans);
  const nm = findName(masked, ctx);
  const student = nm.student || ctx.byName.get(nm.name) || null;

  let group = groupRaw;
  if (!group && student && student.group) group = student.group;
  if (!dorm && student && student.dorm) dorm = student.dorm;
  if (student && groupRaw && groupRaw !== student.group) {
    warnings.push(`文案组别 ${groupRaw} 与名册 ${student.group} 不一致`);
  }
  if (!nm.name) warnings.push('未识别到姓名');
  if (nm.confidence === 'unknown') warnings.push('名册中找不到该姓名');
  if (nm.confidence === 'fuzzy') warnings.push(`姓名疑似「${nm.rawName}」`);
  if (!time.start) warnings.push('未识别到开始时间');

  const phoneHit = line.match(/(?<!\d)(1[3-9]\d{9})(?!\d)/);
  const contactHit = line.match(/(?:学生家长|家长姓名|家长)[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
  const contact = contactHit ? contactHit[1] : '';
  const phone = phoneHit ? phoneHit[1] : '';

  const hint = line.match(REASON_HINT);
  let rest = masked;
  rest = rest.replace(/我(?:是|叫)[^，。；,、\n]{0,12}/g, ' ');
  for (const re of REASON_NOISE) rest = rest.replace(re, ' ');
  if (nm.name) rest = rest.split(nm.name).join('\u0001');
  if (contact) rest = rest.split(contact).join('\u0001');
  let reason = '';
  if (hint) {
    reason = hint[1];
  } else {
    const tok = rest.match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || [];
    for (const raw of tok) {
      const t = raw.trim();
      if (!t) continue;
      if (REASON_STOP.has(t) || REASON_LEFTOVER.test(t) || t.includes('假条')) continue;
      if (/^(请假|已写|已发|未写|走读|宿舍|姓名|序号|备注)$/.test(t)) continue;
      reason = reason ? `${reason} ${t}` : t;
    }
  }
  reason = reason
    .replace(/^(?:因为|因|由于|所以|需要|申请)+/g, '')
    .replace(/\s*(?:时间|时至|点钟|至|点|分|半|左右)\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (reason.length > 40) reason = reason.slice(0, 40);

  if (time.start && ctx.week && ctx.week.saturday) {
    const gap = dayGap(ctx.week.saturday, time.start);
    if (gap !== null && (gap < -3 || gap > 3)) {
      warnings.push(`时间不在本周（${mdOf(ctx.week.saturday)}）附近，确认是否选错周`);
    }
  }

  return {
    name: nm.name,
    rawName: nm.rawName || nm.name,
    group,
    dorm,
    phone,
    contact,
    startAt: time.start,
    endAt: time.end,
    timeRaw: time.raw,
    reason,
    category: time.start ? categoryOf(time.start, ctx.week) : 'other',
    confidence: { name: nm.confidence, time: time.start ? (time.end ? 'ok' : 'partial') : 'none' },
    warnings,
    raw: rawLine.trim(),
  };
}

function findCompactSpan(line, compactIdx, len) {
  let n = 0;
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    if (/\s/.test(line[i])) continue;
    if (n === compactIdx) start = i;
    if (n === compactIdx + len - 1) return [start, i + 1];
    n++;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 整段文案                                                            */
/* ------------------------------------------------------------------ */

const HEADER_WORDS = /^(序号|宿舍|姓名|班组|班级|组别|请假时间|家长信息|已写假条|已发假条|原因|备注)$/;

function splitNumbered(line) {
  const re = /(?:^|\s)(\d{1,3})\s*[.、．)）]\s*(?=[\u4e00-\u9fa5])/g;
  const marks = [];
  let m;
  while ((m = re.exec(line))) marks.push({ idx: m.index, len: m[0].length });
  if (marks.length < 2) return [line];
  const parts = [];
  let start = 0;
  for (let i = 1; i < marks.length; i++) {
    parts.push(line.slice(start, marks[i].idx));
    start = marks[i].idx;
  }
  parts.push(line.slice(start));
  return parts.map((p) => p.replace(/^\s*\d{1,3}\s*[.、．)）]\s*/, '').trim()).filter(Boolean);
}

/* 每条文案一般以「教务老师 / 您好」开场，也可能是空行分段的几条消息 */
const GREETING_RE = /^(?:教务老师|班主任|老师您好|老师好|尊敬的老师|各位老师|老师们|您好)/;

function splitBlocks(text) {
  const src = String(text || '').replace(/\r/g, '');
  const raw = [];
  let cur = [];
  const flush = () => {
    const t = cur.join('\n').trim();
    if (t) raw.push(t);
    cur = [];
  };
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (GREETING_RE.test(t) && cur.join('').trim()) flush();
    cur.push(line);
  }
  flush();

  // 一个块里挤了多条「请假学生：」→ 以标签为界再切，保留标签前约 120 字（时间通常写在那儿）
  const out = [];
  for (const b of raw) {
    const re = new RegExp(LABEL_STUDENT.source, 'g');
    const idxs = [];
    let m;
    while ((m = re.exec(b))) idxs.push(m.index);
    if (idxs.length <= 1) {
      out.push(b);
      continue;
    }
    let start = 0;
    for (let k = 1; k < idxs.length; k++) {
      const cut = Math.max(start + 1, idxs[k] - 120);
      out.push(b.slice(start, cut).trim());
      start = cut;
    }
    out.push(b.slice(start).trim());
  }
  return out.filter(Boolean);
}

/* 一个块 = 一条家长文案 */
/* 家长常写「周六晚上九点半走，周日晚上八点前回来」——
   在没有明确月/日时，把「周X / 星期X」换成所选周里的具体日期，交给原时间解析处理。 */
function withWeekdayDates(text, week) {
  const sat = week && parseWeekDate(week.saturday);
  if (!sat) return text;
  if (/(?:\d{1,2}\s*月)|(?:\d{1,2}\s*[日号])/.test(text)) return text; // 已写具体日期，不猜
  const dayOf = (offset) => {
    const t = new Date(Date.UTC(sat.y, sat.m - 1, sat.d) + offset * DAY);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日`;
  };
  const map = { 六: 0, 日: 1, 天: 1 };
  return String(text).replace(/(下周|下个星期|本周|这周|这个星期|星期|周)([六日天一二三四五])/g, (all, pre, ch) => {
    let off = map[ch];
    if (off == null) {
      // 周一~周五：按本周位置算，超出周六就往后顺延
      const idx = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }[ch];
      off = idx == null ? 0 : idx - 6; // 周一 = 周六 -5 天
    }
    if (/^下/.test(pre)) off += 7;
    return dayOf(off);
  });
}

function parseBlock(block, ctx) {
  const hints = extractHints(block);
  const records = [];
  const skipped = [];

  if (hints.student) {
    // 「请假学生：X」在场 → 整块当成一位学生的描述（时间句常常单独占一行）
    // 用 masked 版本：自我介绍、家长姓名、电话、标签都已抹掉，避免污染「原因」
    const joined = withWeekdayDates(
      String(hints.masked || block)
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .join('，'),
      ctx.week
    );
    const rec = parseOne(joined, ctx);
    if (!rec || !rec.startAt) {
      skipped.push(block.trim().slice(0, 80));
      return { records, skipped };
    }
    const rn = resolveHintName(hints.student, ctx);
    rec.name = rn.name;
    rec.rawName = rn.rawName || rn.name;
    rec.confidence = { ...rec.confidence, name: rn.confidence };
    if (rn.student) {
      rec.dorm = rec.dorm || rn.student.dorm || '';
      rec.group = rec.group || rn.student.group || '';
    }
    if (hints.phone && !rec.phone) rec.phone = hints.phone;
    if (hints.parent && !rec.contact) rec.contact = hints.parent;

    // 「周六9点半走，周日8点回来」这类中间夹了动词的写法：取前两个时间点当起止
    if (rec.startAt && !rec.endAt) {
      const atoms = scanAtoms(joined);
      const ref = parseWeekDate(ctx.week && ctx.week.saturday);
      if (atoms.length >= 2 && ref) {
        const alt = parseTimeRange(`${atoms[0].raw}至${atoms[1].raw}`, ref);
        if (alt.start && alt.end) {
          rec.endAt = alt.end;
          rec.confidence = { ...rec.confidence, time: 'ok' };
          rec.warnings.push('结束时间由后一句时间推断，请确认');
        }
      }
    }
    records.push(rec);
    return { records, skipped };
  }

  // 没有标签 → 退回逐行解析（老师手写的「姓名 宿舍 时间」清单）
  const segments = [];
  for (const line of String(hints.masked || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (HEADER_WORDS.test(line)) continue;
    if (line.replace(/\s/g, '').length < 2) continue;
    segments.push(...splitNumbered(line));
  }
  for (const seg of segments) {
    let parts = [seg];
    if (countNames(seg, ctx) >= 2) {
      const bySemi = seg.split(/[；;]/).filter((x) => x.trim());
      parts = bySemi.length >= 2 ? bySemi : splitByName(seg, ctx);
    }
    for (const p of parts) {
      const rec = parseOne(p.replace(/^\s*\d{1,3}\s*[.、．)）:：]\s*/, ''), ctx);
      if (!rec) continue;
      const junk = !rec.startAt && !rec.dorm && !rec.group;
      if (junk || (!rec.name && !rec.startAt)) {
        skipped.push(p.trim());
        continue;
      }
      records.push(rec);
    }
  }
  // 只有姓名的重复行并入同名且有时间的那条
  const withTime = new Set(records.filter((r) => r.startAt).map((r) => r.name));
  const merged = [];
  for (const r of records) {
    if (!r.startAt && r.name && withTime.has(r.name)) {
      const host = merged.find((x) => x.name === r.name && x.startAt);
      if (host) {
        if (!host.phone && r.phone) host.phone = r.phone;
        if (!host.contact && r.contact) host.contact = r.contact;
      }
      continue;
    }
    merged.push(r);
  }
  return { records: merged, skipped };
}

/* 同一个人 + 同一个开始时间 → 合并成一条（重复粘贴多条文案时最常见） */
function mergeDuplicates(records) {
  const out = [];
  const map = new Map();
  for (const r of records) {
    if (!r.warnings) r.warnings = [];
    const key = `${r.name}|${r.startAt || ''}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      out.push(r);
      continue;
    }
    if (r.reason && (!prev.reason || r.reason.length > prev.reason.length)) prev.reason = r.reason;
    if (!prev.dorm && r.dorm) prev.dorm = r.dorm;
    if (!prev.group && r.group) prev.group = r.group;
    if (!prev.phone && r.phone) prev.phone = r.phone;
    if (!prev.contact && r.contact) prev.contact = r.contact;
    for (const w of r.warnings) if (!prev.warnings.includes(w)) prev.warnings.push(w);
    if (!prev.warnings.includes('同一人多条消息，已合并')) prev.warnings.push('同一人多条消息，已合并');
  }
  return out;
}

export function parseText(text, ctx) {
  const blocks = splitBlocks(text);
  const records = [];
  const skipped = [];
  for (const block of blocks) {
    const r = parseBlock(block, ctx);
    records.push(...r.records);
    skipped.push(...r.skipped);
  }
  const list = mergeDuplicates(records);
  // 整段只有一个学生时，把散落在别处的电话/家长补上
  if (list.length === 1) {
    const one = list[0];
    const pm = String(text).match(/(?<!\d)(1[3-9]\d{9})(?!\d)/);
    if (!one.phone && pm) one.phone = pm[1];
    if (!one.contact) {
      const cm = String(text).match(/(?:学生家长|家长姓名|家长)[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
      if (cm) one.contact = cm[1];
    }
  }
  return { records: list, skipped };
}

function countNames(seg, ctx) {
  let s = seg;
  let n = 0;
  for (const st of ctx.sorted) {
    if (s.includes(st.name)) {
      s = s.split(st.name).join('\u0001');
      n++;
    }
  }
  return n;
}

function splitByName(seg, ctx) {
  const hits = [];
  for (const st of ctx.sorted) {
    let idx = seg.indexOf(st.name);
    while (idx >= 0) {
      hits.push({ idx });
      idx = seg.indexOf(st.name, idx + st.name.length);
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  if (hits.length < 2) return [seg];
  const parts = [];
  let last = 0;
  for (let i = 1; i < hits.length; i++) {
    parts.push(seg.slice(last, hits[i].idx));
    last = hits[i].idx;
  }
  parts.push(seg.slice(last));
  return parts.filter((p) => p.trim());
}

/* ================================================================== */
/* 名册更新：从粘贴的名单里认「姓名 + 宿舍 + 班组 + 班级」                 */
/* ================================================================== */

const CLASS_RE = /(超能|丰泰)\s*(?:班)?\s*([一二三123])?\s*班(?!\s*组)/;

export function normalizeClass(text) {
  const m = String(text || '').match(CLASS_RE);
  if (!m) return '';
  const org = m[1];
  const odd = m[2] ? cnToInt(m[2]) : 0;
  if (org === '丰泰') return '丰泰班';
  return odd ? `超能${odd}班` : '';
}

/**
 * 解析一段名单文本，一行一个人，字段顺序不限：
 *   张三 A231 超能二1组 超能2班 13800000000
 *   张三	B513	超能三3组	超能3班      （从 Excel 直接粘，制表符分隔）
 *   李四 走读
 * 返回 { rows, skipped }，rows 里 matched 表示名册里已有这个人。
 */
export function parseRosterText(text, ctx) {
  const rows = [];
  const skipped = [];
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    let work = normalizeLine(raw);
    if (!work) continue;
    if (/^(序号|姓名|学生|宿舍号?|班组|班级|组别)$/.test(work)) {
      skipped.push(raw);
      continue;
    }
    if (/^(序号|姓名)\s*[、,，]?\s*(宿舍|班组|班级)/.test(work)) {
      skipped.push(raw);
      continue;
    }
    work = work.replace(/^\d{1,4}\s*[.、,，)）]\s*/, ' ');

    let dorm = '';
    let group = '';
    let className = '';
    let phone = '';

    const dm = work.match(DORM_RE);
    if (dm) {
      dorm = `${dm[1]}${dm[2]}`.toUpperCase();
      work = work.replace(dm[0], ' ');
    } else if (work.includes('走读')) {
      dorm = '走读';
      work = work.replace(/走读/g, ' ');
    }

    const gm = work.match(GROUP_RE);
    if (gm) {
      group = normalizeGroup(gm[0]);
      work = work.replace(gm[0], ' ');
    }

    const cm = work.match(CLASS_RE);
    if (cm) {
      className = normalizeClass(cm[0]);
      work = work.replace(cm[0], ' ');
    }

    const pm = work.match(/(?<!\d)(1[3-9]\d{9})(?!\d)/);
    if (pm) {
      phone = pm[1];
      work = work.replace(pm[0], ' ');
    }

    const found = findName(work, ctx);
    if (!found.name) {
      skipped.push(raw);
      continue;
    }
    if (!dorm && !group && !className && !phone) {
      skipped.push(raw);
      continue;
    }

    const student = found.student || ctx.byName.get(found.name) || null;
    rows.push({
      raw,
      name: found.name,
      rawName: found.rawName || found.name,
      confidence: found.confidence,
      matched: !!student,
      dorm,
      group,
      className,
      phone,
      before: student ? { dorm: student.dorm || '', group: student.group || '', className: student.className || '' } : null,
    });
  }
  return { rows, skipped };
}
