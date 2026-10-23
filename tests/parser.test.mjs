// 解析器测试：Node 内置 test runner（node --test），零依赖。
// 运行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContext, parseText, categoryOf, timeTextOf } from '../chaoneng-cloud/parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'roster.json'), 'utf8')).students;
const week = { id: '2026-10-24', saturday: '2026-10-24' };
const ctx = buildContext(roster, week);

const parse = (text) => parseText(text, ctx);
const names = (records) => records.map((r) => r.name);

/* ---------- 用户实际遇到的三条粘连文案 ---------- */
const GLUED = `{至教务老师处盖章 请假模块}教务老师，您好！
我是盘立炜学生的家长，盘立炜因为报考原因需请假回家，请假时间10月24日16时30分至10月25日20时0分，离校期间一切安全问题自行负责。
请假学生：盘立炜
学生家长：甘雪容
家长联系电话：13719844338辅导员，您好！
我是周家豪学生的家长，周家豪因为外出的原因需要外出购物，请假时间10月25日9时0分至10月25日20时0分，离校期间一切安全问题自行负责。
请假学生：周家豪
学生家长：周仙帮
家长联系电话：13829870808`;

const SINGLE = `教务老师，您好！
我是杨杰丞学生的家长，杨杰丞因为外出的原因需要请假外出，请假时间10月25日10时0分至10月25日23时0分，离校期间一切安全问题自行负责。
请假学生：杨杰丞
学生家长：凌建梅
家长联系电话：13553519804`;

test('三条首尾粘连的家长文案：各归各的名字，不串台', () => {
  const { records } = parse(GLUED);
  assert.equal(records.length, 2, '应识别出 2 条（盘立炜、周家豪）');
  assert.deepEqual(names(records), ['盘立炜', '周家豪']);
  const [a, b] = records;
  assert.equal(a.startAt, '2026-10-24T16:30');
  assert.equal(a.endAt, '2026-10-25T20:00');
  assert.equal(b.startAt, '2026-10-25T09:00');
  assert.equal(b.endAt, '2026-10-25T20:00');
  assert.equal(b.phone, '13829870808');
  assert.equal(b.contact, '周仙帮');
  assert.equal(a.contact, '甘雪容');
});

test('单条 + 前面带头部说明：头部不产生记录', () => {
  const { records, skipped } = parse(`{至教务老师处盖章 请假模块}\n${SINGLE}`);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '杨杰丞');
  assert.equal(records[0].startAt, '2026-10-25T10:00');
  assert.ok(skipped.length >= 1, '头部说明应进未识别');
});

test('把三条拼在一起（不分段）：仍是 3 个不同的人', () => {
  const { records } = parse(`${SINGLE}\n${GLUED}`);
  assert.deepEqual(names(records), ['杨杰丞', '盘立炜', '周家豪']);
  const set = new Set(names(records));
  assert.equal(set.size, records.length, '不得出现重复姓名');
});

test('同一人两条（不同时间）各出一条，不互相覆盖', () => {
  const twice = `${SINGLE}\n\n${SINGLE.replace('10时0分至10月25日23时0分', '14时0分至10月25日18时0分')}`;
  const { records } = parse(twice);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.startAt), ['2026-10-25T10:00', '2026-10-25T14:00']);
  assert.ok(records.every((r) => r.name === '杨杰丞'));
});

test('重复粘贴同一条：只出 1 条并标记合并', () => {
  const { records } = parse(`${SINGLE}\n\n${SINGLE}`);
  assert.equal(records.length, 1);
  assert.ok(records[0].warnings.some((w) => w.includes('合并')));
});

/* ---------- 容错：各种写法 ---------- */
test('中文数字 + 中文时间', () => {
  const { records } = parse('请假学生：莫海妍\n请假时间十月二十五日八点半至十六点半');
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '莫海妍');
  assert.equal(records[0].startAt, '2026-10-25T08:30');
  assert.equal(records[0].endAt, '2026-10-25T16:30');
});

test('斜杠日期', () => {
  const { records } = parse('请假学生：苏甜\n10/25 8:30 至 10/26 12:00');
  assert.equal(records[0].startAt, '2026-10-25T08:30');
  assert.equal(records[0].endAt, '2026-10-26T12:00');
});

test('只写周几：按当前周换算', () => {
  const { records } = parse('请假学生：苏甜\n周日8点半走，周日晚上八点回来');
  assert.equal(records[0].startAt, '2026-10-25T08:30');
  assert.equal(records[0].endAt, '2026-10-25T20:00');
});

test('「下周六」顺延一周', () => {
  const { records } = parse('请假学生：苏甜\n下周六9点至18点');
  assert.equal(records[0].startAt, '2026-10-31T09:00');
});

test('表格粘贴（姓名 宿舍 班组 时间）逐行识别', () => {
  const { records } = parse('刘柏萍\tA231\t超能一1组\t10月24日21:30至10月25日20:00\t回家\n关伊萌\tB312\t丰泰班2组\t10月24日18:00至10月25日21:00\t家里有事');
  assert.equal(records.length, 2);
  assert.equal(records[0].dorm, 'A231');
  assert.equal(records[0].group, '超能一1组');
  assert.equal(records[1].group, '丰泰班2组');
});

test('名册外的姓名标 unknown，不静默换人', () => {
  const { records } = parse('请假学生：张三丰\n10月25日9点至18点');
  assert.equal(records[0].confidence.name, 'unknown');
  assert.equal(records[0].name, '张三丰');
});

test('家长姓名不会被当成学生（我是某某家长）', () => {
  const { records } = parse('我是陈玉华学生的家长，苏甜因为外出需要请假，请假时间10月25日9时至18时。\n请假学生：苏甜\n学生家长：陈玉华');
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '苏甜');
  assert.equal(records[0].contact, '陈玉华');
});

test('只有「我是某某家长」时也不把人名当学生', () => {
  const { records } = parse('我是陈玉华学生的家长，苏甜因为外出需要请假，请假时间10月25日9时至18时。');
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '苏甜');
});

test('分类只看开始时间：周六21:30前=提前、周六=周六、周日=周日', () => {
  assert.equal(categoryOf('2026-10-23T17:00', week), 'early');
  assert.equal(categoryOf('2026-10-24T21:30', week), 'sat');
  assert.equal(categoryOf('2026-10-24T22:00', week), 'sat');
  assert.equal(categoryOf('2026-10-25T08:30', week), 'sun');
});

test('时间文案可回显', () => {
  const { records } = parse('请假学生：苏甜\n10月25日8点30分至10月26日12点');
  assert.match(timeTextOf(records[0]), /10月25日08时30分.*10月26日12时00分/);
});

/* ---------- 随机拼装：任意顺序/分隔都不许出现重复姓名 ---------- */
test('随机拼装 30 组：记录数恒等于独立学生数，无重复姓名', () => {
  const pool = [
    ['刘柏萍', '10月24日21:30至10月25日20:00'],
    ['关伊萌', '10月24日18:00至10月25日21:00'],
    ['苏甜', '10月25日8:30至16:30'],
    ['莫海妍', '10月23日17:00至10月25日20:00'],
    ['杨杰丞', '10月25日10:00至23:00'],
  ];
  const greet = ['教务老师，您好！', '辅导员，您好！', '老师好，', ''];
  const sep = ['\n', '\n\n', '', ' '];
  const pick = (arr, i) => arr[i % arr.length];
  for (let i = 0; i < 30; i++) {
    const chosen = pool.filter((_, k) => (k + i) % 2 === 0 || k === i % pool.length);
    const text = chosen
      .map(([name, time], k) => {
        const g = pick(greet, i + k);
        return `${g}我是${name}学生的家长，${name}因为有事需要请假，请假时间${time}。\n请假学生：${name}\n学生家长：某某\n家长联系电话：1390000000${k}`;
      })
      .join(pick(sep, i));
    const { records } = parse(text);
    const unique = new Set(names(records));
    assert.equal(unique.size, records.length, `第 ${i} 组出现重复姓名：${names(records).join(',')}`);
    assert.equal(records.length, chosen.length, `第 ${i} 组记录数不符：期望 ${chosen.length} 实得 ${records.length}`);
    for (const r of records) assert.ok(chosen.some(([n]) => n === r.name), `第 ${i} 组出现意外姓名 ${r.name}`);
  }
});
