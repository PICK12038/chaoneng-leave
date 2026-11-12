import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildContext, parseText } from '../chaoneng-cloud/parser.js';

const raw = JSON.parse(fs.readFileSync('data/roster.json', 'utf8').replace(/^\uFEFF/, ''));
const roster = Array.isArray(raw) ? raw : raw.students || [];
const ctx = buildContext(roster, { saturday: '2026-10-24', cutoff: '21:30' });

test('完全无意义的内容：不产生假记录，进「未识别」', () => {
  const { records, skipped } = parseText('asdfghjkl 这是一段没有意义的文字', ctx);
  assert.equal(records.length, 0);
  assert.equal(skipped.length, 1);
});

test('只有时间、没有姓名：留一条待补，老师补名字即可', () => {
  const { records } = parseText('10月25日8:30到16:30', ctx);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '');
  assert.equal(records[0].startAt, '2026-10-25T08:30');
  assert.ok(records[0].warnings.some((w) => /补|未识别到姓名/.test(w)));
});

test('有名册姓名但没时间：留一条待补，不丢', () => {
  const { records } = parseText('苏甜 家里有事要回家一趟', ctx);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '苏甜');
  assert.ok(records[0].warnings.some((w) => /补|未识别到时间/.test(w)));
});

test('姓名 + 时间但没写「请假学生」：照样认出来', () => {
  const { records } = parseText('苏甜 10月25日8:30到16:30', ctx);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, '苏甜');
  assert.equal(records[0].startAt, '2026-10-25T08:30');
});

test('乱码不会冒充成姓名', () => {
  const { records } = parseText('abc def 你好呀 今天天气不错', ctx);
  for (const r of records) {
    assert.ok(!r.name || ctx.byName.has(r.name), '出现了名册外的假姓名：' + r.name);
  }
});
