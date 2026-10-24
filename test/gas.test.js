'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { build } = require('../apps-script/build.js');

// nạp Code.gs vào sandbox với các dịch vụ Google để trống: chỉ kiểm tra phần logic thuần
const ctx = vm.createContext({ console, Date, Math, JSON, Number, String, Array, Object, isFinite, isNaN, parseInt });
vm.runInContext(build(), ctx, { filename: 'Code.gs' });
const run = (src) => vm.runInContext(src, ctx);

test('Code.gs: ưu tiên chữ cũ và số đều được chuẩn hóa về 1-5', () => {
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(["high","normal","low",1,2,"3",5,"5",0,6,"",null,undefined,"constructor"].map(normPriority_))')),
    [1, 3, 5, 1, 2, 3, 5, 5, 3, 3, 3, 3, 3, 3]);
});

test('Code.gs: clean_ nhận ưu tiên số và chữ cũ', () => {
  const mk = (p) => JSON.parse(run('JSON.stringify(clean_({id:"tabcd1234",title:"A",deadline:"2026-10-25T23:59:00+07:00",priority:' + JSON.stringify(p) + '}, 1))')).priority;
  assert.strictEqual(mk(2), 2);
  assert.strictEqual(mk('high'), 1);
  assert.strictEqual(mk('low'), 5);
  assert.strictEqual(mk('lol'), 3);
});

test('Code.gs: dòng Sheet cũ (chữ) đọc ra số, ghi lại dạng chuỗi số', () => {
  const row = ['t1abcd', 'A', '', '', 'G', 'high', 'todo', '2026-10-25T23:59:00+07:00', '[1440]', '[]', '', '1', '2', '3', 'false', '0'];
  ctx.__row = row;
  assert.strictEqual(run('fromRow_(__row).priority'), 1);
  assert.strictEqual(run('toRow_(fromRow_(__row))[5]'), '1');
});

test('Code.gs: trang điện thoại có core.js mới và giữ chỗ BOOT', () => {
  const html = run('__MOBILE_HTML__');
  assert.ok(html.includes('function normPriority('));
  assert.ok(html.includes('/*BOOT*/null'));
  assert.ok(!html.includes('/*__CORE__*/'));
  assert.ok(!/priority === 'high'/.test(html));
});

test('Code.gs: mô tả sự kiện Calendar ghi mức ưu tiên', () => {
  ctx.__t = { title: 'A', priority: 1, group: 'G', checklist: [] };
  assert.match(run('eventDesc_(__t)'), /Ưu tiên: 1 \(Rất cao\) · Nhóm: G/);
});
