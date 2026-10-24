'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');
const Core = require('../src/core.js');

const NOW = new Date(2026, 9, 24, 10, 0, 0).getTime();

function make() {
  const e = new Engine({
    file: path.join(os.tmpdir(), 'dt-groups-' + Math.random().toString(36).slice(2) + '.json'),
    now: () => NOW
  }).load();
  const add = (title, group, status) => e.addTask({ title, group, status, deadline: new Date(NOW + Core.DAY) });
  return { e, add };
}

const names = (e) => e.state().groupStats.map((g) => g.name);

test('thêm nhóm trống: hiện trong thống kê, không trùng tên (không phân biệt dấu)', () => {
  const { e, add } = make();
  add('A', 'Toán rời rạc');
  e.addGroup('  #Đồ án 2 ');
  assert.deepStrictEqual(names(e), ['Đồ án 2', 'Toán rời rạc']);
  assert.strictEqual(e.state().groupStats[0].count, 0);
  assert.throws(() => e.addGroup('toan roi rac'), /đã có/);
  assert.throws(() => e.addGroup('   '), /trống/);
});

test('đổi tên nhóm: cập nhật mọi việc, đánh dấu để đồng bộ', () => {
  const { e, add } = make();
  const a = add('A', 'BTL1');
  const b = add('B', 'BTL1');
  add('C', 'Khác');
  const r = e.renameGroup('BTL1', 'Bài tập lớn');
  assert.deepStrictEqual([r.name, r.changed, r.merged], ['Bài tập lớn', 2, false]);
  assert.strictEqual(e.data.tasks[a.id].group, 'Bài tập lớn');
  assert.strictEqual(e.data.tasks[b.id].group, 'Bài tập lớn');
  assert.ok(e.data.tasks[a.id]._dirty);
  assert.deepStrictEqual(names(e), ['Bài tập lớn', 'Khác']);
});

test('đổi sang tên nhóm đã có = gộp, dùng đúng cách viết của nhóm đích', () => {
  const { e, add } = make();
  const a = add('A', 'btl1');
  add('B', 'BTL2');
  const r = e.renameGroup('btl1', 'btl2');
  assert.deepStrictEqual([r.name, r.merged], ['BTL2', true]);
  assert.strictEqual(e.data.tasks[a.id].group, 'BTL2');
  assert.deepStrictEqual(names(e), ['BTL2']);
});

test('chỉ đổi hoa thường cho chính nhóm đó không bị coi là gộp', () => {
  const { e, add } = make();
  add('A', 'btl1');
  const r = e.renameGroup('btl1', 'BTL1');
  assert.deepStrictEqual([r.name, r.merged, r.changed], ['BTL1', false, 1]);
});

test('xóa nhóm: việc còn nguyên, chỉ bỏ nhóm; hoàn tác bằng assignGroup', () => {
  const { e, add } = make();
  const a = add('A', 'BTL1');
  const b = add('B', 'BTL1', 'done');
  const r = e.deleteGroup('BTL1');
  assert.strictEqual(r.ids.length, 2);
  assert.strictEqual(e.data.tasks[a.id].group, '');
  assert.strictEqual(e.data.tasks[a.id].deleted, false);
  assert.deepStrictEqual(names(e), []);
  e.assignGroup(r.ids, 'BTL1');
  assert.strictEqual(e.data.tasks[b.id].group, 'BTL1');
  assert.deepStrictEqual(names(e), ['BTL1']);
});

test('xóa/đổi tên nhóm trống tạo sẵn', () => {
  const { e } = make();
  e.addGroup('Rỗng');
  e.renameGroup('Rỗng', 'Rỗng 2');
  assert.deepStrictEqual(names(e), ['Rỗng 2']);
  e.deleteGroup('Rỗng 2');
  assert.deepStrictEqual(names(e), []);
});

test('thống kê nhóm: đếm đang mở và tổng', () => {
  const { e, add } = make();
  add('A', 'G');
  add('B', 'G', 'done');
  assert.deepStrictEqual(e.state().groupStats, [{ name: 'G', count: 1, total: 2 }]);
});
