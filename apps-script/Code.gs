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

var __MOBILE_HTML__ = "<!doctype html>\n<html lang=\"vi\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Deadline</title>\n<style>\n:root{\n  --bg:#f4f4f8;--card:#ffffff;--text:#1b1b27;--muted:#6b6f80;--line:#e4e5ee;\n  --accent:#4f46e5;--accent-soft:#e8e7fd;--danger:#dc2626;--ok:#16a34a;\n  --c-overdue:#dc2626;--c-critical:#ea580c;--c-soon:#d97706;--c-week:#2563eb;--c-later:#94a3b8;--c-done:#cbd5e1;\n}\n@media (prefers-color-scheme: dark){\n  :root{--bg:#0f1017;--card:#1a1b26;--text:#ececf4;--muted:#9a9db2;--line:#2b2d3d;--accent:#8b85ff;--accent-soft:#2a2850;--danger:#f87171;--ok:#4ade80;--c-done:#3b3e52}\n}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}\nbody{padding:env(safe-area-inset-top) 0 calc(96px + env(safe-area-inset-bottom))}\n.wrap{max-width:640px;margin:0 auto;padding:0 14px}\nheader{display:flex;align-items:center;gap:8px;padding:14px 0 8px}\nheader h1{font-size:22px;margin:0;font-weight:700;flex:1}\nselect,input,textarea,button{font:inherit;color:inherit}\n.iconbtn{width:42px;height:42px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:20px;display:flex;align-items:center;justify-content:center}\n.sync{font-size:12px;color:var(--muted);text-align:right;line-height:1.2}\n.sync.err{color:var(--danger)}\n.sync.ok::before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:5px}\n.quick{display:flex;gap:8px;margin-top:4px}\n.quick input{flex:1;min-width:0;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--card);font-size:16px}\n.quick input:focus{outline:none;border-color:var(--accent)}\n.quick button{width:50px;border:0;border-radius:14px;background:var(--accent);color:#fff;font-size:24px}\n.preview{min-height:22px;font-size:13px;color:var(--muted);padding:6px 4px 2px}\n.preview b{color:var(--text);font-weight:600}\n.preview .warn{color:var(--danger)}\n.tabs{display:flex;gap:8px;overflow-x:auto;padding:8px 0 10px;scrollbar-width:none}\n.tabs::-webkit-scrollbar{display:none}\n.tab{flex:none;border:1px solid var(--line);background:var(--card);padding:8px 13px;border-radius:999px;font-size:14px;white-space:nowrap}\n.tab.on{background:var(--accent);border-color:var(--accent);color:#fff}\n.tab .n{opacity:.7;margin-left:4px;font-size:12px}\n.card{display:flex;gap:12px;align-items:flex-start;background:var(--card);border-radius:14px;padding:12px 12px 12px 0;margin-bottom:10px;border:1px solid var(--line);position:relative;overflow:hidden}\n.bar{width:5px;align-self:stretch;border-radius:0 4px 4px 0;flex:none}\n.chk{flex:none;width:28px;height:28px;border-radius:50%;border:2px solid var(--line);background:transparent;margin-top:1px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;padding:0}\n.card.done .chk{background:var(--ok);border-color:var(--ok)}\n.body{flex:1;min-width:0}\n.title{font-weight:600;word-break:break-word}\n.card.done .title{text-decoration:line-through;color:var(--muted)}\n.meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:5px;font-size:13px;color:var(--muted);align-items:center}\n.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;color:#fff}\n.rel{font-weight:600}\n.empty{text-align:center;color:var(--muted);padding:44px 12px}\n.fab{position:fixed;right:max(18px,calc(50% - 302px));bottom:calc(20px + env(safe-area-inset-bottom));width:58px;height:58px;border-radius:50%;border:0;background:var(--accent);color:#fff;font-size:30px;box-shadow:0 6px 18px rgba(79,70,229,.45)}\n.sheet{position:fixed;inset:0;background:var(--bg);z-index:20;overflow-y:auto;padding:env(safe-area-inset-top) 0 calc(24px + env(safe-area-inset-bottom))}\n.sheet.hidden{display:none}\n.sheet .bar2{display:flex;align-items:center;justify-content:space-between;padding:14px 0 6px}\n.sheet h2{margin:0;font-size:18px}\n.btn{border:0;border-radius:12px;padding:12px 18px;background:var(--accent);color:#fff;font-weight:600}\n.btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}\n.btn.danger{background:transparent;color:var(--danger);border:1px solid var(--line)}\nlabel.f{display:block;margin:14px 0 6px;font-size:13px;color:var(--muted);font-weight:600}\nlabel.f .h{font-weight:400}\n.in{width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--line);background:var(--card)}\n.in:focus{outline:none;border-color:var(--accent)}\ntextarea.in{min-height:84px;resize:vertical}\n.seg{display:flex;gap:8px}\n.seg button{flex:1;padding:11px 6px;border-radius:12px;border:1.5px solid var(--line);background:var(--card)}\n.seg button.on{border-color:var(--accent);background:var(--accent-soft);font-weight:600}\n.chips{display:flex;flex-wrap:wrap;gap:8px}\n.rchip{padding:8px 12px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);font-size:14px}\n.rchip.on{border-color:var(--accent);background:var(--accent-soft);font-weight:600}\n.addrow{display:flex;gap:8px;margin-top:10px}\n.addrow input{width:80px;min-width:0}.addrow select{flex:1;min-width:0}\n.ck{display:flex;align-items:center;gap:10px;padding:6px 0}\n.ck input[type=checkbox]{width:22px;height:22px;flex:none}\n.ck input[type=text]{flex:1;padding:9px 10px;border-radius:10px;border:1.5px solid var(--line);background:var(--card)}\n.ck button{border:0;background:transparent;color:var(--muted);font-size:20px;width:34px;height:34px}\n.actions{display:flex;gap:10px;margin-top:22px}\n.actions .btn{flex:1}\n.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(92px + env(safe-area-inset-bottom));background:#25263a;color:#fff;padding:11px 16px;border-radius:12px;z-index:40;font-size:14px;display:flex;gap:14px;align-items:center;max-width:92vw}\n.toast.hidden{display:none}\n.toast button{border:0;background:transparent;color:#a5b4fc;font-weight:700;padding:0}\n</style>\n</head>\n<body>\n<div class=\"wrap\">\n  <header>\n    <h1>Deadline</h1>\n    <div class=\"sync\" id=\"sync\"></div>\n    <button class=\"iconbtn\" id=\"refresh\" aria-label=\"Đồng bộ\">&#8635;</button>\n  </header>\n  <div class=\"quick\">\n    <input id=\"q\" placeholder=\"Thêm nhanh: Nộp báo cáo #BTL1 !1 thứ 6 17h\" autocomplete=\"off\" enterkeyhint=\"done\">\n    <button id=\"qa\" aria-label=\"Thêm\">+</button>\n  </div>\n  <div class=\"preview\" id=\"preview\"></div>\n  <nav class=\"tabs\" id=\"tabs\"></nav>\n  <select id=\"gf\" class=\"in\" style=\"margin-bottom:12px;padding:9px 12px\"></select>\n  <main id=\"list\"></main>\n</div>\n<button class=\"fab\" id=\"fab\" aria-label=\"Thêm việc\">+</button>\n\n<div class=\"sheet hidden\" id=\"sheet\">\n  <div class=\"wrap\">\n    <div class=\"bar2\">\n      <button class=\"btn ghost\" id=\"fcancel\">Đóng</button>\n      <h2 id=\"ftitle\">Việc mới</h2>\n      <button class=\"btn\" id=\"fsave\">Lưu</button>\n    </div>\n    <label class=\"f\">Tên việc</label>\n    <input class=\"in\" id=\"fname\" maxlength=\"200\">\n    <label class=\"f\">Hạn chót</label>\n    <input class=\"in\" id=\"fdl\" type=\"datetime-local\">\n    <label class=\"f\">Nhóm / môn</label>\n    <input class=\"in\" id=\"fgroup\" list=\"glist\" maxlength=\"60\" placeholder=\"Ví dụ: BTL1\">\n    <datalist id=\"glist\"></datalist>\n    <label class=\"f\">Ưu tiên <span class=\"h\" id=\"fpriohint\"></span></label>\n    <div class=\"seg\" id=\"fprio\"></div>\n    <label class=\"f\">Trạng thái</label>\n    <div class=\"seg\" id=\"fstatus\"></div>\n    <label class=\"f\">Chi tiết công việc</label>\n    <textarea class=\"in\" id=\"fdetails\" maxlength=\"4000\"></textarea>\n    <label class=\"f\">Ghi chú</label>\n    <textarea class=\"in\" id=\"fnotes\" maxlength=\"4000\"></textarea>\n    <label class=\"f\">Việc con (checklist)</label>\n    <div id=\"fcheck\"></div>\n    <div class=\"addrow\"><input class=\"in\" id=\"fcheckadd\" placeholder=\"Thêm việc con...\" style=\"flex:1;width:auto\"><button class=\"btn ghost\" id=\"fcheckbtn\">Thêm</button></div>\n    <label class=\"f\">Nhắc trước hạn</label>\n    <div class=\"chips\" id=\"frem\"></div>\n    <div class=\"addrow\">\n      <input class=\"in\" id=\"fcn\" type=\"number\" min=\"1\" max=\"999\" placeholder=\"Số\">\n      <select class=\"in\" id=\"fcu\"><option value=\"1\">phút</option><option value=\"60\">giờ</option><option value=\"1440\" selected>ngày</option><option value=\"10080\">tuần</option></select>\n      <button class=\"btn ghost\" id=\"fcadd\">+ Thêm mốc</button>\n    </div>\n    <div class=\"actions\"><button class=\"btn danger\" id=\"fdel\">Xóa</button></div>\n  </div>\n</div>\n<div class=\"toast hidden\" id=\"toast\"><span id=\"tmsg\"></span><button id=\"tact\"></button></div>\n\n<script>/*\n * core.js - phần lõi dùng chung cho app laptop (Electron) và web app điện thoại.\n * Không phụ thuộc Node/Electron/trình duyệt: chỉ dùng JavaScript thuần.\n *\n * Gồm: phân tích câu nhập nhanh tiếng Việt, logic mốc nhắc, phân nhóm theo hạn,\n * định dạng hiển thị, và hàm gộp dữ liệu đồng bộ.\n */\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.Core = factory();\n})(typeof self !== 'undefined' ? self : this, function () {\n  'use strict';\n\n  var MIN = 60000;\n  var HOUR = 3600000;\n  var DAY = 86400000;\n\n  // ---------------------------------------------------------------- mốc nhắc\n  var DEFAULT_OFFSETS = [10080, 4320, 1440, 180, 0]; // 1 tuần, 3 ngày, 1 ngày, 3 giờ, đúng hạn\n  var PRESET_OFFSETS = [20160, 10080, 4320, 1440, 180, 60, 30, 0];\n\n  // Ưu tiên theo thang 5 số: 1 = cao nhất ... 5 = thấp nhất. Mặc định 3.\n  var DEFAULT_PRIORITY = 3;\n  var OFFSETS_BY_PRIORITY = {\n    1: [20160, 10080, 4320, 1440, 180, 60, 0],\n    2: [10080, 4320, 1440, 180, 60, 0],\n    3: DEFAULT_OFFSETS,\n    4: [1440, 180, 0],\n    5: [1440]\n  };\n  // dữ liệu cũ (và server cũ) dùng chữ: cao / trung bình / thấp\n  var LEGACY_PRIORITY = { high: 1, normal: 3, low: 5 };\n\n  function normPriority(p) {\n    if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PRIORITY, p)) return LEGACY_PRIORITY[p];\n    var n = Math.round(Number(p));\n    return n >= 1 && n <= 5 ? n : DEFAULT_PRIORITY;\n  }\n\n  function offsetsForPriority(p) {\n    return OFFSETS_BY_PRIORITY[normPriority(p)].slice();\n  }\n\n  // Các từ gõ sau dấu ! để chọn mức (ngoài số 1-5), dạng nguồn của regex\n  var PRIORITY_WORDS = { 1: 'cao|c|high|h|gap|khan', 3: 'tb|trung|trungbinh|vua|normal|n', 5: 'thap|t|low|l' };\n\n  function priorityFromWord(word) {\n    if (/^[1-5]$/.test(word)) return +word;\n    for (var lv in PRIORITY_WORDS) {\n      if (new RegExp('^(' + PRIORITY_WORDS[lv] + ')$').test(word)) return +lv;\n    }\n    return null;\n  }\n\n  // Thẻ \"!...\" đang gõ dở ở cuối ô nhập nhanh; null nếu không có\n  function bangTyping(text) {\n    var m = /(^|\\s)!([^\\s]*)$/.exec(String(text || ''));\n    return m ? { typed: m[2], start: m.index + m[1].length } : null;\n  }\n\n  // Thẻ \"#...\" đang gõ dở ở cuối ô nhập (cho phép nhiều từ: \"#toan roi\"); null nếu không có\n  function hashTyping(text) {\n    text = String(text || '');\n    var i = text.lastIndexOf('#');\n    if (i < 0 || (i > 0 && !/\\s/.test(text[i - 1]))) return null;\n    var typed = text.slice(i + 1);\n    if (/[\"\\[\\]()!#]/.test(typed)) return null; // đã sang dạng ngoặc / đã có thẻ khác: không gợi ý nữa\n    return { typed: typed, start: i };\n  }\n\n  // Danh sách mức ưu tiên kèm các mốc nhắc, để hiện gợi ý khi gõ \"!\".\n  // match = mức khớp với phần đã gõ (số hoặc từ như \"ca\" -> cao)\n  function priorityOptions(typed) {\n    typed = fold(String(typed || ''));\n    return [1, 2, 3, 4, 5].map(function (p) {\n      var offs = OFFSETS_BY_PRIORITY[p];\n      var words = PRIORITY_WORDS[p] ? PRIORITY_WORDS[p].split('|') : [];\n      var match = !!typed && (String(p).indexOf(typed) === 0 ||\n        words.some(function (w) { return w.length > 1 && w.indexOf(typed) === 0; }));\n      return {\n        level: p, label: PRIORITY_LABEL[p], offsets: offs.slice(), match: match,\n        word: words.length ? words[0] : '',\n        text: offs.map(fmtOffset).join(' · ')\n      };\n    });\n  }\n\n  function normOffsets(list) {\n    var seen = {};\n    var out = [];\n    (list || []).forEach(function (v) {\n      var n = Math.round(Number(v));\n      if (isFinite(n) && n >= 0 && n <= 525600 && !seen[n]) {\n        seen[n] = true;\n        out.push(n);\n      }\n    });\n    out.sort(function (a, b) { return b - a; });\n    return out.slice(0, 12);\n  }\n\n  function fmtOffset(m) {\n    m = Math.round(m);\n    if (m === 0) return 'Đúng hạn';\n    if (m < 60) return m + ' phút';\n    if (m % 10080 === 0) return m / 10080 + ' tuần';\n    if (m % 1440 === 0) return m / 1440 + ' ngày';\n    if (m % 60 === 0) return m / 60 + ' giờ';\n    if (m > 1440) return Math.floor(m / 1440) + ' ngày ' + (m % 1440 >= 60 ? Math.round((m % 1440) / 60) + ' giờ' : '');\n    return Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';\n  }\n\n  // ------------------------------------------------------------ ngày giờ\n  function pad(n) { return (n < 10 ? '0' : '') + n; }\n\n  function startOfDay(d) {\n    var x = new Date(d.getTime());\n    x.setHours(0, 0, 0, 0);\n    return x;\n  }\n\n  function addDays(d, n) {\n    var x = new Date(d.getTime());\n    x.setDate(x.getDate() + n);\n    return x;\n  }\n\n  function dayKey(d) {\n    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());\n  }\n\n  // ISO có múi giờ, ví dụ 2026-10-25T23:59:00+07:00\n  function toISO(d) {\n    var off = -d.getTimezoneOffset();\n    var sign = off >= 0 ? '+' : '-';\n    var a = Math.abs(off);\n    return (\n      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +\n      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +\n      sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60)\n    );\n  }\n\n  // giá trị cho <input type=\"datetime-local\">\n  function toInputValue(d) {\n    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +\n      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());\n  }\n\n  function fromInputValue(s) {\n    if (!s) return null;\n    var m = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(s);\n    if (!m) return null;\n    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);\n    return isNaN(d.getTime()) ? null : d;\n  }\n\n  var WD_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];\n  var WD_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];\n\n  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }\n\n  function fmtDeadline(iso, now) {\n    var d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;\n    if (!d || isNaN(d.getTime())) return '';\n    now = now || new Date();\n    var s = WD_SHORT[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);\n    if (d.getFullYear() !== now.getFullYear()) s += '/' + d.getFullYear();\n    return s + ' ' + fmtTime(d);\n  }\n\n  function relativeText(iso, now) {\n    var d = new Date(iso);\n    now = now || new Date();\n    var diff = d.getTime() - now.getTime();\n    var abs = Math.abs(diff);\n    var txt;\n    if (abs < MIN) txt = 'ngay bây giờ';\n    else if (abs < HOUR) txt = Math.round(abs / MIN) + ' phút';\n    else if (abs < DAY) {\n      var h = Math.floor(abs / HOUR);\n      var mm = Math.round((abs % HOUR) / MIN);\n      txt = h + ' giờ' + (mm >= 5 && h < 6 ? ' ' + mm + ' phút' : '');\n    } else {\n      var days = Math.floor(abs / DAY);\n      var hh = Math.round((abs % DAY) / HOUR);\n      txt = days + ' ngày' + (hh > 0 && days < 4 ? ' ' + hh + ' giờ' : '');\n    }\n    if (abs < MIN) return txt;\n    return diff >= 0 ? 'còn ' + txt : 'quá hạn ' + txt;\n  }\n\n  // ---------------------------------------------------- phân nhóm theo hạn\n  function endOfWeek(now) {\n    // tuần bắt đầu thứ 2, kết thúc chủ nhật 23:59:59.999\n    var s = startOfDay(now);\n    var dow = s.getDay(); // 0 = CN\n    var untilSun = dow === 0 ? 0 : 7 - dow;\n    var e = addDays(s, untilSun + 1);\n    return e.getTime() - 1;\n  }\n\n  function bucketOf(task, now) {\n    now = now || new Date();\n    if (task.status === 'done') return 'done';\n    var t = new Date(task.deadline).getTime();\n    if (isNaN(t)) return 'later';\n    if (t < now.getTime()) return 'overdue';\n    var endToday = addDays(startOfDay(now), 1).getTime() - 1;\n    if (t <= endToday) return 'today';\n    if (t <= endOfWeek(now)) return 'week';\n    return 'later';\n  }\n\n  function urgencyOf(task, now) {\n    now = now || new Date();\n    if (task.status === 'done') return 'done';\n    var t = new Date(task.deadline).getTime();\n    var diff = t - now.getTime();\n    if (diff < 0) return 'overdue';\n    if (diff < DAY) return 'critical';\n    if (diff < 3 * DAY) return 'soon';\n    if (diff < 7 * DAY) return 'week';\n    return 'later';\n  }\n\n  function sortTasks(list, bucket) {\n    var arr = list.slice();\n    if (bucket === 'done') {\n      arr.sort(function (a, b) { return (Number(b.doneAt) || 0) - (Number(a.doneAt) || 0); });\n    } else {\n      arr.sort(function (a, b) {\n        var d = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();\n        return d !== 0 ? d : String(a.title).localeCompare(String(b.title), 'vi');\n      });\n    }\n    return arr;\n  }\n\n  function sortBy(list, mode) {\n    var arr = sortTasks(list, 'open'); // nền: hạn gần nhất\n    var idx = new Map(arr.map(function (t, i) { return [t, i]; }));\n    var cmp = {\n      priority: function (a, b) { return normPriority(a.priority) - normPriority(b.priority); },\n      group: function (a, b) { return String(a.group || '\\uffff').localeCompare(String(b.group || '\\uffff'), 'vi'); },\n      title: function (a, b) { return String(a.title).localeCompare(String(b.title), 'vi'); },\n      newest: function (a, b) { return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); },\n      farthest: function (a, b) { return new Date(b.deadline) - new Date(a.deadline); }\n    }[mode];\n    if (!cmp) return arr;\n    return arr.sort(function (a, b) { return cmp(a, b) || idx.get(a) - idx.get(b); });\n  }\n\n  // ------------------------------------------------------ logic nhắc nhở\n  function reminderSchedule(task) {\n    var dl = new Date(task.deadline).getTime();\n    if (isNaN(dl)) return [];\n    return normOffsets(task.reminders).map(function (o) {\n      return { offset: o, at: dl - o * MIN };\n    }).sort(function (a, b) { return a.at - b.at; });\n  }\n\n  /*\n   * Quyết định có cần nhắc ngay lúc này không.\n   * - chỉ nhắc mốc đã tới giờ, chưa nhắc, và không phải mốc đã trôi qua trước khi việc được tạo/sửa hạn\n   * - nếu có nhiều mốc cùng \"đến hạn\" (máy tắt/ngủ), chỉ nhắc một lần, chọn mốc gần hạn nhất\n   */\n  function dueNow(task, nowMs, firedOffsets) {\n    var res = { fire: null, markFired: [] };\n    if (!task || task.deleted || task.status === 'done') return res;\n    var fired = {};\n    (firedOffsets || []).forEach(function (o) { fired[o] = true; });\n    var armed = Number(task.armedAt) || Number(task.createdAt) || 0;\n    var candidates = [];\n    reminderSchedule(task).forEach(function (r) {\n      if (fired[r.offset] || r.at > nowMs) return;\n      res.markFired.push(r.offset);\n      if (r.at >= armed - MIN) candidates.push(r);\n    });\n    if (candidates.length) {\n      var best = candidates[candidates.length - 1]; // at lớn nhất = gần hạn nhất\n      res.fire = { offset: best.offset, at: best.at, late: nowMs - best.at > 5 * MIN };\n    }\n    return res;\n  }\n\n  function describeReminder(task, info, now) {\n    now = now || new Date();\n    var rel = relativeText(task.deadline, now);\n    var title;\n    if (info.snooze) title = 'Nhắc lại: ' + task.title;\n    else if (info.offset === 0) title = 'Đến hạn: ' + task.title;\n    else title = 'Còn ' + fmtOffset(info.offset) + ': ' + task.title;\n    var parts = ['Hạn ' + fmtDeadline(task.deadline, now) + ' (' + rel + ')'];\n    if (task.group) parts.push(task.group);\n    if (info.late && !info.snooze) parts.unshift('Lời nhắc bị lỡ');\n    return { title: title, body: parts.join(' · '), rel: rel };\n  }\n\n  // ---------------------------------------------------- phân tích nhập nhanh\n  function baseChar(c) {\n    if (c === 'đ') return 'd';\n    if (c === 'Đ') return 'D';\n    var b = c.normalize('NFD').replace(/[̀-ͯ]/g, '');\n    return b.length === c.length ? b : c;\n  }\n\n  function fold(s) {\n    var out = '';\n    for (var ch of s) out += baseChar(ch);\n    return out.toLowerCase();\n  }\n\n  var PERIOD_DEFAULT_HOUR = { sang: 9, trua: 12, chieu: 17, toi: 20, dem: 23 };\n\n  function applyPeriod(h, period) {\n    if (!period) return h;\n    if (period === 'sang') return h === 12 ? 0 : h;\n    if (period === 'trua') return h < 10 ? h + 12 : h;\n    if (period === 'chieu') return h < 12 ? h + 12 : h;\n    if (period === 'toi' || period === 'dem') {\n      if (h === 12) return 24;\n      return h < 12 ? h + 12 : h;\n    }\n    if (period === 'pm') return h < 12 ? h + 12 : h;\n    if (period === 'am') return h === 12 ? 0 : h;\n    return h;\n  }\n\n  var WEEKDAY_WORDS = { hai: 1, ba: 2, tu: 3, nam: 4, sau: 5, bay: 6 };\n\n  var STOP_TAIL = {\n    vao: 1, luc: 1, truoc: 1, han: 1, deadline: 1, dl: 1, den: 1, ngay: 1, trong: 1,\n    tai: 1, khoang: 1, kip: 1, by: 1, on: 1, at: 1, trc: 1\n  };\n\n  function parseQuick(input, nowArg, opts) {\n    opts = opts || {};\n    var now = nowArg ? new Date(nowArg) : new Date();\n    var text = String(input || '');\n    var f = fold(text);\n    var lc = text.toLowerCase();\n    var mask = new Array(text.length);\n    for (var i = 0; i < mask.length; i++) mask[i] = false;\n\n    function free(a, b) {\n      for (var k = a; k < b; k++) if (mask[k]) return false;\n      return true;\n    }\n    function eat(a, b) { for (var k = a; k < b; k++) mask[k] = true; }\n\n    // chạy regex trên f, bỏ qua vùng đã dùng; hasPre = nhóm 1 là ký tự đứng trước (thay cho lookbehind)\n    function find(re, hasPre, accept) {\n      var r = new RegExp(re.source, 'g');\n      var m;\n      while ((m = r.exec(f))) {\n        if (m[0].length === 0) { r.lastIndex++; continue; }\n        var arr = Array.prototype.slice.call(m);\n        var start = m.index;\n        if (hasPre) {\n          var pre = m[1] || '';\n          arr.splice(1, 1);\n          arr[0] = m[0].slice(pre.length);\n          start += pre.length;\n        }\n        arr.index = start;\n        if (arr[0].length && free(start, start + arr[0].length) && (!accept || accept(arr))) return arr;\n        r.lastIndex = m.index + 1;\n      }\n      return null;\n    }\n\n    var result = { title: '', group: '', priority: DEFAULT_PRIORITY, deadline: null, hasDate: false, hasTime: false, reminders: null };\n\n    // 1) nhóm (chỉ nhận một thẻ #; các # sau giữ nguyên trong tiêu đề):\n    //    #BTL1 | #\"Toán rời rạc\" | #[Toán rời rạc] | #(Toán rời rạc)\n    //    #toan roi rac -> khớp nhóm nhiều từ đã có\n    //    #a bc         -> thẻ một từ gom thêm các từ tự do đứng ngay sau nó (xem bước 5b)\n    var looseGroupEnd = -1;\n    var gm = find(/#(?:\"[^\"]+\"|\\[[^\\]]+\\]|\\([^)]+\\))/);\n    if (gm) {\n      result.group = text.slice(gm.index + 2, gm.index + gm[0].length - 1).replace(/\\s+/g, ' ').trim();\n      eat(gm.index, gm.index + gm[0].length);\n    } else if ((gm = find(/#([^\\s#!]+)/))) {\n      var gFrom = gm.index + 1;\n      var gTo = gm.index + gm[0].length;\n      result.group = text.slice(gFrom, gTo).replace(/_/g, ' ');\n      var known = (opts.groups || []).map(function (g) { return { name: g, f: fold(g).replace(/\\s+/g, ' ') }; })\n        .sort(function (a, b) { return b.f.length - a.f.length; });\n      for (var ki = 0; ki < known.length; ki++) {\n        var kf = known[ki].f;\n        if (kf.length > gTo - gFrom && f.substr(gFrom, kf.length) === kf && (gFrom + kf.length >= f.length || /\\s/.test(f[gFrom + kf.length]))) {\n          result.group = known[ki].name;\n          gTo = gFrom + kf.length;\n          break;\n        }\n      }\n      if (gTo === gm.index + gm[0].length) looseGroupEnd = gTo;\n      eat(gm.index, gTo);\n    }\n\n    // 2) ưu tiên: !1..!5 (1 = cao nhất), hoặc chữ: !cao = 1, !tb = 3, !thap = 5\n    var pm;\n    var guard = 0;\n    while ((pm = find(/(^|\\s)!([a-z0-9]+)(?=\\s|$)/)) && guard++ < 5) {\n      var word = pm[2];\n      var p = null;\n      p = priorityFromWord(word);\n      if (!p) break;\n      result.priority = p;\n      var s0 = pm.index + pm[1].length;\n      eat(s0, pm.index + pm[0].length);\n    }\n\n    // 3) ngày\n    var date = null; // Date lúc 00:00\n    var relDeadline = null; // hạn tính tương đối theo giờ/phút\n    var today0 = startOfDay(now);\n\n    function setDate(d, m) {\n      date = d;\n      eat(m.index, m.index + m[0].length);\n      result.hasDate = true;\n    }\n\n    var m;\n\n    // ISO yyyy-mm-dd\n    if (!date && (m = find(/(^|[^\\d/.-])(\\d{4})-(\\d{1,2})-(\\d{1,2})(?![\\d])/, true))) {\n      var dd = new Date(+m[1], +m[2] - 1, +m[3]);\n      if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && dd.getDate() === +m[3]) setDate(dd, m);\n    }\n    // dd/mm/yyyy (cho phép . - /)\n    if (!date && (m = find(/(^|[^\\d/.-])(?:ngay\\s+)?(\\d{1,2})\\s*[/.-]\\s*(\\d{1,2})\\s*[/.-]\\s*(\\d{4}|\\d{2})(?![\\d])/, true))) {\n      var y3 = +m[3] < 100 ? 2000 + +m[3] : +m[3];\n      var d3 = new Date(y3, +m[2] - 1, +m[1]);\n      if (+m[2] >= 1 && +m[2] <= 12 && d3.getDate() === +m[1]) setDate(d3, m);\n    }\n    // dd/mm  (chỉ / và -)\n    if (!date && (m = find(/(^|[^\\d/.-])(?:ngay\\s+)?(\\d{1,2})\\s*[/-]\\s*(\\d{1,2})(?![\\d/.-])/, true))) {\n      var mo = +m[2];\n      var dayN = +m[1];\n      if (mo >= 1 && mo <= 12 && dayN >= 1 && dayN <= 31) {\n        var d2 = new Date(now.getFullYear(), mo - 1, dayN);\n        if (d2.getDate() === dayN) {\n          if (d2.getTime() < today0.getTime()) d2 = new Date(now.getFullYear() + 1, mo - 1, dayN);\n          if (d2.getDate() === dayN) setDate(d2, m);\n        }\n      }\n    }\n    // \"ngày 25 tháng 10\" / \"25 tháng 10\"\n    if (!date && (m = find(/(^|[^\\d/.-])(?:ngay\\s+)?(\\d{1,2})\\s*thang\\s*(\\d{1,2})(?![\\d])/, true))) {\n      var mo2 = +m[2];\n      var dn2 = +m[1];\n      if (mo2 >= 1 && mo2 <= 12 && dn2 >= 1 && dn2 <= 31) {\n        var d4 = new Date(now.getFullYear(), mo2 - 1, dn2);\n        if (d4.getDate() === dn2) {\n          if (d4.getTime() < today0.getTime()) d4 = new Date(now.getFullYear() + 1, mo2 - 1, dn2);\n          setDate(d4, m);\n        }\n      }\n    }\n    // \"ngày 25\" (không tháng)\n    if (!date && (m = find(/ngay\\s+(\\d{1,2})(?![\\d/:h])/))) {\n      var dn3 = +m[1];\n      if (dn3 >= 1 && dn3 <= 31) {\n        var cand = new Date(now.getFullYear(), now.getMonth(), dn3);\n        if (cand.getDate() !== dn3) cand = null;\n        if (cand && cand.getTime() < today0.getTime()) {\n          cand = new Date(now.getFullYear(), now.getMonth() + 1, dn3);\n          if (cand.getDate() !== dn3) cand = null;\n        }\n        if (cand) setDate(cand, m);\n      }\n    }\n    // tương đối: \"sau 3 ngày\", \"3 ngày nữa\", \"trong 2 tuần\"\n    if (!date && !relDeadline) {\n      var notAfterWeekWord = function (mm) {\n        var before = f.slice(0, mm.index);\n        if (/\\b(tuan|thang|thu|ngay|nam)\\s*$/.test(before) && /^(sau|trong)/.test(mm[0])) return false;\n        if (/\\b(thu|t)\\s*$/.test(before) && /^\\d/.test(mm[0])) return false;\n        return true;\n      };\n      var rm = find(/(?:sau|trong)\\s+(\\d{1,3})\\s*(ngay|tuan|thang|gio|phut|h)(?![a-z])/, false, notAfterWeekWord) ||\n        find(/(\\d{1,3})\\s*(ngay|tuan|thang|gio|phut)\\s+(?:nua|toi|sau)(?![a-z])/, false, notAfterWeekWord);\n      if (rm) {\n        var n = +rm[1];\n        var unit = rm[2];\n        if (unit === 'gio' || unit === 'h') {\n          relDeadline = new Date(now.getTime() + n * HOUR);\n        } else if (unit === 'phut') {\n          relDeadline = new Date(now.getTime() + n * MIN);\n        } else if (unit === 'ngay') {\n          date = addDays(today0, n);\n        } else if (unit === 'tuan') {\n          date = addDays(today0, 7 * n);\n        } else {\n          date = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());\n        }\n        eat(rm.index, rm.index + rm[0].length);\n        if (relDeadline) { result.hasDate = true; result.hasTime = true; } else result.hasDate = true;\n      }\n    }\n    // hôm nay / mai / mốt\n    if (!date && !relDeadline) {\n      var wm;\n      if ((wm = find(/\\b(?:ngay\\s+)?hom\\s+nay\\b|\\bhnay\\b/)) ||\n          (wm = find(/\\b(?:sang|trua|chieu|toi)\\s+nay\\b/))) {\n        // với \"tối nay\"... chỉ dùng phần \"nay\", giữ từ chỉ buổi để xử lý giờ ở bước sau\n        var per = /^(sang|trua|chieu|toi)\\s+nay/.exec(wm[0]);\n        if (per) { eat(wm.index + per[1].length, wm.index + wm[0].length); }\n        else eat(wm.index, wm.index + wm[0].length);\n        date = today0;\n        result.hasDate = true;\n      } else if ((wm = find(/\\b(?:ngay\\s+|bua\\s+)?mai\\b/))) {\n        eat(wm.index, wm.index + wm[0].length);\n        date = addDays(today0, 1);\n        result.hasDate = true;\n      } else {\n        // \"mốt\" phải có dấu để không nhầm với \"một\"\n        var mr = /(^|[^\\p{L}])(?:ngày\\s+)?mốt(?![\\p{L}])/u.exec(lc);\n        if (mr) {\n          var s1 = mr.index + mr[1].length;\n          if (free(s1, mr.index + mr[0].length)) {\n            eat(s1, mr.index + mr[0].length);\n            date = addDays(today0, 2);\n            result.hasDate = true;\n          }\n        }\n      }\n    }\n    // thứ / tuần\n    if (!date && !relDeadline) {\n      var weekMod = null; // 0 = tuần này, 1 = tuần sau\n      var wdm = null;\n      var wday = null;\n      var wmm;\n      wmm = find(/\\btuan\\s+(nay|sau|toi)\\b/);\n      var cuoiTuan = find(/\\bcuoi\\s+tuan(?:\\s+nay)?\\b/);\n      var chunhat = find(/\\bchu\\s*nhat\\b|\\bcn\\b/);\n      wdm = find(/\\bthu\\s*([2-7])\\b/) || find(/\\bt([2-7])\\b/) || find(/\\bthu\\s+(hai|ba|tu|nam|sau|bay)\\b/);\n      if (wdm) {\n        wday = /^\\d$/.test(wdm[1]) ? +wdm[1] - 1 : WEEKDAY_WORDS[wdm[1]];\n        wday = wday === 7 ? 0 : wday; // không xảy ra, giữ cho chắc\n      } else if (chunhat) {\n        wdm = chunhat;\n        wday = 0;\n      }\n      if (wmm) weekMod = wmm[1] === 'nay' ? 0 : 1;\n      var used = [];\n      if (wdm) used.push(wdm);\n      if (wmm) used.push(wmm);\n      if (wday !== null) {\n        var mondayThis = addDays(today0, -((today0.getDay() + 6) % 7));\n        var off = (wday + 6) % 7; // T2 = 0 ... CN = 6\n        if (weekMod !== null) {\n          date = addDays(mondayThis, off + 7 * weekMod);\n        } else {\n          date = addDays(today0, 1);\n          while (date.getDay() !== wday) date = addDays(date, 1);\n        }\n      } else if (cuoiTuan) {\n        used.push(cuoiTuan);\n        var mt = addDays(today0, -((today0.getDay() + 6) % 7));\n        date = addDays(mt, 6);\n        if (wmm && weekMod === 1) date = addDays(date, 7);\n      } else if (wmm) {\n        if (weekMod === 1) date = addDays(today0, 7);\n        else date = addDays(addDays(today0, -((today0.getDay() + 6) % 7)), 6);\n      }\n      if (date) {\n        used.forEach(function (u) { eat(u.index, u.index + u[0].length); });\n        result.hasDate = true;\n      }\n    }\n    // \"tháng sau\"\n    if (!date && !relDeadline && (m = find(/\\bthang\\s+(sau|toi)\\b/))) {\n      date = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());\n      eat(m.index, m.index + m[0].length);\n      result.hasDate = true;\n    }\n\n    // 4) giờ\n    var hour = null;\n    var minute = 0;\n    if (!relDeadline) {\n      var tm;\n      if ((tm = find(/(^|[^\\d/.:])(\\d{1,2}):(\\d{2})(?![\\d])\\s*(am|pm)?/, true))) {\n        var h1 = +tm[1];\n        var mi1 = +tm[2];\n        if (mi1 < 60 && h1 <= 24) {\n          hour = tm[3] ? applyPeriod(h1, tm[3]) : h1;\n          minute = mi1;\n          eat(tm.index, tm.index + tm[0].length);\n        }\n      }\n      if (hour === null && (tm = find(/(^|[^\\d/.:])(\\d{1,2})\\s*(?:h|gio)(?:\\s*(\\d{1,2})(?![\\d]))?(?![a-z0-9])(?:\\s*(sang|trua|chieu|toi|dem)(?![a-z]))?/, true))) {\n        var h2 = +tm[1];\n        var mi2 = tm[2] ? +tm[2] : 0;\n        if (h2 <= 24 && mi2 < 60 && !(h2 === 24 && mi2 > 0)) {\n          hour = applyPeriod(h2, tm[3]);\n          minute = mi2;\n          eat(tm.index, tm.index + tm[0].length);\n        }\n      }\n      if (hour === null && (tm = find(/(^|[^\\d/.:])(\\d{1,2})\\s*(am|pm)(?![a-z])/, true))) {\n        var h3 = +tm[1];\n        if (h3 >= 1 && h3 <= 12) {\n          hour = applyPeriod(h3, tm[2]);\n          eat(tm.index, tm.index + tm[0].length);\n        }\n      }\n      if (hour === null && (tm = find(/\\bcuoi\\s+ngay\\b/))) {\n        hour = 23; minute = 59;\n        eat(tm.index, tm.index + tm[0].length);\n      }\n      if (hour === null && (tm = find(/\\b(sang|trua|chieu|toi|dem)\\b/))) {\n        hour = PERIOD_DEFAULT_HOUR[tm[1]];\n        eat(tm.index, tm.index + tm[0].length);\n      }\n      if (hour !== null) result.hasTime = true;\n    }\n\n    // 5) ghép ngày + giờ\n    var deadline = null;\n    if (relDeadline) {\n      deadline = relDeadline;\n    } else if (date) {\n      deadline = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour === null ? 23 : hour, hour === null ? 59 : minute, 0, 0);\n    } else if (hour !== null) {\n      deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);\n      if (deadline.getTime() <= now.getTime()) deadline = addDays(deadline, 1);\n      result.hasDate = true;\n    }\n    result.deadline = deadline;\n\n    // 5b) nhóm nhiều từ không đặt trong ngoặc: \"abc #a bc\" -> nhóm \"a bc\".\n    // Gom các từ tự do đứng liền sau thẻ, dừng ở phần đã hiểu (ngày/giờ/ưu tiên), dấu # khác hoặc hết câu.\n    // Muốn viết tiếp tên việc sau nhóm thì dùng #\"tên nhóm\".\n    if (looseGroupEnd >= 0) {\n      var pos = looseGroupEnd;\n      var extra = [];\n      while (pos < text.length && extra.length < 3) {\n        while (pos < text.length && /\\s/.test(text[pos])) pos++;\n        if (pos >= text.length || mask[pos] || text[pos] === '#' || text[pos] === '!') break;\n        var wend = pos;\n        while (wend < text.length && !/\\s/.test(text[wend]) && !mask[wend]) wend++;\n        extra.push({ t: text.slice(pos, wend), f: f.slice(pos, wend), a: pos, b: wend });\n        pos = wend;\n      }\n      while (extra.length && STOP_TAIL[extra[extra.length - 1].f.replace(/[.,;:]+$/, '')] === 1) extra.pop();\n      var joined = result.group + ' ' + extra.map(function (w) { return w.t; }).join(' ');\n      if (extra.length && joined.length <= 60) {\n        result.group = joined.replace(/[\\s,;:]+$/, '');\n        eat(looseGroupEnd, extra[extra.length - 1].b);\n      }\n    }\n\n    // 6) tiêu đề: phần còn lại\n    var words = [];\n    var cur = '';\n    var curFold = '';\n    for (var k = 0; k < text.length; k++) {\n      if (mask[k]) {\n        if (cur) { words.push({ t: cur, f: curFold }); cur = ''; curFold = ''; }\n        continue;\n      }\n      var c = text[k];\n      if (/\\s/.test(c)) {\n        if (cur) { words.push({ t: cur, f: curFold }); cur = ''; curFold = ''; }\n      } else { cur += c; curFold += f[k]; }\n    }\n    if (cur) words.push({ t: cur, f: curFold });\n    // bỏ từ nối thừa ở cuối: \"vào\", \"lúc\", \"trước\", \"hạn\", \"deadline\"\n    while (words.length > 1 && STOP_TAIL[words[words.length - 1].f.replace(/[.,;:]+$/, '')] === 1) words.pop();\n    while (words.length && /^[,;:.\\-–—]+$/.test(words[words.length - 1].t)) words.pop();\n    result.title = words.map(function (w) { return w.t; }).join(' ').replace(/[\\s,;:]+$/, '').trim();\n\n    // 7) khớp nhóm đã có (không phân biệt hoa thường/dấu)\n    if (result.group && opts.groups && opts.groups.length) {\n      var gf = fold(result.group);\n      for (var gi = 0; gi < opts.groups.length; gi++) {\n        if (fold(opts.groups[gi]) === gf) { result.group = opts.groups[gi]; break; }\n      }\n    }\n\n    result.reminders = offsetsForPriority(result.priority);\n    return result;\n  }\n\n  // ----------------------------------------------------------- dữ liệu việc\n  function makeId() {\n    var s = '';\n    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';\n    for (var i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];\n    return 't' + Date.now().toString(36) + s;\n  }\n\n  function newTask(fields, nowMs) {\n    nowMs = nowMs || Date.now();\n    var t = {\n      id: fields.id || makeId(),\n      title: String(fields.title || '').trim(),\n      details: fields.details || '',\n      notes: fields.notes || '',\n      group: fields.group || '',\n      priority: normPriority(fields.priority),\n      status: fields.status || 'todo',\n      deadline: fields.deadline,\n      reminders: normOffsets(fields.reminders || offsetsForPriority(fields.priority)),\n      checklist: fields.checklist || [],\n      eventId: '',\n      createdAt: nowMs,\n      updatedAt: nowMs,\n      armedAt: nowMs,\n      deleted: false,\n      doneAt: 0\n    };\n    return t;\n  }\n\n  // Gộp danh sách từ server vào dữ liệu cục bộ (dùng chung cho laptop & điện thoại)\n  function mergeServer(local, serverList, sent) {\n    var out = {};\n    var seen = {};\n    sent = sent || {};\n    serverList.forEach(function (s) {\n      seen[s.id] = true;\n      var l = local[s.id];\n      if (l && l._dirty && (!(s.id in sent) || Number(l.updatedAt) > Number(sent[s.id]))) {\n        out[s.id] = Number(s.updatedAt) > Number(l.updatedAt) ? s : l;\n      } else {\n        out[s.id] = s;\n      }\n    });\n    Object.keys(local).forEach(function (id) {\n      if (!seen[id] && local[id]._dirty) out[id] = local[id];\n    });\n    return out;\n  }\n\n  function groupsOf(tasks) {\n    var seen = {};\n    var out = [];\n    tasks.forEach(function (t) {\n      if (t.group && !t.deleted && !seen[t.group]) { seen[t.group] = true; out.push(t.group); }\n    });\n    return out.sort(function (a, b) { return a.localeCompare(b, 'vi'); });\n  }\n\n  // Nhóm kèm số việc đang mở, để hiện trong menu gợi ý\n  function groupStats(tasks) {\n    var counts = {};\n    tasks.forEach(function (t) {\n      if (t.group && !t.deleted) counts[t.group] = (counts[t.group] || 0) + (t.status === 'done' ? 0 : 1);\n    });\n    return groupsOf(tasks).map(function (n) { return { name: n, count: counts[n] || 0 }; });\n  }\n\n  // Việc đang mở có cùng hạn (tính đến phút) với hạn vừa nhập\n  function findDuplicates(tasks, deadline, excludeId) {\n    var d = deadline instanceof Date ? deadline : new Date(deadline);\n    if (!deadline || isNaN(d.getTime())) return [];\n    var key = Math.floor(d.getTime() / MIN);\n    return tasks.filter(function (t) {\n      return !t.deleted && t.status !== 'done' && t.id !== excludeId &&\n        Math.floor(new Date(t.deadline).getTime() / MIN) === key;\n    });\n  }\n\n  function dupText(dups, title) {\n    if (!dups.length) return '';\n    var f = fold(title || '');\n    var same = !!f && dups.some(function (t) { return fold(t.title) === f; });\n    var names = dups.slice(0, 2).map(function (t) { return '«' + t.title + '»'; }).join(', ') +\n      (dups.length > 2 ? ' và ' + (dups.length - 2) + ' việc khác' : '');\n    return (same ? 'Có công việc trùng (cùng tên, cùng hạn): ' : 'Có công việc trùng hạn: ') + names;\n  }\n\n  var GROUP_COLORS = [\n    '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316',\n    '#ef4444', '#ec4899', '#a855f7', '#64748b'\n  ];\n\n  function groupColor(name) {\n    if (!name) return '#94a3b8';\n    var h = 0;\n    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;\n    return GROUP_COLORS[h % GROUP_COLORS.length];\n  }\n\n  var PRIORITY_LABEL = { 1: 'Rất cao', 2: 'Cao', 3: 'Trung bình', 4: 'Thấp', 5: 'Rất thấp' };\n  var STATUS_LABEL = { todo: 'Chưa làm', doing: 'Đang làm', done: 'Xong' };\n\n  return {\n    MIN: MIN, HOUR: HOUR, DAY: DAY,\n    DEFAULT_OFFSETS: DEFAULT_OFFSETS, PRESET_OFFSETS: PRESET_OFFSETS, DEFAULT_PRIORITY: DEFAULT_PRIORITY,\n    normPriority: normPriority, offsetsForPriority: offsetsForPriority,\n    bangTyping: bangTyping, hashTyping: hashTyping, priorityOptions: priorityOptions,\n    groupStats: groupStats, findDuplicates: findDuplicates, dupText: dupText, priorityFromWord: priorityFromWord, normOffsets: normOffsets, fmtOffset: fmtOffset,\n    toISO: toISO, toInputValue: toInputValue, fromInputValue: fromInputValue,\n    startOfDay: startOfDay, addDays: addDays, dayKey: dayKey,\n    fmtDeadline: fmtDeadline, fmtTime: fmtTime, relativeText: relativeText,\n    WD_SHORT: WD_SHORT, WD_LONG: WD_LONG,\n    bucketOf: bucketOf, urgencyOf: urgencyOf, sortTasks: sortTasks, sortBy: sortBy, endOfWeek: endOfWeek,\n    reminderSchedule: reminderSchedule, dueNow: dueNow, describeReminder: describeReminder,\n    parseQuick: parseQuick, fold: fold,\n    makeId: makeId, newTask: newTask, mergeServer: mergeServer, groupsOf: groupsOf,\n    groupColor: groupColor, PRIORITY_LABEL: PRIORITY_LABEL, STATUS_LABEL: STATUS_LABEL\n  };\n});\n</script>\n<script>\n(function () {\n  'use strict';\n  var BOOT = /*BOOT*/null;\n  var LS = 'deadline_state_v1';\n  var state = { tasks: {}, lastSync: 0 };\n  var tab = 'open';\n  var groupFilter = '';\n  var syncing = false;\n  var again = false;\n  var lastError = '';\n  var form = null;\n\n  function $(id) { return document.getElementById(id); }\n  function esc(s) { return String(s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\n\n  // ưu tiên là số 1-5 (1 = cao nhất); dữ liệu cũ dạng chữ high/normal/low được đổi khi nạp\n  function normAll() {\n    Object.keys(state.tasks).forEach(function (id) { state.tasks[id].priority = Core.normPriority(state.tasks[id].priority); });\n  }\n\n  function load() {\n    try {\n      var s = JSON.parse(localStorage.getItem(LS) || 'null');\n      if (s && s.tasks) state = s;\n    } catch (e) { /* không có bộ nhớ */ }\n    normAll();\n  }\n  function save() {\n    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { /* bỏ qua */ }\n  }\n\n  // ---------------------------------------------------------------- gọi server\n  function call(payload) {\n    return new Promise(function (resolve, reject) {\n      if (!(window.google && google.script && google.script.run)) { reject(new Error('Không kết nối được máy chủ')); return; }\n      google.script.run\n        .withSuccessHandler(function (r) { try { resolve(JSON.parse(r)); } catch (e) { reject(new Error('Phản hồi không hợp lệ')); } })\n        .withFailureHandler(function (e) { reject(new Error((e && e.message) || 'Lỗi mạng')); })\n        .api(JSON.stringify(payload));\n    });\n  }\n\n  function dirtyCount() {\n    var n = 0;\n    Object.keys(state.tasks).forEach(function (id) { if (state.tasks[id]._dirty) n++; });\n    return n;\n  }\n\n  function setSync() {\n    var el = $('sync');\n    var n = dirtyCount();\n    el.className = 'sync';\n    if (syncing) { el.textContent = 'Đang đồng bộ…'; return; }\n    if (lastError) {\n      el.className = 'sync err';\n      el.textContent = (n ? n + ' thay đổi chưa gửi · ' : '') + 'Mất kết nối';\n      return;\n    }\n    if (n) { el.textContent = n + ' thay đổi chờ gửi'; return; }\n    if (state.lastSync) {\n      el.className = 'sync ok';\n      el.textContent = 'Đã đồng bộ ' + Core.fmtTime(new Date(state.lastSync));\n    } else el.textContent = '';\n  }\n\n  function sync() {\n    if (syncing) { again = true; return; }\n    syncing = true;\n    setSync();\n    var dirty = [];\n    var sent = {};\n    Object.keys(state.tasks).forEach(function (id) {\n      var t = state.tasks[id];\n      if (t._dirty) {\n        var c = {};\n        Object.keys(t).forEach(function (k) { if (k !== '_dirty') c[k] = t[k]; });\n        dirty.push(c);\n        sent[id] = t.updatedAt;\n      }\n    });\n    call({ action: 'sync', key: BOOT.key, tasks: dirty }).then(function (r) {\n      if (!r.ok) throw new Error(r.error || 'Lỗi');\n      var merged = Core.mergeServer(state.tasks, r.tasks, sent);\n      Object.keys(merged).forEach(function (id) {\n        if (merged[id].deleted && !merged[id]._dirty) delete merged[id];\n      });\n      state.tasks = merged;\n      normAll();\n      state.lastSync = Date.now();\n      lastError = '';\n      save();\n      render();\n    }).catch(function (e) {\n      lastError = e.message || 'Lỗi';\n    }).then(function () {\n      syncing = false;\n      setSync();\n      if (again) { again = false; sync(); }\n    });\n  }\n\n  var syncTimer = null;\n  function syncSoon() {\n    clearTimeout(syncTimer);\n    syncTimer = setTimeout(sync, 500);\n  }\n\n  // ------------------------------------------------------------------ dữ liệu\n  function list() {\n    return Object.keys(state.tasks).map(function (k) { return state.tasks[k]; }).filter(function (t) { return !t.deleted; });\n  }\n\n  function touch(t, rearm) {\n    var now = Date.now();\n    t.updatedAt = Math.max(now, (Number(t.updatedAt) || 0) + 1);\n    if (rearm) t.armedAt = now;\n    t._dirty = true;\n    state.tasks[t.id] = t;\n    save();\n    render();\n    syncSoon();\n  }\n\n  function toggleDone(id) {\n    var t = state.tasks[id];\n    if (!t) return;\n    if (t.status === 'done') { t.status = 'todo'; t.doneAt = 0; }\n    else { t.status = 'done'; t.doneAt = Date.now(); }\n    touch(t, false);\n  }\n\n  // ----------------------------------------------------------------- hiển thị\n  var TABS = [\n    ['open', 'Tất cả'], ['overdue', 'Quá hạn'], ['today', 'Hôm nay'],\n    ['week', 'Tuần này'], ['later', 'Sắp tới'], ['done', 'Đã xong']\n  ];\n\n  function inTab(t, name, now) {\n    var b = Core.bucketOf(t, now);\n    if (name === 'open') return b !== 'done';\n    return b === name;\n  }\n\n  function render() {\n    var now = new Date();\n    var all = list();\n    var groups = Core.groupsOf(all);\n    var gf = $('gf');\n    var cur = groupFilter;\n    gf.innerHTML = '<option value=\"\">Tất cả nhóm</option>' + groups.map(function (g) {\n      return '<option value=\"' + esc(g) + '\"' + (g === cur ? ' selected' : '') + '>' + esc(g) + '</option>';\n    }).join('');\n    if (cur && groups.indexOf(cur) < 0) { groupFilter = ''; }\n    var pool = all.filter(function (t) { return !groupFilter || t.group === groupFilter; });\n\n    $('tabs').innerHTML = TABS.map(function (x) {\n      var n = pool.filter(function (t) { return inTab(t, x[0], now); }).length;\n      return '<button class=\"tab' + (tab === x[0] ? ' on' : '') + '\" data-tab=\"' + x[0] + '\">' + x[1] +\n        (n ? '<span class=\"n\">' + n + '</span>' : '') + '</button>';\n    }).join('');\n\n    var items = Core.sortTasks(pool.filter(function (t) { return inTab(t, tab, now); }), tab === 'done' ? 'done' : 'open');\n    var colors = { overdue: 'var(--c-overdue)', critical: 'var(--c-critical)', soon: 'var(--c-soon)', week: 'var(--c-week)', later: 'var(--c-later)', done: 'var(--c-done)' };\n    if (!items.length) {\n      $('list').innerHTML = '<div class=\"empty\">' + (tab === 'done' ? 'Chưa có việc nào hoàn thành.' : 'Không có việc nào ở đây.') + '</div>';\n    } else {\n      $('list').innerHTML = items.map(function (t) {\n        var u = Core.urgencyOf(t, now);\n        var p = Core.normPriority(t.priority);\n        var ck = t.checklist && t.checklist.length ? t.checklist.filter(function (c) { return c.d; }).length + '/' + t.checklist.length : '';\n        return '<div class=\"card' + (t.status === 'done' ? ' done' : '') + '\" data-id=\"' + esc(t.id) + '\">' +\n          '<div class=\"bar\" style=\"background:' + colors[u] + '\"></div>' +\n          '<button class=\"chk\" data-chk=\"' + esc(t.id) + '\" aria-label=\"Hoàn thành\">' + (t.status === 'done' ? '&#10003;' : '') + '</button>' +\n          '<div class=\"body\" data-open=\"' + esc(t.id) + '\"><div class=\"title\">' + esc(t.title) + '</div>' +\n          '<div class=\"meta\">' +\n          (t.group ? '<span class=\"chip\" style=\"background:' + Core.groupColor(t.group) + '\">' + esc(t.group) + '</span>' : '') +\n          '<span>' + esc(Core.fmtDeadline(t.deadline, now)) + '</span>' +\n          (t.status === 'done' ? '' : '<span class=\"rel\" style=\"color:' + colors[u] + '\">' + esc(Core.relativeText(t.deadline, now)) + '</span>') +\n          (p < 3 ? '<span style=\"color:var(--c-overdue)\">&#9873; Ưu tiên ' + p + '</span>' : '') +\n          (p > 3 ? '<span>Ưu tiên ' + p + '</span>' : '') +\n          (t.status === 'doing' ? '<span>Đang làm</span>' : '') +\n          (ck ? '<span>&#9745; ' + ck + '</span>' : '') +\n          '</div></div></div>';\n      }).join('');\n    }\n    setSync();\n  }\n\n  // ------------------------------------------------------------- nhập nhanh\n  function quickParse() {\n    return Core.parseQuick($('q').value, new Date(), { groups: Core.groupsOf(list()) });\n  }\n\n  function updatePreview() {\n    var v = $('q').value.trim();\n    var el = $('preview');\n    if (!v) { el.innerHTML = ''; return; }\n    var r = quickParse();\n    var parts = [];\n    parts.push('<b>' + esc(r.title || '(chưa có tên)') + '</b>');\n    if (r.group) parts.push('#' + esc(r.group));\n    if (r.priority !== Core.DEFAULT_PRIORITY) parts.push('ưu tiên ' + r.priority + ' (' + esc(Core.PRIORITY_LABEL[r.priority].toLowerCase()) + ')');\n    if (r.deadline) parts.push(esc(Core.fmtDeadline(r.deadline)) + ' (' + esc(Core.relativeText(r.deadline)) + ')');\n    else parts.push('<span class=\"warn\">chưa có hạn — thêm \"mai\", \"thứ 6\", \"25/10\"…</span>');\n    el.innerHTML = '→ ' + parts.join(' · ');\n  }\n\n  function quickAdd() {\n    var v = $('q').value.trim();\n    if (!v) return;\n    var r = quickParse();\n    if (!r.title || !r.deadline) {\n      openForm(null, { title: r.title, group: r.group, priority: r.priority, deadline: r.deadline });\n      $('q').value = '';\n      updatePreview();\n      return;\n    }\n    var t = Core.newTask({\n      title: r.title, group: r.group, priority: r.priority,\n      deadline: Core.toISO(r.deadline), reminders: r.reminders\n    });\n    t._dirty = true;\n    state.tasks[t.id] = t;\n    save();\n    $('q').value = '';\n    updatePreview();\n    render();\n    toast('Đã thêm: ' + t.title);\n    syncSoon();\n  }\n\n  // -------------------------------------------------------------------- form\n  function openForm(id, prefill) {\n    var t = id ? state.tasks[id] : null;\n    var d = t ? JSON.parse(JSON.stringify(t)) : null;\n    if (!d) {\n      var pf = prefill || {};\n      var dl = pf.deadline || (function () { var x = Core.addDays(Core.startOfDay(new Date()), 1); x.setHours(23, 59, 0, 0); return x; })();\n      d = {\n        id: '', title: pf.title || '', details: '', notes: '', group: pf.group || '',\n        priority: Core.normPriority(pf.priority), status: 'todo', deadline: Core.toISO(dl),\n        reminders: Core.offsetsForPriority(pf.priority), checklist: []\n      };\n    }\n    d.priority = Core.normPriority(d.priority);\n    form = { id: id || '', data: d, remTouched: !!t };\n    $('toast').classList.add('hidden');\n    $('ftitle').textContent = t ? 'Sửa việc' : 'Việc mới';\n    $('fname').value = d.title;\n    $('fdl').value = Core.toInputValue(new Date(d.deadline));\n    $('fgroup').value = d.group;\n    $('fdetails').value = d.details;\n    $('fnotes').value = d.notes;\n    $('fdel').style.display = t ? '' : 'none';\n    $('glist').innerHTML = Core.groupsOf(list()).map(function (g) { return '<option value=\"' + esc(g) + '\">'; }).join('');\n    $('fdel').textContent = 'Xóa';\n    renderSegs();\n    renderRem();\n    renderCheck();\n    $('sheet').classList.remove('hidden');\n    $('sheet').scrollTop = 0;\n    if (!t) setTimeout(function () { $('fname').focus(); }, 50);\n  }\n\n  function renderSegs() {\n    var d = form.data;\n    $('fprio').innerHTML = [1, 2, 3, 4, 5].map(function (p) {\n      return '<button data-prio=\"' + p + '\" title=\"' + Core.PRIORITY_LABEL[p] + '\" class=\"' + (d.priority === p ? 'on' : '') + '\">' + p + '</button>';\n    }).join('');\n    $('fpriohint').textContent = '— ' + d.priority + ' · ' + Core.PRIORITY_LABEL[d.priority].toLowerCase() + ' (1 = cao nhất, 5 = thấp nhất)';\n    $('fstatus').innerHTML = ['todo', 'doing', 'done'].map(function (s) {\n      return '<button data-status=\"' + s + '\" class=\"' + (d.status === s ? 'on' : '') + '\">' + Core.STATUS_LABEL[s] + '</button>';\n    }).join('');\n  }\n\n  function renderRem() {\n    var sel = Core.normOffsets(form.data.reminders);\n    var all = Core.normOffsets(Core.PRESET_OFFSETS.concat(sel));\n    $('frem').innerHTML = all.map(function (o) {\n      return '<button class=\"rchip' + (sel.indexOf(o) >= 0 ? ' on' : '') + '\" data-rem=\"' + o + '\">' + esc(Core.fmtOffset(o)) + '</button>';\n    }).join('');\n  }\n\n  function renderCheck() {\n    $('fcheck').innerHTML = form.data.checklist.map(function (c, i) {\n      return '<div class=\"ck\"><input type=\"checkbox\" data-ckd=\"' + i + '\"' + (c.d ? ' checked' : '') + '>' +\n        '<input type=\"text\" data-ckt=\"' + i + '\" value=\"' + esc(c.t) + '\" maxlength=\"200\">' +\n        '<button data-ckx=\"' + i + '\" aria-label=\"Xóa\">&times;</button></div>';\n    }).join('');\n  }\n\n  function closeForm() {\n    $('sheet').classList.add('hidden');\n    form = null;\n  }\n\n  function saveForm() {\n    if (!form) return;\n    var d = form.data;\n    var title = $('fname').value.trim();\n    var dl = Core.fromInputValue($('fdl').value);\n    if (!title) { $('fname').focus(); toast('Hãy nhập tên việc'); return; }\n    if (!dl) { $('fdl').focus(); toast('Hãy chọn hạn chót'); return; }\n    var fields = {\n      title: title, deadline: Core.toISO(dl), group: $('fgroup').value.trim().replace(/^#/, ''),\n      priority: d.priority, status: d.status, details: $('fdetails').value, notes: $('fnotes').value,\n      reminders: Core.normOffsets(d.reminders),\n      checklist: d.checklist.filter(function (c) { return c.t.trim(); })\n    };\n    var t = form.id ? state.tasks[form.id] : null;\n    if (t) {\n      var rearm = t.deadline !== fields.deadline || JSON.stringify(Core.normOffsets(t.reminders)) !== JSON.stringify(fields.reminders);\n      if (t.status !== 'done' && fields.status === 'done') t.doneAt = Date.now();\n      if (t.status === 'done' && fields.status !== 'done') t.doneAt = 0;\n      Object.keys(fields).forEach(function (k) { t[k] = fields[k]; });\n      touch(t, rearm);\n    } else {\n      t = Core.newTask(fields);\n      if (t.status === 'done') t.doneAt = Date.now();\n      touch(t, false);\n    }\n    closeForm();\n  }\n\n  var delArmed = 0;\n  function deleteForm() {\n    if (!form || !form.id) return;\n    var now = Date.now();\n    if (now - delArmed > 3000) {\n      delArmed = now;\n      $('fdel').textContent = 'Chạm lại để xóa';\n      return;\n    }\n    var t = state.tasks[form.id];\n    closeForm();\n    if (!t) return;\n    t.deleted = true;\n    touch(t, false);\n    toast('Đã xóa: ' + t.title, 'Hoàn tác', function () {\n      t.deleted = false;\n      touch(t, true);\n    });\n  }\n\n  // --------------------------------------------------------------------- toast\n  var toastTimer = null;\n  function toast(msg, actLabel, act) {\n    $('tmsg').textContent = msg;\n    var b = $('tact');\n    b.style.display = actLabel ? '' : 'none';\n    b.textContent = actLabel || '';\n    b.onclick = function () { $('toast').classList.add('hidden'); if (act) act(); };\n    $('toast').classList.remove('hidden');\n    clearTimeout(toastTimer);\n    toastTimer = setTimeout(function () { $('toast').classList.add('hidden'); }, actLabel ? 6000 : 2500);\n  }\n\n  // ------------------------------------------------------------------ sự kiện\n  function init() {\n    load();\n    render();\n    $('q').addEventListener('input', updatePreview);\n    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } });\n    $('qa').addEventListener('click', quickAdd);\n    $('fab').addEventListener('click', function () { openForm(null); });\n    $('refresh').addEventListener('click', function () { sync(); });\n    $('sync').addEventListener('click', function () { sync(); });\n    $('gf').addEventListener('change', function () { groupFilter = $('gf').value; render(); });\n    $('tabs').addEventListener('click', function (e) {\n      var b = e.target.closest('[data-tab]');\n      if (b) { tab = b.getAttribute('data-tab'); render(); }\n    });\n    $('list').addEventListener('click', function (e) {\n      var c = e.target.closest('[data-chk]');\n      if (c) { toggleDone(c.getAttribute('data-chk')); return; }\n      var o = e.target.closest('[data-open]');\n      if (o) openForm(o.getAttribute('data-open'));\n    });\n    $('fcancel').addEventListener('click', closeForm);\n    $('fsave').addEventListener('click', saveForm);\n    $('fdel').addEventListener('click', deleteForm);\n    $('fprio').addEventListener('click', function (e) {\n      var b = e.target.closest('[data-prio]');\n      if (!b || !form) return;\n      form.data.priority = Number(b.getAttribute('data-prio'));\n      if (!form.remTouched) form.data.reminders = Core.offsetsForPriority(form.data.priority);\n      renderSegs();\n      renderRem();\n    });\n    $('fstatus').addEventListener('click', function (e) {\n      var b = e.target.closest('[data-status]');\n      if (!b || !form) return;\n      form.data.status = b.getAttribute('data-status');\n      renderSegs();\n    });\n    $('frem').addEventListener('click', function (e) {\n      var b = e.target.closest('[data-rem]');\n      if (!b || !form) return;\n      var o = Number(b.getAttribute('data-rem'));\n      var cur = Core.normOffsets(form.data.reminders);\n      var i = cur.indexOf(o);\n      if (i >= 0) cur.splice(i, 1); else cur.push(o);\n      form.data.reminders = Core.normOffsets(cur);\n      form.remTouched = true;\n      renderRem();\n    });\n    $('fcadd').addEventListener('click', function () {\n      if (!form) return;\n      var n = Number($('fcn').value);\n      var u = Number($('fcu').value);\n      if (!(n > 0)) { $('fcn').focus(); return; }\n      var m = Math.round(n * u);\n      if (m > 525600) { toast('Mốc nhắc tối đa 1 năm'); return; }\n      form.data.reminders = Core.normOffsets(form.data.reminders.concat([m]));\n      form.remTouched = true;\n      $('fcn').value = '';\n      renderRem();\n    });\n    function addCheck() {\n      var v = $('fcheckadd').value.trim();\n      if (!v || !form) return;\n      form.data.checklist.push({ t: v, d: false });\n      $('fcheckadd').value = '';\n      renderCheck();\n    }\n    $('fcheckbtn').addEventListener('click', addCheck);\n    $('fcheckadd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } });\n    $('fcheck').addEventListener('change', function (e) {\n      var i = e.target.getAttribute('data-ckd');\n      if (i !== null && form) form.data.checklist[+i].d = e.target.checked;\n    });\n    $('fcheck').addEventListener('input', function (e) {\n      var i = e.target.getAttribute('data-ckt');\n      if (i !== null && form) form.data.checklist[+i].t = e.target.value;\n    });\n    $('fcheck').addEventListener('click', function (e) {\n      var x = e.target.closest('[data-ckx]');\n      if (x && form) { form.data.checklist.splice(+x.getAttribute('data-ckx'), 1); renderCheck(); }\n    });\n    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });\n    window.addEventListener('online', sync);\n    setInterval(function () { if (!document.hidden && !form) { render(); sync(); } }, 120000);\n    sync();\n  }\n\n  init();\n})();\n</script>\n</body>\n</html>\n";

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
