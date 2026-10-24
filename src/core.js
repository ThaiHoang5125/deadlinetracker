/*
 * core.js - phần lõi dùng chung cho app laptop (Electron) và web app điện thoại.
 * Không phụ thuộc Node/Electron/trình duyệt: chỉ dùng JavaScript thuần.
 *
 * Gồm: phân tích câu nhập nhanh tiếng Việt, logic mốc nhắc, phân nhóm theo hạn,
 * định dạng hiển thị, và hàm gộp dữ liệu đồng bộ.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;

  // ---------------------------------------------------------------- mốc nhắc
  var DEFAULT_OFFSETS = [10080, 4320, 1440, 180, 0]; // 1 tuần, 3 ngày, 1 ngày, 3 giờ, đúng hạn
  var PRESET_OFFSETS = [20160, 10080, 4320, 1440, 180, 60, 30, 0];

  // Ưu tiên theo thang 5 số: 1 = cao nhất ... 5 = thấp nhất. Mặc định 3.
  var DEFAULT_PRIORITY = 3;
  var OFFSETS_BY_PRIORITY = {
    1: [20160, 10080, 4320, 1440, 180, 60, 0],
    2: [10080, 4320, 1440, 180, 60, 0],
    3: DEFAULT_OFFSETS,
    4: [1440, 180, 0],
    5: [1440]
  };
  // dữ liệu cũ (và server cũ) dùng chữ: cao / trung bình / thấp
  var LEGACY_PRIORITY = { high: 1, normal: 3, low: 5 };

  function normPriority(p) {
    if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PRIORITY, p)) return LEGACY_PRIORITY[p];
    var n = Math.round(Number(p));
    return n >= 1 && n <= 5 ? n : DEFAULT_PRIORITY;
  }

  function offsetsForPriority(p) {
    return OFFSETS_BY_PRIORITY[normPriority(p)].slice();
  }

  // Các từ gõ sau dấu ! để chọn mức (ngoài số 1-5), dạng nguồn của regex
  var PRIORITY_WORDS = { 1: 'cao|c|high|h|gap|khan', 3: 'tb|trung|trungbinh|vua|normal|n', 5: 'thap|t|low|l' };

  function priorityFromWord(word) {
    if (/^[1-5]$/.test(word)) return +word;
    for (var lv in PRIORITY_WORDS) {
      if (new RegExp('^(' + PRIORITY_WORDS[lv] + ')$').test(word)) return +lv;
    }
    return null;
  }

  // Thẻ "!..." đang gõ dở ở cuối ô nhập nhanh; null nếu không có
  function bangTyping(text) {
    var m = /(^|\s)!([^\s]*)$/.exec(String(text || ''));
    return m ? { typed: m[2], start: m.index + m[1].length } : null;
  }

  // Thẻ "#..." đang gõ dở ở cuối ô nhập (cho phép nhiều từ: "#toan roi"); null nếu không có
  function hashTyping(text) {
    text = String(text || '');
    var i = text.lastIndexOf('#');
    if (i < 0 || (i > 0 && !/\s/.test(text[i - 1]))) return null;
    var typed = text.slice(i + 1);
    if (/["\[\]()!#]/.test(typed)) return null; // đã sang dạng ngoặc / đã có thẻ khác: không gợi ý nữa
    return { typed: typed, start: i };
  }

  // Danh sách mức ưu tiên kèm các mốc nhắc, để hiện gợi ý khi gõ "!".
  // match = mức khớp với phần đã gõ (số hoặc từ như "ca" -> cao)
  function priorityOptions(typed) {
    typed = fold(String(typed || ''));
    return [1, 2, 3, 4, 5].map(function (p) {
      var offs = OFFSETS_BY_PRIORITY[p];
      var words = PRIORITY_WORDS[p] ? PRIORITY_WORDS[p].split('|') : [];
      var match = !!typed && (String(p).indexOf(typed) === 0 ||
        words.some(function (w) { return w.length > 1 && w.indexOf(typed) === 0; }));
      return {
        level: p, label: PRIORITY_LABEL[p], offsets: offs.slice(), match: match,
        word: words.length ? words[0] : '',
        text: offs.map(fmtOffset).join(' · ')
      };
    });
  }

  function normOffsets(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (v) {
      var n = Math.round(Number(v));
      if (isFinite(n) && n >= 0 && n <= 525600 && !seen[n]) {
        seen[n] = true;
        out.push(n);
      }
    });
    out.sort(function (a, b) { return b - a; });
    return out.slice(0, 12);
  }

  function fmtOffset(m) {
    m = Math.round(m);
    if (m === 0) return 'Đúng hạn';
    if (m < 60) return m + ' phút';
    if (m % 10080 === 0) return m / 10080 + ' tuần';
    if (m % 1440 === 0) return m / 1440 + ' ngày';
    if (m % 60 === 0) return m / 60 + ' giờ';
    if (m > 1440) return Math.floor(m / 1440) + ' ngày ' + (m % 1440 >= 60 ? Math.round((m % 1440) / 60) + ' giờ' : '');
    return Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';
  }

  // ------------------------------------------------------------ ngày giờ
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function startOfDay(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ISO có múi giờ, ví dụ 2026-10-25T23:59:00+07:00
  function toISO(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var a = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60)
    );
  }

  // giá trị cho <input type="datetime-local">
  function toInputValue(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fromInputValue(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  var WD_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  var WD_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function fmtDeadline(iso, now) {
    var d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
    if (!d || isNaN(d.getTime())) return '';
    now = now || new Date();
    var s = WD_SHORT[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
    if (d.getFullYear() !== now.getFullYear()) s += '/' + d.getFullYear();
    return s + ' ' + fmtTime(d);
  }

  function relativeText(iso, now) {
    var d = new Date(iso);
    now = now || new Date();
    var diff = d.getTime() - now.getTime();
    var abs = Math.abs(diff);
    var txt;
    if (abs < MIN) txt = 'ngay bây giờ';
    else if (abs < HOUR) txt = Math.round(abs / MIN) + ' phút';
    else if (abs < DAY) {
      var h = Math.floor(abs / HOUR);
      var mm = Math.round((abs % HOUR) / MIN);
      txt = h + ' giờ' + (mm >= 5 && h < 6 ? ' ' + mm + ' phút' : '');
    } else {
      var days = Math.floor(abs / DAY);
      var hh = Math.round((abs % DAY) / HOUR);
      txt = days + ' ngày' + (hh > 0 && days < 4 ? ' ' + hh + ' giờ' : '');
    }
    if (abs < MIN) return txt;
    return diff >= 0 ? 'còn ' + txt : 'quá hạn ' + txt;
  }

  // ---------------------------------------------------- phân nhóm theo hạn
  function endOfWeek(now) {
    // tuần bắt đầu thứ 2, kết thúc chủ nhật 23:59:59.999
    var s = startOfDay(now);
    var dow = s.getDay(); // 0 = CN
    var untilSun = dow === 0 ? 0 : 7 - dow;
    var e = addDays(s, untilSun + 1);
    return e.getTime() - 1;
  }

  function bucketOf(task, now) {
    now = now || new Date();
    if (task.status === 'done') return 'done';
    var t = new Date(task.deadline).getTime();
    if (isNaN(t)) return 'later';
    if (t < now.getTime()) return 'overdue';
    var endToday = addDays(startOfDay(now), 1).getTime() - 1;
    if (t <= endToday) return 'today';
    if (t <= endOfWeek(now)) return 'week';
    return 'later';
  }

  function urgencyOf(task, now) {
    now = now || new Date();
    if (task.status === 'done') return 'done';
    var t = new Date(task.deadline).getTime();
    var diff = t - now.getTime();
    if (diff < 0) return 'overdue';
    if (diff < DAY) return 'critical';
    if (diff < 3 * DAY) return 'soon';
    if (diff < 7 * DAY) return 'week';
    return 'later';
  }

  function sortTasks(list, bucket) {
    var arr = list.slice();
    if (bucket === 'done') {
      arr.sort(function (a, b) { return (Number(b.doneAt) || 0) - (Number(a.doneAt) || 0); });
    } else {
      arr.sort(function (a, b) {
        var d = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        return d !== 0 ? d : String(a.title).localeCompare(String(b.title), 'vi');
      });
    }
    return arr;
  }

  function sortBy(list, mode) {
    var arr = sortTasks(list, 'open'); // nền: hạn gần nhất
    var idx = new Map(arr.map(function (t, i) { return [t, i]; }));
    var cmp = {
      priority: function (a, b) { return normPriority(a.priority) - normPriority(b.priority); },
      group: function (a, b) { return String(a.group || '\uffff').localeCompare(String(b.group || '\uffff'), 'vi'); },
      title: function (a, b) { return String(a.title).localeCompare(String(b.title), 'vi'); },
      newest: function (a, b) { return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); },
      farthest: function (a, b) { return new Date(b.deadline) - new Date(a.deadline); }
    }[mode];
    if (!cmp) return arr;
    return arr.sort(function (a, b) { return cmp(a, b) || idx.get(a) - idx.get(b); });
  }

  // ------------------------------------------------------ logic nhắc nhở
  function reminderSchedule(task) {
    var dl = new Date(task.deadline).getTime();
    if (isNaN(dl)) return [];
    return normOffsets(task.reminders).map(function (o) {
      return { offset: o, at: dl - o * MIN };
    }).sort(function (a, b) { return a.at - b.at; });
  }

  /*
   * Quyết định có cần nhắc ngay lúc này không.
   * - chỉ nhắc mốc đã tới giờ, chưa nhắc, và không phải mốc đã trôi qua trước khi việc được tạo/sửa hạn
   * - nếu có nhiều mốc cùng "đến hạn" (máy tắt/ngủ), chỉ nhắc một lần, chọn mốc gần hạn nhất
   */
  function dueNow(task, nowMs, firedOffsets) {
    var res = { fire: null, markFired: [] };
    if (!task || task.deleted || task.status === 'done') return res;
    var fired = {};
    (firedOffsets || []).forEach(function (o) { fired[o] = true; });
    var armed = Number(task.armedAt) || Number(task.createdAt) || 0;
    var candidates = [];
    reminderSchedule(task).forEach(function (r) {
      if (fired[r.offset] || r.at > nowMs) return;
      res.markFired.push(r.offset);
      if (r.at >= armed - MIN) candidates.push(r);
    });
    if (candidates.length) {
      var best = candidates[candidates.length - 1]; // at lớn nhất = gần hạn nhất
      res.fire = { offset: best.offset, at: best.at, late: nowMs - best.at > 5 * MIN };
    }
    return res;
  }

  function describeReminder(task, info, now) {
    now = now || new Date();
    var rel = relativeText(task.deadline, now);
    var title;
    if (info.snooze) title = 'Nhắc lại: ' + task.title;
    else if (info.offset === 0) title = 'Đến hạn: ' + task.title;
    else title = 'Còn ' + fmtOffset(info.offset) + ': ' + task.title;
    var parts = ['Hạn ' + fmtDeadline(task.deadline, now) + ' (' + rel + ')'];
    if (task.group) parts.push(task.group);
    if (info.late && !info.snooze) parts.unshift('Lời nhắc bị lỡ');
    return { title: title, body: parts.join(' · '), rel: rel };
  }

  // ---------------------------------------------------- phân tích nhập nhanh
  function baseChar(c) {
    if (c === 'đ') return 'd';
    if (c === 'Đ') return 'D';
    var b = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return b.length === c.length ? b : c;
  }

  function fold(s) {
    var out = '';
    for (var ch of s) out += baseChar(ch);
    return out.toLowerCase();
  }

  var PERIOD_DEFAULT_HOUR = { sang: 9, trua: 12, chieu: 17, toi: 20, dem: 23 };

  function applyPeriod(h, period) {
    if (!period) return h;
    if (period === 'sang') return h === 12 ? 0 : h;
    if (period === 'trua') return h < 10 ? h + 12 : h;
    if (period === 'chieu') return h < 12 ? h + 12 : h;
    if (period === 'toi' || period === 'dem') {
      if (h === 12) return 24;
      return h < 12 ? h + 12 : h;
    }
    if (period === 'pm') return h < 12 ? h + 12 : h;
    if (period === 'am') return h === 12 ? 0 : h;
    return h;
  }

  var WEEKDAY_WORDS = { hai: 1, ba: 2, tu: 3, nam: 4, sau: 5, bay: 6 };

  var STOP_TAIL = {
    vao: 1, luc: 1, truoc: 1, han: 1, deadline: 1, dl: 1, den: 1, ngay: 1, trong: 1,
    tai: 1, khoang: 1, kip: 1, by: 1, on: 1, at: 1, trc: 1
  };

  function parseQuick(input, nowArg, opts) {
    opts = opts || {};
    var now = nowArg ? new Date(nowArg) : new Date();
    var text = String(input || '');
    var f = fold(text);
    var lc = text.toLowerCase();
    var mask = new Array(text.length);
    for (var i = 0; i < mask.length; i++) mask[i] = false;

    function free(a, b) {
      for (var k = a; k < b; k++) if (mask[k]) return false;
      return true;
    }
    function eat(a, b) { for (var k = a; k < b; k++) mask[k] = true; }

    // chạy regex trên f, bỏ qua vùng đã dùng; hasPre = nhóm 1 là ký tự đứng trước (thay cho lookbehind)
    function find(re, hasPre, accept) {
      var r = new RegExp(re.source, 'g');
      var m;
      while ((m = r.exec(f))) {
        if (m[0].length === 0) { r.lastIndex++; continue; }
        var arr = Array.prototype.slice.call(m);
        var start = m.index;
        if (hasPre) {
          var pre = m[1] || '';
          arr.splice(1, 1);
          arr[0] = m[0].slice(pre.length);
          start += pre.length;
        }
        arr.index = start;
        if (arr[0].length && free(start, start + arr[0].length) && (!accept || accept(arr))) return arr;
        r.lastIndex = m.index + 1;
      }
      return null;
    }

    var result = { title: '', group: '', priority: DEFAULT_PRIORITY, deadline: null, hasDate: false, hasTime: false, reminders: null };

    // 1) nhóm (chỉ nhận một thẻ #; các # sau giữ nguyên trong tiêu đề):
    //    #BTL1 | #"Toán rời rạc" | #[Toán rời rạc] | #(Toán rời rạc)
    //    #toan roi rac -> khớp nhóm nhiều từ đã có
    //    #a bc         -> thẻ một từ gom thêm các từ tự do đứng ngay sau nó (xem bước 5b)
    var looseGroupEnd = -1;
    var gm = find(/#(?:"[^"]+"|\[[^\]]+\]|\([^)]+\))/);
    if (gm) {
      result.group = text.slice(gm.index + 2, gm.index + gm[0].length - 1).replace(/\s+/g, ' ').trim();
      eat(gm.index, gm.index + gm[0].length);
    } else if ((gm = find(/#([^\s#!]+)/))) {
      var gFrom = gm.index + 1;
      var gTo = gm.index + gm[0].length;
      result.group = text.slice(gFrom, gTo).replace(/_/g, ' ');
      var known = (opts.groups || []).map(function (g) { return { name: g, f: fold(g).replace(/\s+/g, ' ') }; })
        .sort(function (a, b) { return b.f.length - a.f.length; });
      for (var ki = 0; ki < known.length; ki++) {
        var kf = known[ki].f;
        if (kf.length > gTo - gFrom && f.substr(gFrom, kf.length) === kf && (gFrom + kf.length >= f.length || /\s/.test(f[gFrom + kf.length]))) {
          result.group = known[ki].name;
          gTo = gFrom + kf.length;
          break;
        }
      }
      if (gTo === gm.index + gm[0].length) looseGroupEnd = gTo;
      eat(gm.index, gTo);
    }

    // 2) ưu tiên: !1..!5 (1 = cao nhất), hoặc chữ: !cao = 1, !tb = 3, !thap = 5
    var pm;
    var guard = 0;
    while ((pm = find(/(^|\s)!([a-z0-9]+)(?=\s|$)/)) && guard++ < 5) {
      var word = pm[2];
      var p = null;
      p = priorityFromWord(word);
      if (!p) break;
      result.priority = p;
      var s0 = pm.index + pm[1].length;
      eat(s0, pm.index + pm[0].length);
    }

    // 3) ngày
    var date = null; // Date lúc 00:00
    var relDeadline = null; // hạn tính tương đối theo giờ/phút
    var today0 = startOfDay(now);

    function setDate(d, m) {
      date = d;
      eat(m.index, m.index + m[0].length);
      result.hasDate = true;
    }

    var m;

    // ISO yyyy-mm-dd
    if (!date && (m = find(/(^|[^\d/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/, true))) {
      var dd = new Date(+m[1], +m[2] - 1, +m[3]);
      if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && dd.getDate() === +m[3]) setDate(dd, m);
    }
    // dd/mm/yyyy (cho phép . - /)
    if (!date && (m = find(/(^|[^\d/.-])(?:ngay\s+)?(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})(?![\d])/, true))) {
      var y3 = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      var d3 = new Date(y3, +m[2] - 1, +m[1]);
      if (+m[2] >= 1 && +m[2] <= 12 && d3.getDate() === +m[1]) setDate(d3, m);
    }
    // dd/mm  (chỉ / và -)
    if (!date && (m = find(/(^|[^\d/.-])(?:ngay\s+)?(\d{1,2})\s*[/-]\s*(\d{1,2})(?![\d/.-])/, true))) {
      var mo = +m[2];
      var dayN = +m[1];
      if (mo >= 1 && mo <= 12 && dayN >= 1 && dayN <= 31) {
        var d2 = new Date(now.getFullYear(), mo - 1, dayN);
        if (d2.getDate() === dayN) {
          if (d2.getTime() < today0.getTime()) d2 = new Date(now.getFullYear() + 1, mo - 1, dayN);
          if (d2.getDate() === dayN) setDate(d2, m);
        }
      }
    }
    // "ngày 25 tháng 10" / "25 tháng 10"
    if (!date && (m = find(/(^|[^\d/.-])(?:ngay\s+)?(\d{1,2})\s*thang\s*(\d{1,2})(?![\d])/, true))) {
      var mo2 = +m[2];
      var dn2 = +m[1];
      if (mo2 >= 1 && mo2 <= 12 && dn2 >= 1 && dn2 <= 31) {
        var d4 = new Date(now.getFullYear(), mo2 - 1, dn2);
        if (d4.getDate() === dn2) {
          if (d4.getTime() < today0.getTime()) d4 = new Date(now.getFullYear() + 1, mo2 - 1, dn2);
          setDate(d4, m);
        }
      }
    }
    // "ngày 25" (không tháng)
    if (!date && (m = find(/ngay\s+(\d{1,2})(?![\d/:h])/))) {
      var dn3 = +m[1];
      if (dn3 >= 1 && dn3 <= 31) {
        var cand = new Date(now.getFullYear(), now.getMonth(), dn3);
        if (cand.getDate() !== dn3) cand = null;
        if (cand && cand.getTime() < today0.getTime()) {
          cand = new Date(now.getFullYear(), now.getMonth() + 1, dn3);
          if (cand.getDate() !== dn3) cand = null;
        }
        if (cand) setDate(cand, m);
      }
    }
    // tương đối: "sau 3 ngày", "3 ngày nữa", "trong 2 tuần"
    if (!date && !relDeadline) {
      var notAfterWeekWord = function (mm) {
        var before = f.slice(0, mm.index);
        if (/\b(tuan|thang|thu|ngay|nam)\s*$/.test(before) && /^(sau|trong)/.test(mm[0])) return false;
        if (/\b(thu|t)\s*$/.test(before) && /^\d/.test(mm[0])) return false;
        return true;
      };
      var rm = find(/(?:sau|trong)\s+(\d{1,3})\s*(ngay|tuan|thang|gio|phut|h)(?![a-z])/, false, notAfterWeekWord) ||
        find(/(\d{1,3})\s*(ngay|tuan|thang|gio|phut)\s+(?:nua|toi|sau)(?![a-z])/, false, notAfterWeekWord);
      if (rm) {
        var n = +rm[1];
        var unit = rm[2];
        if (unit === 'gio' || unit === 'h') {
          relDeadline = new Date(now.getTime() + n * HOUR);
        } else if (unit === 'phut') {
          relDeadline = new Date(now.getTime() + n * MIN);
        } else if (unit === 'ngay') {
          date = addDays(today0, n);
        } else if (unit === 'tuan') {
          date = addDays(today0, 7 * n);
        } else {
          date = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
        }
        eat(rm.index, rm.index + rm[0].length);
        if (relDeadline) { result.hasDate = true; result.hasTime = true; } else result.hasDate = true;
      }
    }
    // hôm nay / mai / mốt
    if (!date && !relDeadline) {
      var wm;
      if ((wm = find(/\b(?:ngay\s+)?hom\s+nay\b|\bhnay\b/)) ||
          (wm = find(/\b(?:sang|trua|chieu|toi)\s+nay\b/))) {
        // với "tối nay"... chỉ dùng phần "nay", giữ từ chỉ buổi để xử lý giờ ở bước sau
        var per = /^(sang|trua|chieu|toi)\s+nay/.exec(wm[0]);
        if (per) { eat(wm.index + per[1].length, wm.index + wm[0].length); }
        else eat(wm.index, wm.index + wm[0].length);
        date = today0;
        result.hasDate = true;
      } else if ((wm = find(/\b(?:ngay\s+|bua\s+)?mai\b/))) {
        eat(wm.index, wm.index + wm[0].length);
        date = addDays(today0, 1);
        result.hasDate = true;
      } else {
        // "mốt" phải có dấu để không nhầm với "một"
        var mr = /(^|[^\p{L}])(?:ngày\s+)?mốt(?![\p{L}])/u.exec(lc);
        if (mr) {
          var s1 = mr.index + mr[1].length;
          if (free(s1, mr.index + mr[0].length)) {
            eat(s1, mr.index + mr[0].length);
            date = addDays(today0, 2);
            result.hasDate = true;
          }
        }
      }
    }
    // thứ / tuần
    if (!date && !relDeadline) {
      var weekMod = null; // 0 = tuần này, 1 = tuần sau
      var wdm = null;
      var wday = null;
      var wmm;
      wmm = find(/\btuan\s+(nay|sau|toi)\b/);
      var cuoiTuan = find(/\bcuoi\s+tuan(?:\s+nay)?\b/);
      var chunhat = find(/\bchu\s*nhat\b|\bcn\b/);
      wdm = find(/\bthu\s*([2-7])\b/) || find(/\bt([2-7])\b/) || find(/\bthu\s+(hai|ba|tu|nam|sau|bay)\b/);
      if (wdm) {
        wday = /^\d$/.test(wdm[1]) ? +wdm[1] - 1 : WEEKDAY_WORDS[wdm[1]];
        wday = wday === 7 ? 0 : wday; // không xảy ra, giữ cho chắc
      } else if (chunhat) {
        wdm = chunhat;
        wday = 0;
      }
      if (wmm) weekMod = wmm[1] === 'nay' ? 0 : 1;
      var used = [];
      if (wdm) used.push(wdm);
      if (wmm) used.push(wmm);
      if (wday !== null) {
        var mondayThis = addDays(today0, -((today0.getDay() + 6) % 7));
        var off = (wday + 6) % 7; // T2 = 0 ... CN = 6
        if (weekMod !== null) {
          date = addDays(mondayThis, off + 7 * weekMod);
        } else {
          date = addDays(today0, 1);
          while (date.getDay() !== wday) date = addDays(date, 1);
        }
      } else if (cuoiTuan) {
        used.push(cuoiTuan);
        var mt = addDays(today0, -((today0.getDay() + 6) % 7));
        date = addDays(mt, 6);
        if (wmm && weekMod === 1) date = addDays(date, 7);
      } else if (wmm) {
        if (weekMod === 1) date = addDays(today0, 7);
        else date = addDays(addDays(today0, -((today0.getDay() + 6) % 7)), 6);
      }
      if (date) {
        used.forEach(function (u) { eat(u.index, u.index + u[0].length); });
        result.hasDate = true;
      }
    }
    // "tháng sau"
    if (!date && !relDeadline && (m = find(/\bthang\s+(sau|toi)\b/))) {
      date = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      eat(m.index, m.index + m[0].length);
      result.hasDate = true;
    }

    // 4) giờ
    var hour = null;
    var minute = 0;
    if (!relDeadline) {
      var tm;
      if ((tm = find(/(^|[^\d/.:])(\d{1,2}):(\d{2})(?![\d])\s*(am|pm)?/, true))) {
        var h1 = +tm[1];
        var mi1 = +tm[2];
        if (mi1 < 60 && h1 <= 24) {
          hour = tm[3] ? applyPeriod(h1, tm[3]) : h1;
          minute = mi1;
          eat(tm.index, tm.index + tm[0].length);
        }
      }
      if (hour === null && (tm = find(/(^|[^\d/.:])(\d{1,2})\s*(?:h|gio)(?:\s*(\d{1,2})(?![\d]))?(?![a-z0-9])(?:\s*(sang|trua|chieu|toi|dem)(?![a-z]))?/, true))) {
        var h2 = +tm[1];
        var mi2 = tm[2] ? +tm[2] : 0;
        if (h2 <= 24 && mi2 < 60 && !(h2 === 24 && mi2 > 0)) {
          hour = applyPeriod(h2, tm[3]);
          minute = mi2;
          eat(tm.index, tm.index + tm[0].length);
        }
      }
      if (hour === null && (tm = find(/(^|[^\d/.:])(\d{1,2})\s*(am|pm)(?![a-z])/, true))) {
        var h3 = +tm[1];
        if (h3 >= 1 && h3 <= 12) {
          hour = applyPeriod(h3, tm[2]);
          eat(tm.index, tm.index + tm[0].length);
        }
      }
      if (hour === null && (tm = find(/\bcuoi\s+ngay\b/))) {
        hour = 23; minute = 59;
        eat(tm.index, tm.index + tm[0].length);
      }
      if (hour === null && (tm = find(/\b(sang|trua|chieu|toi|dem)\b/))) {
        hour = PERIOD_DEFAULT_HOUR[tm[1]];
        eat(tm.index, tm.index + tm[0].length);
      }
      if (hour !== null) result.hasTime = true;
    }

    // 5) ghép ngày + giờ
    var deadline = null;
    if (relDeadline) {
      deadline = relDeadline;
    } else if (date) {
      deadline = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour === null ? 23 : hour, hour === null ? 59 : minute, 0, 0);
    } else if (hour !== null) {
      deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
      if (deadline.getTime() <= now.getTime()) deadline = addDays(deadline, 1);
      result.hasDate = true;
    }
    result.deadline = deadline;

    // 5b) nhóm nhiều từ không đặt trong ngoặc: "abc #a bc" -> nhóm "a bc".
    // Gom các từ tự do đứng liền sau thẻ, dừng ở phần đã hiểu (ngày/giờ/ưu tiên), dấu # khác hoặc hết câu.
    // Muốn viết tiếp tên việc sau nhóm thì dùng #"tên nhóm".
    if (looseGroupEnd >= 0) {
      var pos = looseGroupEnd;
      var extra = [];
      while (pos < text.length && extra.length < 3) {
        while (pos < text.length && /\s/.test(text[pos])) pos++;
        if (pos >= text.length || mask[pos] || text[pos] === '#' || text[pos] === '!') break;
        var wend = pos;
        while (wend < text.length && !/\s/.test(text[wend]) && !mask[wend]) wend++;
        extra.push({ t: text.slice(pos, wend), f: f.slice(pos, wend), a: pos, b: wend });
        pos = wend;
      }
      while (extra.length && STOP_TAIL[extra[extra.length - 1].f.replace(/[.,;:]+$/, '')] === 1) extra.pop();
      var joined = result.group + ' ' + extra.map(function (w) { return w.t; }).join(' ');
      if (extra.length && joined.length <= 60) {
        result.group = joined.replace(/[\s,;:]+$/, '');
        eat(looseGroupEnd, extra[extra.length - 1].b);
      }
    }

    // 6) tiêu đề: phần còn lại
    var words = [];
    var cur = '';
    var curFold = '';
    for (var k = 0; k < text.length; k++) {
      if (mask[k]) {
        if (cur) { words.push({ t: cur, f: curFold }); cur = ''; curFold = ''; }
        continue;
      }
      var c = text[k];
      if (/\s/.test(c)) {
        if (cur) { words.push({ t: cur, f: curFold }); cur = ''; curFold = ''; }
      } else { cur += c; curFold += f[k]; }
    }
    if (cur) words.push({ t: cur, f: curFold });
    // bỏ từ nối thừa ở cuối: "vào", "lúc", "trước", "hạn", "deadline"
    while (words.length > 1 && STOP_TAIL[words[words.length - 1].f.replace(/[.,;:]+$/, '')] === 1) words.pop();
    while (words.length && /^[,;:.\-–—]+$/.test(words[words.length - 1].t)) words.pop();
    result.title = words.map(function (w) { return w.t; }).join(' ').replace(/[\s,;:]+$/, '').trim();

    // 7) khớp nhóm đã có (không phân biệt hoa thường/dấu)
    if (result.group && opts.groups && opts.groups.length) {
      var gf = fold(result.group);
      for (var gi = 0; gi < opts.groups.length; gi++) {
        if (fold(opts.groups[gi]) === gf) { result.group = opts.groups[gi]; break; }
      }
    }

    result.reminders = offsetsForPriority(result.priority);
    return result;
  }

  // ----------------------------------------------------------- dữ liệu việc
  function makeId() {
    var s = '';
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 't' + Date.now().toString(36) + s;
  }

  function newTask(fields, nowMs) {
    nowMs = nowMs || Date.now();
    var t = {
      id: fields.id || makeId(),
      title: String(fields.title || '').trim(),
      details: fields.details || '',
      notes: fields.notes || '',
      group: fields.group || '',
      priority: normPriority(fields.priority),
      status: fields.status || 'todo',
      deadline: fields.deadline,
      reminders: normOffsets(fields.reminders || offsetsForPriority(fields.priority)),
      checklist: fields.checklist || [],
      eventId: '',
      createdAt: nowMs,
      updatedAt: nowMs,
      armedAt: nowMs,
      deleted: false,
      doneAt: 0
    };
    return t;
  }

  // Gộp danh sách từ server vào dữ liệu cục bộ (dùng chung cho laptop & điện thoại)
  function mergeServer(local, serverList, sent) {
    var out = {};
    var seen = {};
    sent = sent || {};
    serverList.forEach(function (s) {
      seen[s.id] = true;
      var l = local[s.id];
      if (l && l._dirty && (!(s.id in sent) || Number(l.updatedAt) > Number(sent[s.id]))) {
        out[s.id] = Number(s.updatedAt) > Number(l.updatedAt) ? s : l;
      } else {
        out[s.id] = s;
      }
    });
    Object.keys(local).forEach(function (id) {
      if (!seen[id] && local[id]._dirty) out[id] = local[id];
    });
    return out;
  }

  function groupsOf(tasks) {
    var seen = {};
    var out = [];
    tasks.forEach(function (t) {
      if (t.group && !t.deleted && !seen[t.group]) { seen[t.group] = true; out.push(t.group); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'vi'); });
  }

  // Nhóm kèm số việc đang mở, để hiện trong menu gợi ý
  // extras: các nhóm tạo sẵn nhưng chưa có việc nào (chỉ lưu trên máy này)
  function groupStats(tasks, extras) {
    var counts = {};
    var total = {};
    tasks.forEach(function (t) {
      if (t.group && !t.deleted) {
        total[t.group] = (total[t.group] || 0) + 1;
        counts[t.group] = (counts[t.group] || 0) + (t.status === 'done' ? 0 : 1);
      }
    });
    var names = groupsOf(tasks);
    (extras || []).forEach(function (n) { if (n && names.indexOf(n) < 0) names.push(n); });
    names.sort(function (a, b) { return a.localeCompare(b, 'vi'); });
    return names.map(function (n) { return { name: n, count: counts[n] || 0, total: total[n] || 0 }; });
  }

  // Việc đang mở có cùng hạn (tính đến phút) với hạn vừa nhập
  function findDuplicates(tasks, deadline, excludeId) {
    var d = deadline instanceof Date ? deadline : new Date(deadline);
    if (!deadline || isNaN(d.getTime())) return [];
    var key = Math.floor(d.getTime() / MIN);
    return tasks.filter(function (t) {
      return !t.deleted && t.status !== 'done' && t.id !== excludeId &&
        Math.floor(new Date(t.deadline).getTime() / MIN) === key;
    });
  }

  function dupText(dups, title) {
    if (!dups.length) return '';
    var f = fold(title || '');
    var same = !!f && dups.some(function (t) { return fold(t.title) === f; });
    var names = dups.slice(0, 2).map(function (t) { return '«' + t.title + '»'; }).join(', ') +
      (dups.length > 2 ? ' và ' + (dups.length - 2) + ' việc khác' : '');
    return (same ? 'Có công việc trùng (cùng tên, cùng hạn): ' : 'Có công việc trùng hạn: ') + names;
  }

  var GROUP_COLORS = [
    '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316',
    '#ef4444', '#ec4899', '#a855f7', '#64748b'
  ];

  function groupColor(name) {
    if (!name) return '#94a3b8';
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return GROUP_COLORS[h % GROUP_COLORS.length];
  }

  var PRIORITY_LABEL = { 1: 'Rất cao', 2: 'Cao', 3: 'Trung bình', 4: 'Thấp', 5: 'Rất thấp' };
  var STATUS_LABEL = { todo: 'Chưa làm', doing: 'Đang làm', done: 'Xong' };

  return {
    MIN: MIN, HOUR: HOUR, DAY: DAY,
    DEFAULT_OFFSETS: DEFAULT_OFFSETS, PRESET_OFFSETS: PRESET_OFFSETS, DEFAULT_PRIORITY: DEFAULT_PRIORITY,
    normPriority: normPriority, offsetsForPriority: offsetsForPriority,
    bangTyping: bangTyping, hashTyping: hashTyping, priorityOptions: priorityOptions,
    groupStats: groupStats, findDuplicates: findDuplicates, dupText: dupText, priorityFromWord: priorityFromWord, normOffsets: normOffsets, fmtOffset: fmtOffset,
    toISO: toISO, toInputValue: toInputValue, fromInputValue: fromInputValue,
    startOfDay: startOfDay, addDays: addDays, dayKey: dayKey,
    fmtDeadline: fmtDeadline, fmtTime: fmtTime, relativeText: relativeText,
    WD_SHORT: WD_SHORT, WD_LONG: WD_LONG,
    bucketOf: bucketOf, urgencyOf: urgencyOf, sortTasks: sortTasks, sortBy: sortBy, endOfWeek: endOfWeek,
    reminderSchedule: reminderSchedule, dueNow: dueNow, describeReminder: describeReminder,
    parseQuick: parseQuick, fold: fold,
    makeId: makeId, newTask: newTask, mergeServer: mergeServer, groupsOf: groupsOf,
    groupColor: groupColor, PRIORITY_LABEL: PRIORITY_LABEL, STATUS_LABEL: STATUS_LABEL
  };
});
