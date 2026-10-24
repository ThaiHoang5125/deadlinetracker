'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');
const Core = require('../src/core.js');

const NOW = new Date(2026, 9, 24, 10, 0, 0).getTime();
const LINK = 'https://script.google.com/macros/s/abc/exec';

function make(fetchImpl) {
  let clock = NOW;
  const e = new Engine({
    file: path.join(os.tmpdir(), 'dt-test-' + Math.random().toString(36).slice(2) + '.json'),
    now: () => clock,
    fetch: fetchImpl
  }).load();
  e.data.config = { url: LINK, key: 'k' };
  e.advance = (ms) => { clock += ms; };
  return e;
}

// server giả: nhớ việc đã nhận, trả lại đúng như vậy
function fakeServer() {
  const store = {};
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    (body.tasks || []).forEach((t) => { store[t.id] = t; });
    return { status: 200, text: async () => JSON.stringify({ ok: true, tasks: Object.values(store) }) };
  };
}

test('hoàn tác xóa vẫn chạy sau khi đồng bộ đã gỡ việc khỏi máy', async () => {
  const e = make(fakeServer());
  const t = e.addTask({ title: 'Nộp báo cáo', deadline: new Date(NOW + 3 * Core.DAY) });
  await e.syncNow();
  e.deleteTask(t.id);
  await e.syncNow();
  assert.strictEqual(e.data.tasks[t.id], undefined, 'việc đã bị gỡ khỏi máy');
  const back = e.restoreTask(t.id);
  assert.ok(back && !back.deleted);
  assert.strictEqual(e.data.tasks[t.id].title, 'Nộp báo cáo');
});

test('hoàn tác quá 60 giây thì không còn', async () => {
  const e = make(fakeServer());
  const t = e.addTask({ title: 'A', deadline: new Date(NOW + Core.DAY) });
  await e.syncNow();
  e.deleteTask(t.id);
  await e.syncNow();
  e.advance(61 * 1000);
  assert.strictEqual(e.restoreTask(t.id), null);
});

test('markDone không đảo ngược việc đã xong', () => {
  const e = make();
  e.data.config = { url: '', key: '' };
  const t = e.addTask({ title: 'B', deadline: new Date(NOW + Core.DAY), status: 'done' });
  assert.strictEqual(e.markDone(t.id).status, 'done');
  const u = e.addTask({ title: 'C', deadline: new Date(NOW + Core.DAY) });
  assert.strictEqual(e.markDone(u.id).status, 'done');
  assert.strictEqual(e.markDone(u.id).status, 'done');
});

test('parseQuick: thứ 6 17h', () => {
  const r = Core.parseQuick('Nộp báo cáo #BTL1 !cao thứ 6 17h', new Date(NOW));
  assert.strictEqual(r.title, 'Nộp báo cáo');
  assert.strictEqual(r.group, 'BTL1');
  assert.strictEqual(r.priority, 1);
  assert.strictEqual(r.deadline.getDay(), 5);
  assert.strictEqual(r.deadline.getHours(), 17);
});

test('parseLink chỉ nhận script.google.com', () => {
  const { parseLink } = require('../src/engine.js');
  assert.ok(parseLink(LINK, 'k').url);
  assert.ok(parseLink('https://evil.example/macros/s/abc/exec', 'k').error);
});

const P = (s, groups) => Core.parseQuick(s, new Date(NOW), { groups: groups || [] });

test('nhóm nhiều từ: "abc #a bc" -> nhóm "a bc", tên "abc"', () => {
  const r = P('abc #a bc');
  assert.strictEqual(r.group, 'a bc');
  assert.strictEqual(r.title, 'abc');
});

test('nhóm nhiều từ dừng ở ngày giờ và ưu tiên', () => {
  const r = P('Nộp bài #Toán rời rạc !2 thứ 6 17h');
  assert.strictEqual(r.group, 'Toán rời rạc');
  assert.strictEqual(r.title, 'Nộp bài');
  assert.strictEqual(r.priority, 2);
  assert.strictEqual(r.deadline.getHours(), 17);
});

test('nhóm nhiều từ không nuốt từ nối "trước" trước ngày', () => {
  const r = P('Nộp bài #a bc trước thứ 6');
  assert.strictEqual(r.group, 'a bc');
  assert.strictEqual(r.title, 'Nộp bài');
});

test('nhóm trong ngoặc cho phép viết tiếp tên việc', () => {
  assert.strictEqual(P('#"Toán rời rạc" làm bài tập mai').group, 'Toán rời rạc');
  assert.strictEqual(P('#"Toán rời rạc" làm bài tập mai').title, 'làm bài tập');
  assert.strictEqual(P('#[a bc] làm gấp mai').title, 'làm gấp');
});

test('khớp nhóm nhiều từ đã có, không phân biệt dấu', () => {
  const r = P('Làm bài tập #toan roi rac mai nhé', ['Toán rời rạc']);
  assert.strictEqual(r.group, 'Toán rời rạc');
  assert.strictEqual(r.title, 'Làm bài tập nhé');
});

test('thẻ một từ vẫn như cũ', () => {
  const r = P('Nộp báo cáo #BTL1 thứ 6 17h');
  assert.strictEqual(r.group, 'BTL1');
  assert.strictEqual(r.title, 'Nộp báo cáo');
});

test('ưu tiên thang 5 số', () => {
  assert.strictEqual(P('x !1 mai').priority, 1);
  assert.strictEqual(P('x !5 mai').priority, 5);
  assert.strictEqual(P('x !cao mai').priority, 1);
  assert.strictEqual(P('x !tb mai').priority, 3);
  assert.strictEqual(P('x !thap mai').priority, 5);
  assert.strictEqual(P('x mai').priority, 3);
  assert.strictEqual(P('x !9 mai').priority, 3);
});

test('chuyển ưu tiên dạng chữ cũ sang số', () => {
  assert.strictEqual(Core.normPriority('high'), 1);
  assert.strictEqual(Core.normPriority('normal'), 3);
  assert.strictEqual(Core.normPriority('low'), 5);
  assert.strictEqual(Core.normPriority(undefined), 3);
  assert.deepStrictEqual(Core.offsetsForPriority('low'), [1440]);
});

test('mức 1 có thêm mốc 1 giờ', () => {
  assert.deepStrictEqual(Core.offsetsForPriority(1), [20160, 10080, 4320, 1440, 180, 60, 0]);
});

test('gõ ! -> gợi ý mức ưu tiên kèm mốc nhắc', () => {
  assert.strictEqual(Core.bangTyping('abc'), null);
  assert.strictEqual(Core.bangTyping('abc !1 mai'), null);
  assert.deepStrictEqual(Core.bangTyping('abc !'), { typed: '', start: 4 });
  assert.strictEqual(Core.bangTyping('abc !ca').typed, 'ca');
  const all = Core.priorityOptions('');
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all[0].text, '2 tuần · 1 tuần · 3 ngày · 1 ngày · 3 giờ · 1 giờ · Đúng hạn');
  assert.strictEqual(all[4].text, '1 ngày');
  assert.deepStrictEqual(Core.priorityOptions('2').filter((o) => o.match).map((o) => o.level), [2]);
  assert.deepStrictEqual(Core.priorityOptions('ca').filter((o) => o.match).map((o) => o.level), [1]);
  assert.deepStrictEqual(Core.priorityOptions('th').filter((o) => o.match).map((o) => o.level), [5]);
  assert.strictEqual(Core.parseQuick('x !gap mai', new Date(NOW)).priority, 1);
});

test('nhóm không nuốt thẻ ! (kể cả !7 không hợp lệ)', () => {
  const r = P('a #a b c !7');
  assert.strictEqual(r.group, 'a b c');
  assert.strictEqual(r.priority, 3);
  assert.strictEqual(P('a #a b !2').group, 'a b');
});

test('gõ # -> nhận diện thẻ nhóm đang gõ dở', () => {
  assert.strictEqual(Core.hashTyping('abc'), null);
  assert.deepStrictEqual(Core.hashTyping('abc #'), { typed: '', start: 4 });
  assert.deepStrictEqual(Core.hashTyping('abc #toan ro'), { typed: 'toan ro', start: 4 });
  assert.strictEqual(Core.hashTyping('abc#x'), null);
  assert.strictEqual(Core.hashTyping('#"Toán rời rạc" làm'), null);
  assert.strictEqual(Core.hashTyping('#a !'), null);
});

test('thống kê nhóm: đếm việc đang mở', () => {
  const mk = (group, status, deleted) => ({ id: group + status, group, status, deleted: !!deleted });
  const st = Core.groupStats([mk('B', 'todo'), mk('B', 'done'), mk('A', 'done'), mk('C', 'todo', true)]);
  assert.deepStrictEqual(st, [{ name: 'A', count: 0, total: 1 }, { name: 'B', count: 1, total: 2 }]);
});

test('cảnh báo trùng hạn', () => {
  const dl = new Date(2026, 9, 25, 23, 59);
  const tasks = [
    { id: '1', title: 'Nộp báo cáo', deadline: Core.toISO(dl), status: 'todo' },
    { id: '2', title: 'Việc xong', deadline: Core.toISO(dl), status: 'done' },
    { id: '3', title: 'Việc đã xóa', deadline: Core.toISO(dl), status: 'todo', deleted: true },
    { id: '4', title: 'Khác giờ', deadline: Core.toISO(new Date(2026, 9, 25, 23, 58)), status: 'todo' }
  ];
  const d = Core.findDuplicates(tasks, new Date(2026, 9, 25, 23, 59, 30));
  assert.deepStrictEqual(d.map((t) => t.id), ['1']);
  assert.strictEqual(Core.findDuplicates(tasks, dl, '1').length, 0);
  assert.strictEqual(Core.findDuplicates(tasks, null).length, 0);
  assert.strictEqual(Core.dupText(d, 'abc'), 'Có công việc trùng hạn: «Nộp báo cáo»');
  assert.match(Core.dupText(d, 'nop bao cao'), /cùng tên, cùng hạn/);
  assert.strictEqual(Core.dupText([], 'x'), '');
});
