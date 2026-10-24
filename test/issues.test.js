'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');

const NOW = new Date(2026, 9, 24, 10, 0, 0);
const codes = (s) => Core.parseQuick(s, NOW).issues.map((i) => i.code);

test('nhập đủ và đúng: không có cảnh báo', () => {
  assert.deepStrictEqual(codes('Nộp báo cáo !1 mai 17h'), []);
});

test('ưu tiên sai bị chặn', () => {
  const r = Core.parseQuick('Nộp bài !9 mai 17h', NOW);
  assert.deepStrictEqual(r.issues.map((i) => i.code), ['priority']);
  assert.ok(Core.hasError(r.issues));
  assert.ok(Core.parseQuick('Nộp bài !abc mai 17h', NOW).issues.some((i) => i.code === 'priority'));
});

test('nhiều mức ưu tiên khác nhau chỉ cảnh báo', () => {
  const r = Core.parseQuick('Nộp bài !1 !5 mai 17h', NOW);
  assert.deepStrictEqual(r.issues.map((i) => i.code), ['priority-conflict']);
  assert.ok(!Core.hasError(r.issues));
});

test('thiếu hạn hoặc thiếu tên bị chặn', () => {
  assert.deepStrictEqual(codes('Nộp bài'), ['deadline']);
  assert.ok(codes('mai 17h').includes('title'));
  assert.deepStrictEqual(codes(''), []);
});

test('hạn đã qua bị chặn', () => {
  assert.deepStrictEqual(codes('Nộp bài 25/10/2025'), ['past']);
});

test('hạn chưa cụ thể giờ hoặc ngày chỉ cảnh báo', () => {
  assert.deepStrictEqual(codes('Nộp bài mai'), ['no-time']);
  assert.deepStrictEqual(codes('Nộp bài 17h'), ['no-date']);
});

test('quickAdd chặn khi có lỗi, cho qua khi chỉ cảnh báo', () => {
  const os = require('os');
  const path = require('path');
  const { Engine } = require('../src/engine.js');
  const e = new Engine({ file: path.join(os.tmpdir(), 'dt-issues-' + Math.random().toString(36).slice(2) + '.json'), now: () => NOW.getTime() }).load();
  const bad = e.quickAdd('Nộp bài !9 mai 17h');
  assert.ok(bad.needsForm && bad.issues.length);
  assert.ok(e.quickAdd('Nộp bài mai').task);
});
