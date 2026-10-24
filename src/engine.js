'use strict';
/*
 * engine.js - bộ não của app laptop (không phụ thuộc Electron, để kiểm thử được).
 * Giữ dữ liệu cục bộ, đồng bộ với Apps Script, và quyết định khi nào cần nhắc.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const Core = require('./core.js');

const SYNC_INTERVAL_MS = 3 * 60 * 1000;
const TICK_MS = 20 * 1000;
const SYNC_TIMEOUT_MS = 120 * 1000;
const SYNC_BATCH = 25;
const TRASH_MS = 60 * 1000;

function defaultData() {
  return {
    version: 1,
    tasks: {},
    config: { url: '', key: '' },
    settings: { digest: true, digestHour: 8, reminderStyle: 'card', autostart: true },
    fired: {},
    snoozes: {},
    digestDate: '',
    extraGroups: [],
    baselined: false,
    lastSync: 0
  };
}

// Chấp nhận link đầy đủ (…/exec?key=…) hoặc URL + khóa nhập riêng.
// Chỉ cho phép script.google.com để khóa bảo mật không bị gửi tới nơi khác.
function parseLink(input, keyInput) {
  const raw = String(input || '').trim();
  if (!raw) return { error: 'Hãy dán link Web app của Apps Script.' };
  let u;
  try { u = new URL(raw); } catch (e) { return { error: 'Link không hợp lệ.' }; }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com') {
    return { error: 'Link phải bắt đầu bằng https://script.google.com/…' };
  }
  if (!/\/macros\/(?:.*\/)?s\/[^/]+\/exec$/.test(u.pathname)) {
    return { error: 'Hãy dùng link kết thúc bằng /exec (lấy ở bước Deploy > Web app).' };
  }
  const key = String(keyInput || u.searchParams.get('key') || '').trim();
  if (!key) return { error: 'Thiếu khóa bảo mật (xem trong tab Config của Google Sheet).' };
  return { url: u.origin + u.pathname, key };
}

class Engine extends EventEmitter {
  constructor(opts) {
    super();
    this.file = opts.file;
    this.now = opts.now || (() => Date.now());
    this.fetch = opts.fetch || ((...a) => fetch(...a));
    this.data = defaultData();
    this.sync = { status: 'unlinked', error: '', lastSync: 0, syncing: false };
    this._saveTimer = null;
    this._syncTimer = null;
    this._syncSoon = null;
    this._timers = [];
    this._syncing = null;
    this._again = false;
    this._trash = {};
  }

  // ------------------------------------------------------------ lưu trữ
  load() {
    let raw = null;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { raw = null; }
    if (raw) {
      try {
        const d = JSON.parse(raw);
        this.data = Object.assign(defaultData(), d);
        this.data.settings = Object.assign(defaultData().settings, d.settings || {});
        this.data.config = Object.assign({ url: '', key: '' }, d.config || {});
      } catch (e) {
        try { fs.renameSync(this.file, this.file + '.hong-' + this.now()); } catch (e2) { /* bỏ qua */ }
        this.data = defaultData();
      }
    }
    Object.keys(this.data.tasks).forEach((id) => { this.data.tasks[id].priority = Core.normPriority(this.data.tasks[id].priority); });
    this.sync.lastSync = this.data.lastSync || 0;
    this.sync.status = this.linked() ? 'idle' : 'unlinked';
    return this;
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush(); }, 250);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.emit('error', e);
    }
  }

  linked() { return !!(this.data.config.url && this.data.config.key); }

  // ----------------------------------------------------------- trạng thái
  state() {
    const tasks = Object.keys(this.data.tasks).map((k) => this.data.tasks[k]).filter((t) => !t.deleted);
    const dirty = tasks.filter((t) => t._dirty).length +
      Object.keys(this.data.tasks).filter((k) => this.data.tasks[k].deleted && this.data.tasks[k]._dirty).length;
    const groupStats = Core.groupStats(tasks, this.data.extraGroups);
    return {
      tasks,
      groups: groupStats.map((g) => g.name),
      groupStats,
      sync: Object.assign({}, this.sync, { pending: dirty, linked: this.linked() }),
      settings: Object.assign({}, this.data.settings),
      linkHost: this.linked() ? 'script.google.com' : ''
    };
  }

  changed() {
    this.save();
    this.emit('change', this.state());
  }

  _touch(t, rearm) {
    const now = this.now();
    t.updatedAt = Math.max(now, (Number(t.updatedAt) || 0) + 1);
    if (rearm) {
      t.armedAt = now;
      this.data.fired[t.id] = [];
    }
    t._dirty = true;
    this.data.tasks[t.id] = t;
    this.changed();
    this.requestSync();
    return t;
  }

  // ------------------------------------------------------------- thao tác việc
  addTask(fields) {
    const dl = fields.deadline instanceof Date ? Core.toISO(fields.deadline) : fields.deadline;
    if (!String(fields.title || '').trim()) throw new Error('Thiếu tên việc');
    if (!dl || isNaN(new Date(dl).getTime())) throw new Error('Thiếu hạn chót');
    const t = Core.newTask(Object.assign({}, fields, { deadline: dl }), this.now());
    if (t.status === 'done') t.doneAt = this.now();
    this.data.fired[t.id] = [];
    return this._touch(t, false);
  }

  updateTask(id, patch) {
    const t = this.data.tasks[id];
    if (!t || t.deleted) throw new Error('Không tìm thấy việc');
    const next = Object.assign({}, t);
    ['title', 'details', 'notes', 'group', 'priority', 'status', 'deadline', 'checklist'].forEach((k) => {
      if (patch[k] !== undefined) next[k] = patch[k];
    });
    if (patch.deadline instanceof Date) next.deadline = Core.toISO(patch.deadline);
    if (patch.reminders !== undefined) next.reminders = Core.normOffsets(patch.reminders);
    next.priority = Core.normPriority(next.priority);
    next.title = String(next.title || '').trim();
    if (!next.title) throw new Error('Thiếu tên việc');
    if (isNaN(new Date(next.deadline).getTime())) throw new Error('Hạn chót không hợp lệ');
    const rearm = next.deadline !== t.deadline ||
      JSON.stringify(Core.normOffsets(next.reminders)) !== JSON.stringify(Core.normOffsets(t.reminders));
    if (t.status !== 'done' && next.status === 'done') next.doneAt = this.now();
    if (t.status === 'done' && next.status !== 'done') next.doneAt = 0;
    if (next.status === 'done') delete this.data.snoozes[id];
    return this._touch(next, rearm);
  }

  toggleDone(id) {
    const t = this.data.tasks[id];
    if (!t || t.deleted) return null;
    return this.updateTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
  }

  deleteTask(id) {
    const t = this.data.tasks[id];
    if (!t || t.deleted) return null;
    delete this.data.snoozes[id];
    // đồng bộ xong sẽ gỡ hẳn việc đã xóa khỏi máy, nên giữ một bản để còn Hoàn tác được
    const nowMs = this.now();
    Object.keys(this._trash).forEach((k) => { if (nowMs - this._trash[k].at > TRASH_MS) delete this._trash[k]; });
    this._trash[id] = { task: Object.assign({}, t), at: nowMs };
    return this._touch(Object.assign({}, t, { deleted: true }), false);
  }

  restoreTask(id) {
    let t = this.data.tasks[id];
    if (!t) {
      const kept = this._trash[id];
      if (!kept || this.now() - kept.at > TRASH_MS) return null;
      t = kept.task;
    } else if (!t.deleted) return null;
    delete this._trash[id];
    return this._touch(Object.assign({}, t, { deleted: false }), true);
  }

  markDone(id) {
    const t = this.data.tasks[id];
    if (!t || t.deleted || t.status === 'done') return t || null;
    return this.updateTask(id, { status: 'done' });
  }

  snooze(id, minutes) {
    const t = this.data.tasks[id];
    if (!t || t.deleted || t.status === 'done') return;
    this.data.snoozes[id] = this.now() + Math.max(1, minutes) * Core.MIN;
    this.changed();
  }

  // ------------------------------------------------------------- quản lý nhóm
  // Nhóm là một trường của từng việc nên đổi tên/xóa nhóm = sửa các việc đó (và tự đồng bộ).
  // Nhóm tạo sẵn nhưng chưa có việc chỉ lưu trên máy này (extraGroups).
  _cleanGroup(name) {
    const n = String(name || '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 60).trim();
    if (!n) throw new Error('Tên nhóm đang trống');
    return n;
  }

  _allGroups() {
    return Core.groupStats(Object.keys(this.data.tasks).map((k) => this.data.tasks[k]), this.data.extraGroups).map((g) => g.name);
  }

  _inGroup(name) {
    return Object.keys(this.data.tasks).map((k) => this.data.tasks[k]).filter((t) => !t.deleted && t.group === name);
  }

  addGroup(name) {
    const n = this._cleanGroup(name);
    if (this._allGroups().some((g) => Core.fold(g) === Core.fold(n))) throw new Error('Nhóm "' + n + '" đã có');
    this.data.extraGroups.push(n);
    this.changed();
    return { name: n };
  }

  // Đổi sang tên một nhóm khác đã có (không phân biệt hoa thường/dấu) = gộp hai nhóm
  renameGroup(from, to) {
    const n = this._cleanGroup(to);
    const same = this._allGroups().find((g) => g !== from && Core.fold(g) === Core.fold(n));
    const target = same || n;
    if (target === from) return { name: from, changed: 0, merged: false };
    const list = this._inGroup(from);
    list.forEach((t) => this._touch(Object.assign({}, t, { group: target }), false));
    this.data.extraGroups = this.data.extraGroups.filter((g) => g !== from && g !== target);
    if (!list.length) this.data.extraGroups.push(target);
    this.changed();
    return { name: target, changed: list.length, merged: !!same };
  }

  // Xóa nhóm: các việc trong nhóm vẫn còn, chỉ bỏ nhóm. Trả về id để hoàn tác bằng assignGroup.
  deleteGroup(name) {
    const list = this._inGroup(name);
    list.forEach((t) => this._touch(Object.assign({}, t, { group: '' }), false));
    this.data.extraGroups = this.data.extraGroups.filter((g) => g !== name);
    this.changed();
    return { ids: list.map((t) => t.id), name };
  }

  assignGroup(ids, name) {
    let n = 0;
    (ids || []).forEach((id) => {
      const t = this.data.tasks[id];
      if (t && !t.deleted) { this._touch(Object.assign({}, t, { group: name }), false); n++; }
    });
    this.changed();
    return { changed: n };
  }

  // Nhập nhanh một dòng. Thiếu tên hoặc thiếu hạn thì trả về bản nháp để mở form.
  quickAdd(text) {
    const groups = Core.groupsOf(Object.keys(this.data.tasks).map((k) => this.data.tasks[k]).filter((t) => !t.deleted));
    const r = Core.parseQuick(text, new Date(this.now()), { groups });
    if (!r.title || !r.deadline) {
      return {
        needsForm: true,
        draft: {
          title: r.title, group: r.group, priority: r.priority,
          deadline: r.deadline ? Core.toISO(r.deadline) : '', reminders: r.reminders
        }
      };
    }
    const task = this.addTask({
      title: r.title, group: r.group, priority: r.priority, deadline: r.deadline, reminders: r.reminders
    });
    return { task };
  }

  parsePreview(text) {
    const groups = Core.groupsOf(Object.keys(this.data.tasks).map((k) => this.data.tasks[k]).filter((t) => !t.deleted));
    const r = Core.parseQuick(text, new Date(this.now()), { groups });
    return {
      title: r.title, group: r.group, priority: r.priority,
      deadline: r.deadline ? Core.toISO(r.deadline) : '', hasDate: r.hasDate, hasTime: r.hasTime
    };
  }

  setSettings(patch) {
    Object.keys(patch || {}).forEach((k) => {
      if (k in this.data.settings) this.data.settings[k] = patch[k];
    });
    this.changed();
  }

  // ----------------------------------------------------------- nhắc nhở
  tick() {
    const nowMs = this.now();
    const items = [];
    let dirty = false;
    const ids = Object.keys(this.data.tasks);
    ids.forEach((id) => {
      const t = this.data.tasks[id];
      if (t.deleted || t.status === 'done') return;
      const fired = this.data.fired[id] || [];
      const r = Core.dueNow(t, nowMs, fired);
      if (r.markFired.length) {
        this.data.fired[id] = fired.concat(r.markFired);
        dirty = true;
      }
      if (r.fire) items.push({ task: t, info: { offset: r.fire.offset, late: r.fire.late, snooze: false } });
    });
    Object.keys(this.data.snoozes).forEach((id) => {
      const t = this.data.tasks[id];
      if (!t || t.deleted || t.status === 'done') { delete this.data.snoozes[id]; dirty = true; return; }
      if (this.data.snoozes[id] <= nowMs) {
        delete this.data.snoozes[id];
        dirty = true;
        const existing = items.find((x) => x.task.id === id);
        if (existing) existing.info.snooze = false;
        else items.push({ task: t, info: { offset: null, late: false, snooze: true } });
      }
    });
    // dọn dữ liệu của việc đã biến mất
    Object.keys(this.data.fired).forEach((id) => {
      if (!this.data.tasks[id] || this.data.tasks[id].deleted) { delete this.data.fired[id]; dirty = true; }
    });
    if (dirty) this.save();

    if (items.length) {
      const now = new Date(nowMs);
      const out = items.map((x) => {
        const d = Core.describeReminder(x.task, x.info, now);
        return {
          id: x.task.id, title: d.title, body: d.body, rel: d.rel,
          taskTitle: x.task.title, group: x.task.group, deadline: x.task.deadline,
          offset: x.info.offset, late: x.info.late, snooze: x.info.snooze
        };
      });
      out.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
      this.emit('reminders', out);
    }
    this._checkDigest(nowMs);
    return items.length;
  }

  _checkDigest(nowMs) {
    const s = this.data.settings;
    if (!s.digest) return;
    const d = new Date(nowMs);
    const key = Core.dayKey(d);
    if (this.data.digestDate === key || d.getHours() < s.digestHour) return;
    this.data.digestDate = key;
    this.save();
    if (d.getHours() >= 12) return; // mở máy muộn thì bỏ qua bản tóm tắt buổi sáng
    const buckets = { overdue: [], today: [], week: [] };
    Object.keys(this.data.tasks).forEach((id) => {
      const t = this.data.tasks[id];
      if (t.deleted) return;
      const b = Core.bucketOf(t, d);
      if (buckets[b]) buckets[b].push(t);
    });
    const parts = [];
    if (buckets.overdue.length) parts.push('Quá hạn: ' + buckets.overdue.length);
    parts.push('Hôm nay: ' + buckets.today.length);
    parts.push('Tuần này: ' + buckets.week.length);
    if (!buckets.overdue.length && !buckets.today.length && !buckets.week.length) return;
    const names = Core.sortTasks(buckets.overdue.concat(buckets.today), 'open').slice(0, 3).map((t) => '• ' + t.title);
    this.emit('digest', {
      title: 'Tóm tắt hôm nay',
      body: parts.join(' · ') + (names.length ? '\n' + names.join('\n') : ''),
      counts: { overdue: buckets.overdue.length, today: buckets.today.length, week: buckets.week.length }
    });
  }

  // ------------------------------------------------------------ đồng bộ
  requestSync() {
    if (!this.linked() || this._syncSoon) return;
    this._syncSoon = setTimeout(() => { this._syncSoon = null; this.syncNow(); }, 2000);
    if (this._syncSoon.unref) this._syncSoon.unref();
  }

  async testConnection(url, key) {
    const res = await this._post(url, { action: 'ping', key });
    return res;
  }

  async _post(url, body) {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(SYNC_TIMEOUT_MS) : undefined
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      throw new Error('Máy chủ trả về dữ liệu lạ (mã ' + res.status + '). Kiểm tra link /exec và quyền truy cập "Anyone" khi Deploy.');
    }
    return json;
  }

  async connect(link, keyInput) {
    const p = parseLink(link, keyInput);
    if (p.error) return { ok: false, error: p.error };
    try {
      const r = await this.testConnection(p.url, p.key);
      if (!r.ok) return { ok: false, error: r.code === 'auth' ? 'Khóa bảo mật không đúng.' : (r.error || 'Kết nối thất bại') };
    } catch (e) {
      return { ok: false, error: this._explain(e) };
    }
    this.data.config = { url: p.url, key: p.key };
    this.data.baselined = false;
    this.sync.status = 'idle';
    this.changed();
    this.flush();
    const s = await this.syncNow();
    return s.ok ? { ok: true } : { ok: false, error: s.error };
  }

  disconnect() {
    this.data.config = { url: '', key: '' };
    this.sync = { status: 'unlinked', error: '', lastSync: 0, syncing: false };
    this.changed();
    this.flush();
  }

  _explain(e) {
    const m = String((e && e.message) || e);
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'Quá thời gian chờ. Thử lại sau.';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|EAI_AGAIN/i.test(m) || e instanceof TypeError) {
      return 'Không có mạng hoặc không truy cập được Google.';
    }
    return m;
  }

  syncNow() {
    if (!this.linked()) {
      this.sync.status = 'unlinked';
      this.emit('change', this.state());
      return Promise.resolve({ ok: false, error: 'Chưa kết nối' });
    }
    if (this._syncing) { this._again = true; return this._syncing; }
    this._syncing = this._doSync().finally(() => {
      this._syncing = null;
      if (this._again) { this._again = false; this.syncNow(); }
    });
    return this._syncing;
  }

  async _doSync() {
    this.sync.syncing = true;
    this.sync.status = 'syncing';
    this.emit('change', this.state());
    let calendarError = '';
    try {
      for (let round = 0; round < 12; round++) {
        const sent = {};
        const dirty = [];
        Object.keys(this.data.tasks).forEach((id) => {
          const t = this.data.tasks[id];
          if (t._dirty && dirty.length < SYNC_BATCH) {
            const c = Object.assign({}, t);
            delete c._dirty;
            dirty.push(c);
            sent[id] = t.updatedAt;
          }
        });
        const r = await this._post(this.data.config.url, { action: 'sync', key: this.data.config.key, tasks: dirty });
        if (!r.ok) {
          const err = new Error(r.code === 'auth' ? 'Khóa bảo mật không còn đúng. Hãy kết nối lại.' : (r.error || 'Đồng bộ thất bại'));
          err.fatal = r.code === 'auth';
          throw err;
        }
        if (r.calendarError) calendarError = r.calendarError;
        this._applyServer(r.tasks || [], sent);
        // còn việc chưa kịp gửi vì vượt cỡ lô -> gửi tiếp; việc sửa trong lúc gửi để lượt đồng bộ sau
        const unsent = Object.keys(this.data.tasks).some((id) => this.data.tasks[id]._dirty && !(id in sent));
        if (!unsent) break;
      }
      this.sync = { status: 'ok', error: '', lastSync: this.now(), syncing: false };
      this.data.lastSync = this.sync.lastSync;
      this.changed();
      return { ok: true, calendarError };
    } catch (e) {
      const msg = this._explain(e);
      const offline = /Không có mạng|Quá thời gian/.test(msg);
      this.sync = { status: offline ? 'offline' : 'error', error: msg, lastSync: this.data.lastSync || 0, syncing: false };
      this.emit('change', this.state());
      return { ok: false, error: msg };
    }
  }

  _applyServer(serverList, sent) {
    const prev = this.data.tasks;
    const merged = Core.mergeServer(prev, serverList, sent);
    const first = !this.data.baselined;
    const nowMs = this.now();
    Object.keys(merged).forEach((id) => {
      const t = merged[id];
      t.priority = Core.normPriority(t.priority); // server cũ có thể trả về 'high' / 'normal' / 'low'
      if (t.deleted && !t._dirty) { delete merged[id]; delete this.data.fired[id]; return; }
      const p = prev[id];
      if (!p || p.armedAt !== t.armedAt) {
        // hạn/mốc nhắc đổi từ thiết bị khác -> nhắc lại từ đầu
        this.data.fired[id] = [];
        if (first && !p) {
          // lần đồng bộ đầu tiên trên máy mới: đừng báo lại cả đống mốc đã qua
          this.data.fired[id] = Core.reminderSchedule(t).filter((r) => r.at <= nowMs).map((r) => r.offset);
        }
      }
    });
    this.data.tasks = merged;
    this.data.baselined = true;
  }

  // ---------------------------------------------------------------- vòng lặp
  start() {
    this.stop();
    this._timers.push(setInterval(() => { try { this.tick(); } catch (e) { this.emit('error', e); } }, TICK_MS));
    this._timers.push(setInterval(() => { if (this.linked()) this.syncNow(); }, SYNC_INTERVAL_MS));
    this._timers.forEach((t) => t.unref && t.unref());
    try { this.tick(); } catch (e) { this.emit('error', e); }
    if (this.linked()) this.syncNow();
  }

  stop() {
    this._timers.forEach((t) => clearInterval(t));
    this._timers = [];
    if (this._syncSoon) { clearTimeout(this._syncSoon); this._syncSoon = null; }
    this.flush();
  }
}

module.exports = { Engine, parseLink, defaultData };
