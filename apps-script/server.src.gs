/**
 * Deadline Tracker - backend chạy trên Google Apps Script.
 *
 * - Lưu dữ liệu trong Google Sheet (tab "Tasks").
 * - Mỗi việc là một sự kiện trong lịch riêng "Deadlines", kèm tối đa 5 lời nhắc.
 * - Phục vụ trang web cho điện thoại (doGet) và API cho app laptop (doPost).
 *
 * Cách cài: xem HUONG-DAN.md. Chạy hàm setup() một lần, sau đó Deploy > Web app.
 *
 * FILE NÀY ĐƯỢC SINH RA bởi apps-script/build.js từ server.src.gs + mobile.src.html + src/core.js.
 * Đừng sửa Code.gs trực tiếp; sửa các file nguồn rồi chạy: npm run build:gas
 */

var VERSION = '1.1.0';
var TZ_OFFSET_MIN = 7 * 60; // Asia/Ho_Chi_Minh
var CAL_NAME = 'Deadlines';
var SHEET_NAME = 'Tasks';
var CONFIG_SHEET = 'Config';
var COLS = ['id', 'title', 'details', 'notes', 'group', 'priority', 'status', 'deadline',
  'reminders', 'checklist', 'eventId', 'createdAt', 'updatedAt', 'armedAt', 'deleted', 'doneAt'];
var KEEP_TOMBSTONE_MS = 30 * 86400000;
var MAX_TASKS_PER_SYNC = 200;

var __MOBILE_HTML__ = /*__MOBILE_HTML__*/'';

// ------------------------------------------------------------------ cài đặt
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy mở Apps Script từ trong Google Sheet (menu Tiện ích mở rộng > Apps Script).');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('KEY')) props.setProperty('KEY', newKey_());
  var sheets = ensureSheets_(ss, true);
  var cal = getCalendar_();
  var cfg = sheets.config;
  cfg.getRange(1, 1, 8, 2).setNumberFormat('@');
  cfg.getRange(1, 1, 8, 2).setValues([
    ['Deadline Tracker', 'v' + VERSION],
    ['', ''],
    ['Khóa bảo mật', props.getProperty('KEY')],
    ['Lịch Google', cal.getName()],
    ['', ''],
    ['Cách dùng', 'Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), chép "Web app URL".'],
    ['', 'Dán URL + khóa bảo mật ở trên vào app laptop. Trên điện thoại mở URL rồi nhập khóa.'],
    ['', 'Đừng chia sẻ khóa bảo mật. Muốn đổi khóa: chạy hàm rotateKey().']
  ]);
  cfg.setColumnWidth(1, 160);
  cfg.setColumnWidth(2, 520);
  Logger.log('Xong. Khóa bảo mật: ' + props.getProperty('KEY'));
  return props.getProperty('KEY');
}

function rotateKey() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('KEY', newKey_());
  setup();
}

function newKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 32);
}

function checkKey_(key) {
  var real = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!real || typeof key !== 'string' || key.length !== real.length) return false;
  var diff = 0;
  for (var i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

// --------------------------------------------------------------- điểm vào web
function doGet(e) {
  var p = (e && e.parameter) || {};
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (x) { base = ''; }
  if (!p.key || !checkKey_(p.key)) return loginPage_(base, !!p.key);
  var boot = JSON.stringify({ key: p.key, base: base, version: VERSION });
  var html = __MOBILE_HTML__.replace('/*BOOT*/null', function () { return boot; });
  return HtmlService.createHtmlOutput(html)
    .setTitle('Deadline')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = dispatch_(req);
  } catch (err) {
    out = { ok: false, error: 'Yêu cầu không hợp lệ' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// gọi từ trang web điện thoại qua google.script.run
function api(json) {
  var req;
  try { req = JSON.parse(json); } catch (e) { return JSON.stringify({ ok: false, error: 'Yêu cầu không hợp lệ' }); }
  return JSON.stringify(dispatch_(req));
}

function loginPage_(base, wrong) {
  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f5fa;color:#1f2937}' +
    '.c{background:#fff;border-radius:16px;padding:28px;width:min(92vw,360px);box-shadow:0 4px 24px rgba(0,0,0,.08)}' +
    'h1{font-size:20px;margin:0 0 6px}p{color:#6b7280;font-size:14px;margin:0 0 16px}' +
    'input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #d1d5db;border-radius:10px}' +
    'button{width:100%;margin-top:12px;padding:12px;font-size:16px;border:0;border-radius:10px;background:#4f46e5;color:#fff}' +
    '.e{color:#dc2626;font-size:13px;margin:8px 0 0}</style></head><body><div class="c">' +
    '<h1>Deadline</h1><p>Nhập khóa bảo mật (xem trong tab Config của Google Sheet).</p>' +
    '<input id="k" placeholder="Khóa bảo mật" autocomplete="off" autocapitalize="off">' +
    (wrong ? '<div class="e">Khóa không đúng.</div>' : '') +
    '<button id="b">Mở</button></div><script>' +
    'var BASE=' + JSON.stringify(base) + ';' +
    'function go(){var v=document.getElementById("k").value.trim();if(!v)return;' +
    'var u=(BASE||location.href.split("?")[0])+"?key="+encodeURIComponent(v);' +
    'try{window.top.location.href=u}catch(e){window.open(u,"_top")}}' +
    'document.getElementById("b").onclick=go;' +
    'document.getElementById("k").onkeydown=function(e){if(e.key==="Enter")go()};' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Deadline')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ------------------------------------------------------------------ xử lý API
function dispatch_(req) {
  try {
    if (!req || !checkKey_(req.key)) return { ok: false, error: 'Sai khóa bảo mật', code: 'auth' };
    if (req.action === 'ping') return { ok: true, serverTime: Date.now(), version: VERSION };
    if (req.action === 'sync') return sync_(req);
    return { ok: false, error: 'Hành động không hợp lệ' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function sync_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
    var sheet = ensureSheets_(ss).tasks;
    var store = loadRows_(sheet);
    var now = Date.now();
    var incoming = Array.isArray(req.tasks) ? req.tasks.slice(0, MAX_TASKS_PER_SYNC) : [];
    var cal = null;
    var calError = '';
    var rejected = 0;
    var nextRow = Math.max(sheet.getLastRow(), 1) + 1;

    incoming.forEach(function (raw) {
      var t = clean_(raw, now);
      if (!t) { rejected++; return; }
      var ex = store.byId[t.id];
      if (ex && Number(ex.updatedAt) >= t.updatedAt) return; // bản trên server mới hơn hoặc bằng
      t.eventId = ex ? ex.eventId : '';
      try {
        if (!cal) cal = getCalendar_();
        t.eventId = syncEvent_(cal, t, now);
      } catch (err) {
        calError = String((err && err.message) || err);
      }
      var row = ex ? ex._row : nextRow++;
      var range = sheet.getRange(row, 1, 1, COLS.length);
      range.setNumberFormat('@');
      range.setValues([toRow_(t)]);
      t._row = row;
      store.byId[t.id] = t;
    });

    purgeTombstones_(sheet, now);

    var all = loadRows_(sheet).list.map(function (t) { delete t._row; return t; });
    var res = { ok: true, tasks: all, serverTime: now, rejected: rejected };
    if (calError) res.calendarError = calError;
    return res;
  } finally {
    lock.releaseLock();
  }
}

function purgeTombstones_(sheet, now) {
  var store = loadRows_(sheet);
  var rows = [];
  store.list.forEach(function (t) {
    if (t.deleted && now - Number(t.updatedAt) > KEEP_TOMBSTONE_MS) rows.push(t._row);
  });
  rows.sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sheet.deleteRow(r); });
}

// ---------------------------------------------------------------- dữ liệu Sheet
function ensureSheets_(ss, formatAll) {
  var tasks = ss.getSheetByName(SHEET_NAME);
  if (!tasks) {
    tasks = ss.insertSheet(SHEET_NAME);
    tasks.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    tasks.setFrozenRows(1);
  }
  if (formatAll) tasks.getRange(1, 1, tasks.getMaxRows(), COLS.length).setNumberFormat('@');
  var config = ss.getSheetByName(CONFIG_SHEET);
  if (!config) config = ss.insertSheet(CONFIG_SHEET);
  return { tasks: tasks, config: config };
}

function loadRows_(sheet) {
  var list = [];
  var byId = {};
  var last = sheet.getLastRow();
  if (last < 2) return { list: list, byId: byId };
  var values = sheet.getRange(2, 1, last - 1, COLS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var t = fromRow_(values[i]);
    if (!t.id) continue;
    t._row = i + 2;
    list.push(t);
    byId[t.id] = t;
  }
  return { list: list, byId: byId };
}

// Ưu tiên theo thang 5 số: 1 = cao nhất ... 5 = thấp nhất, mặc định 3.
// Dữ liệu cũ (và app/điện thoại bản cũ) dùng chữ high / normal / low.
var LEGACY_PRIORITY_ = { high: 1, normal: 3, low: 5 };

function normPriority_(p) {
  if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PRIORITY_, p)) return LEGACY_PRIORITY_[p];
  var n = Math.round(Number(p));
  return n >= 1 && n <= 5 ? n : 3;
}

function fromRow_(v) {
  var o = {};
  for (var i = 0; i < COLS.length; i++) o[COLS[i]] = v[i] === undefined || v[i] === null ? '' : v[i];
  var t = {
    id: String(o.id),
    title: String(o.title),
    details: String(o.details),
    notes: String(o.notes),
    group: String(o.group),
    priority: normPriority_(o.priority),
    status: String(o.status) || 'todo',
    deadline: String(o.deadline),
    reminders: parseJson_(o.reminders, []),
    checklist: parseJson_(o.checklist, []),
    eventId: String(o.eventId),
    createdAt: Number(o.createdAt) || 0,
    updatedAt: Number(o.updatedAt) || 0,
    armedAt: Number(o.armedAt) || 0,
    deleted: String(o.deleted) === 'true' || o.deleted === true,
    doneAt: Number(o.doneAt) || 0
  };
  return t;
}

function toRow_(t) {
  return [
    t.id, t.title, t.details, t.notes, t.group, String(t.priority), t.status, t.deadline,
    JSON.stringify(t.reminders || []), JSON.stringify(t.checklist || []), t.eventId || '',
    String(t.createdAt), String(t.updatedAt), String(t.armedAt), t.deleted ? 'true' : 'false', String(t.doneAt || 0)
  ];
}

function parseJson_(v, dflt) {
  if (Array.isArray(v)) return v;
  try {
    var x = JSON.parse(String(v));
    return Array.isArray(x) ? x : dflt;
  } catch (e) { return dflt; }
}

function str_(v, max) {
  return String(v === undefined || v === null ? '' : v).slice(0, max);
}

// Làm sạch dữ liệu nhận từ client; trả về null nếu không dùng được
function clean_(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  var id = str_(raw.id, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  var deleted = raw.deleted === true || raw.deleted === 'true';
  var title = str_(raw.title, 200).trim();
  var deadline = str_(raw.deadline, 40);
  var dlMs = Date.parse(deadline);
  if (!deleted) {
    if (!title) return null;
    if (isNaN(dlMs)) return null;
  } else {
    if (!title) title = '(đã xóa)';
    if (isNaN(dlMs)) deadline = new Date(now).toISOString();
  }
  var priority = normPriority_(raw.priority);
  var status = ['todo', 'doing', 'done'].indexOf(raw.status) >= 0 ? raw.status : 'todo';
  var reminders = [];
  var seen = {};
  (Array.isArray(raw.reminders) ? raw.reminders : []).forEach(function (x) {
    var n = Math.round(Number(x));
    if (isFinite(n) && n >= 0 && n <= 525600 && !seen[n] && reminders.length < 12) { seen[n] = true; reminders.push(n); }
  });
  reminders.sort(function (a, b) { return b - a; });
  var checklist = [];
  (Array.isArray(raw.checklist) ? raw.checklist : []).slice(0, 50).forEach(function (c) {
    if (c && typeof c === 'object' && str_(c.t, 200).trim()) checklist.push({ t: str_(c.t, 200), d: c.d === true });
  });
  var upd = Number(raw.updatedAt);
  return {
    id: id,
    title: title,
    details: str_(raw.details, 4000),
    notes: str_(raw.notes, 4000),
    group: str_(raw.group, 60).trim(),
    priority: priority,
    status: status,
    deadline: deadline,
    reminders: reminders,
    checklist: checklist,
    eventId: '',
    createdAt: Number(raw.createdAt) || now,
    updatedAt: isFinite(upd) && upd > 0 ? upd : now,
    armedAt: Number(raw.armedAt) || now,
    deleted: deleted,
    doneAt: Number(raw.doneAt) || 0
  };
}

// ----------------------------------------------------------------- Google Calendar
function getCalendar_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CAL_ID');
  var cal = null;
  if (id) {
    try { cal = CalendarApp.getCalendarById(id); } catch (e) { cal = null; }
  }
  if (!cal) {
    var found = CalendarApp.getCalendarsByName(CAL_NAME);
    if (found && found.length) cal = found[0];
    else {
      cal = CalendarApp.createCalendar(CAL_NAME);
      try { cal.setTimeZone('Asia/Ho_Chi_Minh'); } catch (e1) { /* bỏ qua */ }
    }
    props.setProperty('CAL_ID', cal.getId());
  }
  try { cal.setSelected(true); cal.setHidden(false); } catch (e2) { /* bỏ qua */ }
  return cal;
}

// 5 lời nhắc gần hạn nhất còn ở tương lai; Calendar chỉ cho tối đa 5, sớm nhất 4 tuần
function reminderMinutes_(t, now) {
  var dl = Date.parse(t.deadline);
  var offs = (t.reminders || []).filter(function (o) {
    return o >= 0 && o <= 40320 && dl - o * 60000 > now - 60000;
  });
  offs.sort(function (a, b) { return a - b; });
  return offs.slice(0, 5);
}

function eventTitle_(t) {
  return (t.status === 'done' ? '✅ ' : '') + (t.group ? '[' + t.group + '] ' : '') + t.title;
}

var PRIORITY_VI_ = { 1: 'Rất cao', 2: 'Cao', 3: 'Trung bình', 4: 'Thấp', 5: 'Rất thấp' };

function eventDesc_(t) {
  var lines = [];
  if (t.details) lines.push(t.details);
  if (t.notes) lines.push('Ghi chú: ' + t.notes);
  if (t.checklist && t.checklist.length) {
    lines.push('');
    t.checklist.forEach(function (c) { lines.push((c.d ? '☑ ' : '☐ ') + c.t); });
  }
  lines.push('');
  lines.push('Ưu tiên: ' + t.priority + ' (' + (PRIORITY_VI_[t.priority] || 'Trung bình') + ')' + (t.group ? ' · Nhóm: ' + t.group : ''));
  lines.push('— Quản lý bằng Deadline Tracker. Hãy sửa trong app; sửa trực tiếp ở Calendar sẽ không được đồng bộ ngược.');
  return lines.join('\n');
}

// Calendar có 11 màu cố định ("1".."11"); chọn theo nhóm
var GROUP_EVENT_COLORS_ = ['9', '10', '11', '6', '3', '7', '5', '4', '2', '1'];

function colorFor_(group) {
  if (!group) return '8';
  var h = 0;
  for (var i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0;
  return GROUP_EVENT_COLORS_[h % GROUP_EVENT_COLORS_.length];
}

// Sự kiện bắt đầu đúng giờ hạn, dài tối đa 15 phút và không vắt qua nửa đêm
function eventTimes_(deadlineMs) {
  var off = TZ_OFFSET_MIN * 60000;
  var nextMidnight = (Math.floor((deadlineMs + off) / 86400000) + 1) * 86400000 - off;
  var end = Math.min(deadlineMs + 15 * 60000, nextMidnight);
  return { start: new Date(deadlineMs), end: new Date(end) };
}

function syncEvent_(cal, t, now) {
  var ev = null;
  if (t.eventId) {
    try { ev = cal.getEventById(t.eventId); } catch (e) { ev = null; }
  }
  if (t.deleted) {
    if (ev) { try { ev.deleteEvent(); } catch (e2) { /* đã xóa */ } }
    return '';
  }
  var times = eventTimes_(Date.parse(t.deadline));
  var title = eventTitle_(t);
  var desc = eventDesc_(t);
  if (ev) {
    try {
      ev.setTitle(title);
      ev.setTime(times.start, times.end);
      ev.setDescription(desc);
    } catch (e3) { ev = null; }
  }
  if (!ev) ev = cal.createEvent(title, times.start, times.end, { description: desc });
  ev.setColor(t.status === 'done' ? '8' : colorFor_(t.group));
  ev.removeAllReminders();
  if (t.status !== 'done') {
    reminderMinutes_(t, now).forEach(function (m) { ev.addPopupReminder(m); });
  }
  return ev.getId();
}
