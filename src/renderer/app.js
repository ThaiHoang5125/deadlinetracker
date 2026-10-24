(function () {
  'use strict';
  var C = window.Core;
  var api = window.api;

  var S = { tasks: [], groups: [], sync: {}, settings: {} };
  var tab = 'open';
  var groupFilter = '';
  var search = '';
  var form = null;
  var prio = null;
  var info = {};
  var sortMode = 'deadline';
  try { sortMode = localStorage.getItem('sortMode') || 'deadline'; } catch (e) { /* bỏ qua */ }
  var SORT_KEYS = { 1: 'deadline', 2: 'priority', 3: 'group', 4: 'newest', 5: 'title', 6: 'farthest' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var COLORS = { overdue: 'var(--c-overdue)', critical: 'var(--c-critical)', soon: 'var(--c-soon)', week: 'var(--c-week)', later: 'var(--c-later)', done: 'var(--c-done)' };
  var TABS = [
    ['open', 'Tất cả'], ['overdue', 'Quá hạn'], ['today', 'Hôm nay'],
    ['week', 'Tuần này'], ['later', 'Sắp tới'], ['done', 'Đã xong']
  ];

  // ------------------------------------------------------------------ toast
  var toastTimer = null;
  function toast(msg, actLabel, act) {
    $('tmsg').textContent = msg;
    var b = $('tact');
    b.style.display = actLabel ? '' : 'none';
    b.textContent = actLabel || '';
    b.onclick = function () { $('toast').classList.add('hidden'); if (act) act(); };
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').classList.add('hidden'); }, actLabel ? 7000 : 2600);
  }

  function fail(e) { toast((e && e.message) || 'Có lỗi xảy ra'); }

  // ---------------------------------------------------------------- danh sách
  function inTab(t, name, now) {
    var b = C.bucketOf(t, now);
    return name === 'open' ? b !== 'done' : b === name;
  }

  function render() {
    var now = new Date();
    var gf = $('gf');
    gf.innerHTML = '<option value="">Tất cả nhóm</option>' + S.groups.map(function (g) {
      return '<option value="' + esc(g) + '"' + (g === groupFilter ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');
    if (groupFilter && S.groups.indexOf(groupFilter) < 0) groupFilter = '';

    var q = C.fold(search.trim());
    var pool = S.tasks.filter(function (t) {
      if (groupFilter && t.group !== groupFilter) return false;
      if (q && C.fold(t.title + ' ' + t.group + ' ' + t.details + ' ' + t.notes).indexOf(q) < 0) return false;
      return true;
    });

    $('tabs').innerHTML = TABS.map(function (x) {
      var n = pool.filter(function (t) { return inTab(t, x[0], now); }).length;
      return '<button class="tab' + (tab === x[0] ? ' on' : '') + '" data-tab="' + x[0] + '">' + x[1] + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('');

    var tabItems = pool.filter(function (t) { return inTab(t, tab, now); });
    var items = tab === 'done' ? C.sortTasks(tabItems, 'done') : C.sortBy(tabItems, sortMode);
    $('sortsel').value = sortMode;
    if (!items.length) {
      var msg = tab === 'done' ? 'Chưa có việc nào hoàn thành.' : (S.tasks.length ? 'Không có việc nào ở mục này.' : 'Chưa có việc nào.');
      var sub = S.tasks.length ? '' : 'Gõ vào ô phía trên, ví dụ: <i>Nộp báo cáo #BTL1 thứ 6 17h</i>, rồi nhấn Enter.';
      $('list').innerHTML = '<div class="empty"><b>' + msg + '</b>' + sub + '</div>';
    } else {
      $('list').innerHTML = items.map(function (t) {
        var u = C.urgencyOf(t, now);
        var ck = t.checklist && t.checklist.length ? t.checklist.filter(function (c) { return c.d; }).length + '/' + t.checklist.length : '';
        var done = t.status === 'done';
        return '<div class="row' + (done ? ' done' : '') + '" data-id="' + esc(t.id) + '">' +
          '<div class="bar" style="background:' + COLORS[u] + '"></div>' +
          '<button class="chk" data-act="done" title="' + (done ? 'Đánh dấu chưa xong' : 'Đánh dấu xong') + '">' + (done ? '&#10003;' : '') + '</button>' +
          '<div class="rbody"><div class="rtitle">' + esc(t.title) + '</div><div class="rmeta">' +
          (t.group ? '<span class="chip" style="background:' + C.groupColor(t.group) + '">' + esc(t.group) + '</span>' : '') +
          '<span>' + esc(C.fmtDeadline(t.deadline, now)) + '</span>' +
          (done ? '' : '<span class="rel" style="color:' + COLORS[u] + '">' + esc(C.relativeText(t.deadline, now)) + '</span>') +
          (C.normPriority(t.priority) < 3 ? '<span style="color:var(--c-overdue)">&#9873; Ưu tiên ' + C.normPriority(t.priority) + '</span>' : '') +
          (C.normPriority(t.priority) > 3 ? '<span>Ưu tiên ' + C.normPriority(t.priority) + '</span>' : '') +
          (t.status === 'doing' ? '<span>Đang làm</span>' : '') +
          (ck ? '<span>&#9745; ' + ck + '</span>' : '') +
          '</div></div>' +
          '<div class="racts">' + (done ? '' : '<button data-act="snooze" title="Nhắc lại sau 1 giờ">Nhắc lại 1h</button>') + '<button data-act="del" title="Xóa">Xóa</button></div>' +
          '</div>';
      }).join('');
    }
    renderStatus();
  }

  function renderStatus() {
    var s = S.sync || {};
    var dot = $('syncdot');
    dot.className = 'dot ' + (s.status || '');
    var txt;
    var pending = s.pending ? ' · ' + s.pending + ' thay đổi chờ gửi' : '';
    if (!s.linked) txt = 'Chưa kết nối Google — dữ liệu chỉ lưu trên máy này và chưa có nhắc trên Calendar/điện thoại';
    else if (s.status === 'syncing') txt = 'Đang đồng bộ…';
    else if (s.status === 'offline') txt = 'Đang offline' + pending + ' — sẽ tự gửi khi có mạng';
    else if (s.status === 'error') txt = 'Lỗi đồng bộ: ' + (s.error || '') + pending;
    else if (s.lastSync) txt = 'Đã đồng bộ lúc ' + C.fmtTime(new Date(s.lastSync)) + pending;
    else txt = 'Chưa đồng bộ' + pending;
    $('synctext').textContent = txt;
    $('syncbtn').disabled = !s.linked || s.status === 'syncing';
  }

  function applyState(st) {
    S = st;
    render();
    if (!$('settings').classList.contains('hidden')) renderSettingsState();
    if (!$('groupsm').classList.contains('hidden') && gmEditing === null) renderGroups();
    if (form && form.id && !S.tasks.some(function (t) { return t.id === form.id; })) closeDrawer();
  }

  // -------------------------------------------------------------- nhập nhanh
  function parseNow(text) {
    return C.parseQuick(text, new Date(), { groups: S.groups });
  }

  function updatePreview() {
    var v = $('q').value.trim();
    var el = $('preview');
    if (!v) { el.innerHTML = ''; return; }
    var r = parseNow(v);
    var parts = ['<b>' + esc(r.title || '(chưa có tên)') + '</b>'];
    if (r.group) parts.push('#' + esc(r.group));
    if (r.priority !== C.DEFAULT_PRIORITY) parts.push('ưu tiên ' + r.priority + ' (' + esc(C.PRIORITY_LABEL[r.priority].toLowerCase()) + ')');
    if (r.deadline) parts.push(esc(C.fmtDeadline(r.deadline)) + ' (' + esc(C.relativeText(r.deadline)) + ')');
    var dup = r.deadline ? C.dupText(C.findDuplicates(S.tasks, r.deadline), r.title) : '';
    var iss = r.issues.map(function (i) {
      return '<div class="' + (i.level === 'error' ? 'warn' : 'dup') + '">' + (i.level === 'error' ? '✖ ' : '⚠ ') + esc(i.text) + '</div>';
    }).join('');
    if (C.hasError(r.issues)) iss += '<div class="warn">Enter sẽ mở form để sửa</div>';
    el.innerHTML = '→ ' + parts.join(' · ') + iss + (dup ? '<div class="dup">⚠ ' + esc(dup) + '</div>' : '');
  }

  function quickAdd(forceForm) {
    var v = $('q').value.trim();
    if (!v) { if (forceForm) openDrawer(null); return; }
    if (forceForm) {
      var r = parseNow(v);
      $('q').value = '';
      updatePreview();
      openDrawer(null, { title: r.title, group: r.group, priority: r.priority, deadline: r.deadline ? C.toISO(r.deadline) : '' });
      return;
    }
    api.quickAdd(v).then(function (res) {
      $('q').value = '';
      updatePreview();
      prio.update();
      if (res.needsForm) {
        openDrawer(null, res.draft);
        if (res.issues && res.issues.length) toast(res.issues[0].text);
        return;
      }
      toast('Đã thêm: ' + res.task.title);
    }).catch(fail);
  }

  // -------------------------------------------------------------------- form
  function openDrawer(id, draft) {
    var t = null;
    if (id) t = S.tasks.filter(function (x) { return x.id === id; })[0] || null;
    var d;
    if (t) d = JSON.parse(JSON.stringify(t));
    else {
      var pf = draft || {};
      var dl = pf.deadline ? new Date(pf.deadline) : (function () { var x = C.addDays(C.startOfDay(new Date()), 1); x.setHours(23, 59, 0, 0); return x; })();
      d = {
        title: pf.title || '', details: '', notes: '', group: pf.group || '', priority: C.normPriority(pf.priority),
        status: 'todo', deadline: C.toISO(dl), reminders: C.offsetsForPriority(pf.priority), checklist: []
      };
    }
    d.priority = C.normPriority(d.priority);
    form = { id: t ? t.id : '', data: d, remTouched: !!t };
    $('dtitle').textContent = t ? 'Sửa việc' : 'Việc mới';
    $('fname').value = d.title;
    $('fdl').value = C.toInputValue(new Date(d.deadline));
    $('fgroup').value = d.group;
    $('fdetails').value = d.details || '';
    $('fnotes').value = d.notes || '';
    $('fdel').style.display = t ? '' : 'none';
    $('glist').innerHTML = S.groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('');
    renderSegs();
    renderRem();
    renderCheck();
    $('scrim').classList.remove('hidden');
    $('drawer').classList.remove('hidden');
    checkDup();
    $('fname').focus();
    if (!t && d.title) $('fdl').focus();
  }

  function checkDup() {
    var el = $('fdup');
    if (!form) { el.classList.add('hidden'); return; }
    var dl = C.fromInputValue($('fdl').value);
    var txt = dl ? C.dupText(C.findDuplicates(S.tasks, dl, form.id), $('fname').value) : '';
    el.textContent = txt ? '⚠ ' + txt : '';
    el.classList.toggle('hidden', !txt);
  }

  function closeDrawer() {
    $('drawer').classList.add('hidden');
    $('scrim').classList.add('hidden');
    form = null;
  }

  function renderSegs() {
    var d = form.data;
    $('fprio').innerHTML = [1, 2, 3, 4, 5].map(function (p) {
      return '<button data-prio="' + p + '" title="' + C.PRIORITY_LABEL[p] + '" class="' + (d.priority === p ? 'on' : '') + '">' + p + '</button>';
    }).join('');
    $('fpriohint').textContent = '— ' + d.priority + ' · ' + C.PRIORITY_LABEL[d.priority].toLowerCase() + ' (1 = cao nhất, 5 = thấp nhất)';
    $('fstatus').innerHTML = ['todo', 'doing', 'done'].map(function (s) {
      return '<button data-status="' + s + '" class="' + (d.status === s ? 'on' : '') + '">' + C.STATUS_LABEL[s] + '</button>';
    }).join('');
  }

  function renderRem() {
    var sel = C.normOffsets(form.data.reminders);
    var all = C.normOffsets(C.PRESET_OFFSETS.concat(sel));
    $('frem').innerHTML = all.map(function (o) {
      return '<button class="rchip' + (sel.indexOf(o) >= 0 ? ' on' : '') + '" data-rem="' + o + '">' + esc(C.fmtOffset(o)) + '</button>';
    }).join('');
  }

  function renderCheck() {
    $('fcheck').innerHTML = form.data.checklist.map(function (c, i) {
      return '<div class="ck"><input type="checkbox" data-ckd="' + i + '"' + (c.d ? ' checked' : '') + '>' +
        '<input type="text" data-ckt="' + i + '" value="' + esc(c.t) + '" maxlength="200">' +
        '<button data-ckx="' + i + '" title="Xóa">&times;</button></div>';
    }).join('');
  }

  function saveForm() {
    if (!form) return;
    var d = form.data;
    var title = $('fname').value.trim();
    var dl = C.fromInputValue($('fdl').value);
    if (!title) { $('fname').focus(); toast('Hãy nhập tên việc'); return; }
    if (!dl) { $('fdl').focus(); toast('Hãy chọn hạn chót'); return; }
    if (!form.id && d.status !== 'done' && dl.getTime() <= Date.now()) { $('fdl').focus(); toast('Hạn chót đã qua, hãy chọn thời điểm trong tương lai'); return; }
    var fields = {
      title: title, deadline: C.toISO(dl), group: $('fgroup').value.trim().replace(/^#/, ''),
      priority: d.priority, status: d.status, details: $('fdetails').value, notes: $('fnotes').value,
      reminders: C.normOffsets(d.reminders),
      checklist: d.checklist.filter(function (c) { return c.t.trim(); })
    };
    var p = form.id ? api.updateTask(form.id, fields) : api.addTask(fields);
    p.then(function () { closeDrawer(); }).catch(fail);
  }

  function deleteTask(id) {
    api.deleteTask(id).then(function () {
      toast('Đã xóa', 'Hoàn tác', function () { api.restoreTask(id).catch(fail); });
    }).catch(fail);
  }

  // ---------------------------------------------------------------- cài đặt
  function openSettings() {
    $('settings').classList.remove('hidden');
    $('smsg').textContent = '';
    $('smsg').className = 'msg';
    $('slink').value = '';
    $('skey').value = '';
    renderSettingsState();
    api.getInfo().then(function (i) {
      info = i;
      $('sinfo').textContent = 'Phiên bản ' + i.version + ' · Dữ liệu cục bộ: ' + i.dataFile;
      $('shotkey').textContent = (i.shortcutOk ? 'Thêm nhanh: Ctrl+Alt+N' : 'Không đăng ký được Ctrl+Alt+N (app khác đang dùng)') + ' · ' + (i.shortcutListOk ? 'Xem danh sách: Ctrl+Alt+L' : 'Không đăng ký được Ctrl+Alt+L (app khác đang dùng)');
    }).catch(function () {});
  }

  function renderSettingsState() {
    var s = S.sync || {};
    $('linkstate').textContent = s.linked ? 'Đã kết nối với Google (' + (S.linkHost || '') + '). Dán link mới bên dưới nếu muốn đổi.' : 'Chưa kết nối. Làm theo HUONG-DAN.md để tạo Web app, rồi dán link vào đây.';
    $('sdisconnect').style.display = s.linked ? '' : 'none';
    var st = S.settings || {};
    $('sstyle').value = st.reminderStyle || 'card';
    $('sdigest').checked = !!st.digest;
    $('sauto').checked = !!st.autostart;
    var h = $('sdigesth');
    if (!h.options.length) {
      for (var i = 5; i <= 11; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i + ':00'; h.appendChild(o); }
    }
    h.value = st.digestHour || 8;
  }

  // ------------------------------------------------------------ quản lý nhóm
  var gmEditing = null; // tên nhóm đang đổi tên
  var gmArmed = ''; // nhóm đang chờ bấm lần hai để xóa
  var gmArmTimer = null;

  function gmMsg(text, kind) { $('gmmsg').textContent = text || ''; $('gmmsg').className = 'msg ' + (kind || ''); }

  function renderGroups() {
    var st = S.groupStats || C.groupStats(S.tasks);
    if (!st.length) { $('gmlist').innerHTML = '<div class="gm-empty">Chưa có nhóm nào. Gõ tên ở ô phía trên rồi bấm Thêm, hoặc dùng #tên khi nhập việc.</div>'; return; }
    $('gmlist').innerHTML = st.map(function (g) {
      var n = esc(g.name);
      var open = g.count + ' đang mở' + (g.total > g.count ? ' · ' + (g.total - g.count) + ' xong' : '');
      if (gmEditing === g.name) {
        return '<div class="gm-row" data-name="' + n + '"><span class="gm-dot" style="background:' + C.groupColor(g.name) + '"></span>' +
          '<input class="in" id="gmedit" maxlength="60" value="' + n + '" spellcheck="false">' +
          '<button class="btn primary" data-gact="save">Lưu</button><button class="btn" data-gact="cancel">Hủy</button></div>';
      }
      return '<div class="gm-row" data-name="' + n + '"><span class="gm-dot" style="background:' + C.groupColor(g.name) + '"></span>' +
        '<span class="gm-name" title="' + n + '">' + n + '</span><span class="gm-n">' + open + '</span>' +
        '<button class="btn" data-gact="ren">Đổi tên</button>' +
        '<button class="btn danger" data-gact="del">' + (gmArmed === g.name ? 'Chạm lại để xóa' : 'Xóa') + '</button></div>';
    }).join('');
    if (gmEditing !== null) { var ed = $('gmedit'); if (ed) { ed.focus(); ed.select(); } }
  }

  function openGroups() {
    gmEditing = null; gmArmed = '';
    gmMsg('');
    $('gmnew').value = '';
    $('groupsm').classList.remove('hidden');
    renderGroups();
    $('gmnew').focus();
  }

  function closeGroups() { $('groupsm').classList.add('hidden'); gmEditing = null; gmArmed = ''; }

  function gmAdd() {
    var v = $('gmnew').value;
    if (!v.trim()) { $('gmnew').focus(); return; }
    api.addGroup(v).then(function (r) { $('gmnew').value = ''; gmMsg('Đã thêm nhóm "' + r.name + '"', 'ok'); renderGroups(); })
      .catch(function (e) { gmMsg(e.message, 'err'); });
  }

  function gmSaveRename(from) {
    var to = ($('gmedit') || {}).value || '';
    api.renameGroup(from, to).then(function (r) {
      gmEditing = null;
      gmMsg(r.changed === 0 && r.name === from ? '' : (r.merged ? 'Đã gộp vào nhóm "' + r.name + '"' : 'Đã đổi tên thành "' + r.name + '"') + (r.changed ? ' · ' + r.changed + ' việc' : ''), 'ok');
      renderGroups();
    }).catch(function (e) { gmMsg(e.message, 'err'); });
  }

  function gmDelete(name) {
    gmArmed = ''; clearTimeout(gmArmTimer);
    api.deleteGroup(name).then(function (r) {
      renderGroups();
      gmMsg('Đã xóa nhóm "' + name + '"' + (r.ids.length ? ' · ' + r.ids.length + ' việc không còn nhóm' : ''), 'ok');
      toast('Đã xóa nhóm "' + name + '"', 'Hoàn tác', function () {
        // nhóm có việc: gán lại nhóm cho các việc đó; nhóm trống: tạo lại nhóm trống
        (r.ids.length ? api.assignGroup(r.ids, name) : api.addGroup(name)).catch(fail);
      });
    }).catch(function (e) { gmMsg(e.message, 'err'); });
  }

  function setMsg(text, kind) { $('smsg').textContent = text; $('smsg').className = 'msg ' + (kind || ''); }

  // ------------------------------------------------------------------ sự kiện
  function bind() {
    $('q').addEventListener('input', updatePreview);
    prio = QuickMenu.attach({ input: $('q'), host: document.querySelector('.top'), groups: function () { return S.groupStats || C.groupStats(S.tasks); } });
    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); quickAdd(e.ctrlKey || e.shiftKey); }
      if (e.key === 'Tab' && $('q').value.trim() && !e.shiftKey) { e.preventDefault(); quickAdd(true); }
    });
    $('qa').addEventListener('click', function () { quickAdd(false); });
    $('qf').addEventListener('click', function () { quickAdd(true); });
    $('gf').addEventListener('change', function () { groupFilter = $('gf').value; render(); });
    $('search').addEventListener('input', function () { search = $('search').value; render(); });
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { tab = b.getAttribute('data-tab'); render(); }
    });
    $('list').addEventListener('click', function (e) {
      var row = e.target.closest('.row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      var act = e.target.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'done') api.toggleDone(id).catch(fail);
        else if (a === 'snooze') api.snooze(id, 60).then(function () { toast('Sẽ nhắc lại sau 1 giờ'); }).catch(fail);
        else if (a === 'del') deleteTask(id);
        return;
      }
      openDrawer(id);
    });
    $('syncbtn').addEventListener('click', function () {
      api.syncNow().then(function (r) { if (!r.ok) toast(r.error || 'Đồng bộ thất bại'); else if (r.calendarError) toast('Đã đồng bộ, nhưng Calendar báo lỗi: ' + r.calendarError); }).catch(fail);
    });
    $('settingsbtn').addEventListener('click', openSettings);
    $('gmbtn').addEventListener('click', openGroups);
    $('gmclose').addEventListener('click', closeGroups);
    $('groupsm').addEventListener('mousedown', function (e) { if (e.target === $('groupsm')) closeGroups(); });
    $('gmadd').addEventListener('click', gmAdd);
    $('gmnew').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); gmAdd(); } });
    $('gmlist').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gact]');
      var row = e.target.closest('.gm-row');
      if (!b || !row) return;
      var name = row.getAttribute('data-name');
      var a = b.getAttribute('data-gact');
      if (a === 'ren') { gmEditing = name; gmArmed = ''; renderGroups(); }
      else if (a === 'cancel') { gmEditing = null; renderGroups(); }
      else if (a === 'save') gmSaveRename(name);
      else if (a === 'del') {
        if (gmArmed === name) gmDelete(name);
        else { gmArmed = name; renderGroups(); clearTimeout(gmArmTimer); gmArmTimer = setTimeout(function () { gmArmed = ''; renderGroups(); }, 3000); }
      }
    });
    $('gmlist').addEventListener('keydown', function (e) {
      if (e.target.id !== 'gmedit') return;
      var name = e.target.closest('.gm-row').getAttribute('data-name');
      if (e.key === 'Enter') { e.preventDefault(); gmSaveRename(name); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); gmEditing = null; renderGroups(); }
    });
    $('sclose').addEventListener('click', function () { $('settings').classList.add('hidden'); });
    $('settings').addEventListener('mousedown', function (e) { if (e.target === $('settings')) $('settings').classList.add('hidden'); });

    $('fdl').addEventListener('input', checkDup);
    $('fname').addEventListener('input', checkDup);
    $('dclose').addEventListener('click', closeDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    $('fsave').addEventListener('click', saveForm);
    $('fdel').addEventListener('click', function () { if (form && form.id) { var id = form.id; closeDrawer(); deleteTask(id); } });
    $('fprio').addEventListener('click', function (e) {
      var b = e.target.closest('[data-prio]');
      if (!b || !form) return;
      form.data.priority = Number(b.getAttribute('data-prio'));
      if (!form.remTouched) form.data.reminders = C.offsetsForPriority(form.data.priority);
      renderSegs(); renderRem();
    });
    $('fstatus').addEventListener('click', function (e) {
      var b = e.target.closest('[data-status]');
      if (!b || !form) return;
      form.data.status = b.getAttribute('data-status');
      renderSegs();
    });
    $('frem').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rem]');
      if (!b || !form) return;
      var o = Number(b.getAttribute('data-rem'));
      var cur = C.normOffsets(form.data.reminders);
      var i = cur.indexOf(o);
      if (i >= 0) cur.splice(i, 1); else cur.push(o);
      form.data.reminders = C.normOffsets(cur);
      form.remTouched = true;
      renderRem();
    });
    $('fcadd').addEventListener('click', function () {
      if (!form) return;
      var n = Number($('fcn').value);
      var u = Number($('fcu').value);
      if (!(n > 0)) { $('fcn').focus(); return; }
      var m = Math.round(n * u);
      if (m > 525600) { toast('Mốc nhắc tối đa 1 năm'); return; }
      form.data.reminders = C.normOffsets(form.data.reminders.concat([m]));
      form.remTouched = true;
      $('fcn').value = '';
      renderRem();
    });
    $('fcn').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('fcadd').click(); } });
    function addCheck() {
      var v = $('fcheckadd').value.trim();
      if (!v || !form) return;
      form.data.checklist.push({ t: v, d: false });
      $('fcheckadd').value = '';
      renderCheck();
    }
    $('fcheckbtn').addEventListener('click', addCheck);
    $('fcheckadd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } });
    $('fcheck').addEventListener('change', function (e) {
      var i = e.target.getAttribute('data-ckd');
      if (i !== null && form) form.data.checklist[+i].d = e.target.checked;
    });
    $('fcheck').addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-ckt');
      if (i !== null && form) form.data.checklist[+i].t = e.target.value;
    });
    $('fcheck').addEventListener('click', function (e) {
      var x = e.target.closest('[data-ckx]');
      if (x && form) { form.data.checklist.splice(+x.getAttribute('data-ckx'), 1); renderCheck(); }
    });

    $('sconnect').addEventListener('click', function () {
      var link = $('slink').value.trim();
      if (!link) { setMsg('Hãy dán link Web app.', 'err'); return; }
      setMsg('Đang kết nối…');
      $('sconnect').disabled = true;
      api.connect(link, $('skey').value.trim()).then(function (r) {
        if (r.ok) { setMsg('Kết nối thành công. Dữ liệu đã được đồng bộ.', 'ok'); $('slink').value = ''; $('skey').value = ''; }
        else setMsg(r.error || 'Kết nối thất bại', 'err');
      }).catch(function (e) { setMsg(e.message, 'err'); }).then(function () { $('sconnect').disabled = false; });
    });
    $('sdisconnect').addEventListener('click', function () {
      api.disconnect().then(function () { setMsg('Đã ngắt kết nối. Dữ liệu trên máy vẫn còn.', 'ok'); }).catch(fail);
    });
    $('sstyle').addEventListener('change', function () { api.setSettings({ reminderStyle: $('sstyle').value }).catch(fail); });
    $('sdigest').addEventListener('change', function () { api.setSettings({ digest: $('sdigest').checked }).catch(fail); });
    $('sdigesth').addEventListener('change', function () { api.setSettings({ digestHour: Number($('sdigesth').value) }).catch(fail); });
    $('sauto').addEventListener('change', function () { api.setSettings({ autostart: $('sauto').checked }).catch(fail); });
    $('stest').addEventListener('click', function () { api.testNotification().catch(fail); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('groupsm').classList.contains('hidden')) closeGroups();
        else if (!$('settings').classList.contains('hidden')) $('settings').classList.add('hidden');
        else if (form) closeDrawer();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && form) {
        e.preventDefault(); saveForm();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault(); $('q').focus(); $('q').select();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault(); $('search').focus();
      }
    });

    api.onOpenTask(function (id) { setTab('open'); openDrawer(id); });
    api.onOpenDraft(function (draft) { openDrawer(null, draft); });
    api.onState(applyState);
    api.onShowList(function () {
      setTab('open'); $('search').value = ''; search = ''; groupFilter = ''; render();
      $('list').scrollTop = 0;
    });
    $('sortsel').addEventListener('change', function () {
      sortMode = $('sortsel').value;
      try { localStorage.setItem('sortMode', sortMode); } catch (e) { /* bỏ qua */ }
      render();
    });
    document.addEventListener('keydown', function (e) {
      var el = document.activeElement;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (form) return;
      if (SORT_KEYS[e.key]) {
        sortMode = SORT_KEYS[e.key];
        try { localStorage.setItem('sortMode', sortMode); } catch (e2) { /* bỏ qua */ }
        render();
      }
    });
    window.addEventListener('focus', function () { render(); });
    setInterval(function () { if (!form) render(); }, 60 * 1000);
  }

  function setTab(t) { tab = t; render(); }

  function init() {
    bind();
    api.getState().then(function (st) {
      applyState(st);
      if (!st.sync.linked && st.tasks.length === 0) {
        // lần đầu mở app: gợi ý kết nối
        setTimeout(openSettings, 400);
      }
    }).catch(fail);
    $('q').focus();
  }

  init();
})();
