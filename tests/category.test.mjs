import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryOf,
  decodeCutoff,
  encodeCutoff,
  isDefaultCutoff,
  isWeekOverride,
  cutoffText,
  DEFAULT_CUTOFF,
  DEFAULT_SUN_START,
  DEFAULT_SUN_END,
} from '../chaoneng-cloud/parser.js';

const week = (cutoff) => ({ saturday: '2026-10-24', cutoff });

test('默认：周六 21:30 不算提前请假，算周六', () => {
  assert.equal(categoryOf('2026-10-24T21:29', week()), 'early');
  assert.equal(categoryOf('2026-10-24T21:30', week()), 'sat');
  assert.equal(categoryOf('2026-10-24T22:00', week()), 'sat');
  assert.equal(categoryOf('2026-10-24T23:59', week()), 'sat');
});

test('默认：过了周六零点就是周日', () => {
  assert.equal(categoryOf('2026-10-25T00:00', week()), 'sun');
  assert.equal(categoryOf('2026-10-25T08:30', week()), 'sun');
  assert.equal(categoryOf('2026-10-25T23:59', week()), 'sun');
  assert.equal(categoryOf('2026-10-26T00:00', week()), 'other');
});

test('自定义：周六 19:00 之后不再算提前', () => {
  const w = week('19:00');
  assert.equal(categoryOf('2026-10-24T18:59', w), 'early');
  assert.equal(categoryOf('2026-10-24T19:00', w), 'sat');
});

test('自定义：周六 21:30 走、周日 06:00 前都算周六', () => {
  const w = week(encodeCutoff('21:30', '06:00'));
  assert.equal(categoryOf('2026-10-24T21:30', w), 'sat');
  assert.equal(categoryOf('2026-10-25T01:30', w), 'sat', '凌晨出发仍算周六');
  assert.equal(categoryOf('2026-10-25T05:59', w), 'sat');
  assert.equal(categoryOf('2026-10-25T06:00', w), 'sun');
  assert.equal(categoryOf('2026-10-25T20:00', w), 'sun');
});

test('自定义：两个值都改', () => {
  const w = week(encodeCutoff('18:00', '08:00'));
  assert.equal(categoryOf('2026-10-24T17:00', w), 'early');
  assert.equal(categoryOf('2026-10-24T18:00', w), 'sat');
  assert.equal(categoryOf('2026-10-25T07:59', w), 'sat');
  assert.equal(categoryOf('2026-10-25T08:00', w), 'sun');
});

test('调休：周日 18:00 之后算「其他」', () => {
  const w = week(encodeCutoff('19:00', '05:00', '18:00'));
  assert.equal(categoryOf('2026-10-24T18:00', w), 'early');
  assert.equal(categoryOf('2026-10-25T04:00', w), 'sat');
  assert.equal(categoryOf('2026-10-25T18:00', w), 'sun', '18:00 准点仍算周日');
  assert.equal(categoryOf('2026-10-25T18:01', w), 'other');
});

test('cutoff 编解码', () => {
  assert.equal(DEFAULT_CUTOFF, '21:30');
  assert.equal(DEFAULT_SUN_START, '00:00');
  assert.equal(DEFAULT_SUN_END, '23:59');
  assert.deepEqual(decodeCutoff('21:30'), { cutoff: '21:30', sunStart: '00:00', sunEnd: '23:59' });
  assert.deepEqual(decodeCutoff('20:00|07:00'), { cutoff: '20:00', sunStart: '07:00', sunEnd: '23:59' });
  assert.deepEqual(decodeCutoff('19:00|05:00|18:00'), { cutoff: '19:00', sunStart: '05:00', sunEnd: '18:00' });
  assert.deepEqual(decodeCutoff(undefined), { cutoff: '21:30', sunStart: '00:00', sunEnd: '23:59' });
  assert.deepEqual(decodeCutoff('乱写'), { cutoff: '21:30', sunStart: '00:00', sunEnd: '23:59' });
  assert.equal(encodeCutoff('21:30', '00:00'), '21:30');
  assert.equal(encodeCutoff('21:30', '06:00'), '21:30|06:00');
  assert.equal(encodeCutoff('19:00', '05:00', '18:00'), '19:00|05:00|18:00');
  assert.equal(encodeCutoff('9:5', '6:0'), '09:05|06:00', '单位数自动补零');
  assert.equal(encodeCutoff('', ''), '21:30');
});

test('默认判定与文案', () => {
  assert.equal(isDefaultCutoff('21:30'), true);
  assert.equal(isDefaultCutoff('21:30|00:00'), true);
  assert.equal(isDefaultCutoff('19:00'), false);
  assert.match(cutoffText('21:30'), /21:30/);
  assert.match(cutoffText('19:00|06:00'), /19:00.*06:00/);
});

test('周次覆盖标记：等号开头才算覆盖，解码时自动去掉', () => {
  assert.equal(isWeekOverride('=19:00|05:00'), true);
  assert.equal(isWeekOverride('19:00|05:00'), false);
  assert.equal(isWeekOverride(''), false);
  assert.equal(isWeekOverride(undefined), false);
  assert.deepEqual(decodeCutoff('=19:00|05:00|18:00'), { cutoff: '19:00', sunStart: '05:00', sunEnd: '18:00' });
  assert.equal(categoryOf('2026-10-24T18:30', week('=19:00')), 'early');
  assert.equal(categoryOf('2026-10-24T19:30', week('=19:00')), 'sat');
});

test('历史数据用默认口径不受影响', () => {
  const legacy = { saturday: '2026-10-24' };
  assert.equal(categoryOf('2026-10-24T17:00', legacy), 'early');
  assert.equal(categoryOf('2026-10-24T21:30', legacy), 'sat');
  assert.equal(categoryOf('2026-10-25T09:00', legacy), 'sun');
});
