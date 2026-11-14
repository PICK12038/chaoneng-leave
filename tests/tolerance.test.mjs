import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildContext, parseText } from '../chaoneng-cloud/parser.js';

const raw = JSON.parse(fs.readFileSync('data/roster.json', 'utf8').replace(/^\uFEFF/, ''));
const roster = Array.isArray(raw) ? raw : raw.students || [];
const ctx = buildContext(roster, { saturday: '2026-10-24', cutoff: '21:30' });

const parse = (t) => parseText(t, ctx);
const one = (t) => {
  const { records } = parse(t);
  return records[0];
};

/* 每种脏写法都应识别出「姓名 + 开始时间」 */
const TIME_CASES = [
  ['半角冒号', '请假学生：莫海妍\n10月24日21:30-10月25日20:00'],
  ['波浪号', '请假学生：莫海妍\n10月24日21:30~10月25日20:00'],
  ['破折号', '请假学生：莫海妍\n10月24日21:30——10月25日20:00'],
  ['英文 to', '请假学生：莫海妍\n10月24日 21:30 to 10月25日 20:00'],
  ['到字', '请假学生：莫海妍\n10月24日21:30到10月25日20:00'],
  ['中文时段', '请假学生：莫海妍\n10月24号晚上八点半走，25号晚上八点回', '2026-10-24T20:30', '2026-10-25T20:00'],
  ['只有小时', '请假学生：莫海妍\n10月24日21点 到 10月25日20点', '2026-10-24T21:00', '2026-10-25T20:00'],
  ['英文月份', '请假学生：莫海妍\nOct 24 21:30 - Oct 25 20:00'],
  ['含秒', '请假学生：莫海妍\n10月24日21:30:00至10月25日20:00:00'],
  ['星期+日期', '请假学生：莫海妍\n周六(10月24日)21:30到周日(10月25日)20:00'],
  ['顿号分隔', '请假学生：莫海妍\n10月24日、21:30-10月25日、20:00'],
  ['数字被空格劈开', '请假学生：莫海妍\n10月2 4日21:3 0至10月2 5日20:00'],
  ['全角数字', '请假学生：莫海妍\n１０月２４日２１：３０至１０月２５日２０：００'],
  ['只写日', '请假学生：莫海妍\n24号21:30到25号20:00'],
  ['中文时间单位', '请假学生：莫海妍\n10月24日21时30分至10月25日20时00分'],
  ['起止字样', '请假学生：莫海妍\n10月24日21:30 起 10月25日20:00 止'],
  ['ISO 格式', '请假学生：莫海妍\n2026-10-24T21:30 至 2026-10-25T20:00'],
  ['括号注明星期', '请假学生：莫海妍\n10月24日（周六）21:30 - 10月25日（周日）20:00'],
  ['本周六', '请假学生：莫海妍\n本周六21:30到本周日20:00'],
  ['点号当冒号', '请假学生：莫海妍\n10月24日21.30至10月25日20.00'],
];

for (const [label, text, expStart, expEnd] of TIME_CASES) {
  test('时间写法：' + label, () => {
    const r = one(text);
    assert.ok(r, label + ' 没识别出记录');
    assert.equal(r.name, '莫海妍', label + ' 姓名错：' + r.name);
    assert.equal(r.startAt, expStart || '2026-10-24T21:30', label + ' 开始时间错：' + r.startAt);
    assert.equal(r.endAt, expEnd || '2026-10-25T20:00', label + ' 结束时间错：' + r.endAt);
  });
}

const NAME_CASES = [
  ['名字带空格', '请假学生：莫 海 妍\n10月24日21:30至10月25日20:00'],
  ['带「同学」后缀', '请假学生：莫海妍同学\n10月24日21:30至10月25日20:00'],
  ['标签在时间后', '10月24日21:30至10月25日20:00\n请假学生：莫海妍'],
  ['跟宿舍', '请假学生：莫海妍 a239\n10月24日21:30至10月25日20:00'],
  ['跟班组', '请假学生：莫海妍 超能3组\n10月24日21:30至10月25日20:00'],
  ['跟走读', '请假学生：莫海妍 走读\n10月24日21:30至10月25日20:00'],
  ['形近字纠错', '请假学生：莫海燕\n10月24日21:30至10月25日20:00'],
  ['OCR 错字', '请假学生：莫海研\n10月24日21:30至10月25日20:00'],
  ['半角冒号', '请假学生:莫海妍\n10月24日21:30至10月25日20:00'],
  ['冒号前后空格', '请假学生 ： 莫海妍\n10月24日21:30至10月25日20:00'],
  ['方括号标签', '【请假学生】莫海妍\n10月24日21:30至10月25日20:00'],
  ['标签独占一行', '请假学生\n莫海妍\n10月24日21:30至10月25日20:00'],
  ['名字后有逗号', '请假学生：莫海妍，\n10月24日21:30至10月25日20:00'],
  ['零宽字符', '请假学生：莫\u200b海\u200b妍\n10月24日21:30至10月25日20:00'],
  ['多空行拆分', '\n\n\n请假学生：莫海妍\n\n\n10月24日21:30至10月25日20:00\n\n'],
  ['emoji 夹杂', '📢 请假学生：莫海妍\n🕘 10月24日21:30至10月25日20:00 ✅'],
];

for (const [label, text] of NAME_CASES) {
  test('姓名写法：' + label, () => {
    const r = one(text);
    assert.ok(r, label + ' 没识别出记录');
    assert.equal(r.name, '莫海妍', label + ' 姓名错：' + r.name);
    assert.ok(r.startAt, label + ' 没识别出开始时间');
  });
}

test('姓名只认「请假学生：」，自我介绍和家长的姓名都不算', () => {
  const { records } = parse('我是陈玉华学生的家长，苏甜因为外出需要请假，请假时间10月25日9时至18时。\n请假学生：苏甜\n学生家长：陈玉华');
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '苏甜');
  assert.equal(records[0].contact, '陈玉华');
});

test('没有「请假学生：」但有「我是某某家长」时，名册能对上就用它', () => {
  const { records } = parse('我是莫海妍家长，10月24日21:30至10月25日20:00请假');
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '莫海妍');
});

test('表格 / CSV 粘贴逐行识别', () => {
  const a = parse('莫海妍\tA239\t超能三4组\t10月24日21:30至10月25日20:00\t回家');
  assert.equal(a.records[0].name, '莫海妍');
  assert.equal(a.records[0].dorm, 'A239');
  const b = parse('莫海妍,A239,超能三4组,10月24日21:30,10月25日20:00,回家');
  assert.equal(b.records[0].name, '莫海妍');
});

test('序号写法', () => {
  const { records } = parse('1）莫海妍 10月24日21:30至10月25日20:00\n2）苏甜 10月25日8:30至16:30');
  assert.equal(records.length, 2);
});

test('时段词当默认时刻：晚上放学后 → 21:00', () => {
  const { records } = parse('请假学生：陈彦臻\n请假时间11月14日晚上放学后至11月14日晚上23:30前');
  assert.equal(records[0].startAt, '2026-11-14T21:00');
  assert.equal(records[0].endAt, '2026-11-14T23:30');
  assert.ok(records[0].warnings.some((w) => w.includes('请核对')));
});

test('中午放学后 → 12:00；早上8点正常识别', () => {
  const a = parse('请假学生：莫海妍\n11月14日中午放学后至11月14日晚上8点');
  assert.equal(a.records[0].startAt, '2026-11-14T12:00');
  const b = parse('请假学生：莫海妍\n11月14日早上8点至11月14日12点');
  assert.equal(b.records[0].startAt, '2026-11-14T08:00');
});
test("多段时间：叙述性时间在前时，取完整的请假时段", () => {
  const { records } = parse(
    "我是超能2班黄颉焘的家长，今天晚上6点半，黄颉焘与同学约好有事外出，需请假，请假时间11月14日晚上18点30分至晚上23点，外出期间一切安全问题自行负责，请假学生，黄颉焘，学生家长，黄忠全，联系电话18926443349"
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "黄颉焘");
  assert.equal(records[0].startAt, "2026-11-14T18:30");
  assert.equal(records[0].endAt, "2026-11-14T23:00");
  assert.equal(records[0].contact, "黄忠全");
  assert.ok(records[0].warnings.some((w) => w.includes("第 2 段")));
});

test("逗号标签：请假学生，某某 也能认", () => {
  const { records } = parse("请假学生，苏甜，请假时间10月25日9时至18时");
  assert.equal(records[0].name, "苏甜");
});