(function () {
  'use strict';
  var C = window.Core;
  var api = window.api;
  var groups = [];
  var tasks = [];
  var groupInfo = [];
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function parse() { return C.parseQuick($('q').value, new Date(), { groups: groups }); }

  function preview() {
    var v = $('q').value.trim();
    var el = $('preview');
    if (!v) { el.innerHTML = ''; return; }
    var r = parse();
    var parts = ['<b>' + esc(r.title || '(chưa có tên)') + '</b>'];
    if (r.group) parts.push('#' + esc(r.group));
    if (r.priority !== C.DEFAULT_PRIORITY) parts.push('ưu tiên ' + r.priority + ' (' + esc(C.PRIORITY_LABEL[r.priority].toLowerCase()) + ')');
    if (r.deadline) parts.push(esc(C.fmtDeadline(r.deadline)) + ' (' + esc(C.relativeText(r.deadline)) + ')');
    var dup = r.deadline ? C.dupText(C.findDuplicates(tasks, r.deadline), r.title) : '';
    var iss = r.issues.map(function (i) {
      return '<br><span class="' + (i.level === 'error' ? 'warn' : 'dup') + '">' + (i.level === 'error' ? '✖ ' : '⚠ ') + esc(i.text) + '</span>';
    }).join('');
    if (C.hasError(r.issues)) iss += '<br><span class="warn">Sửa lại cho đúng thì mới thêm được</span>';
    el.innerHTML = '→ ' + parts.join(' · ') + iss + (dup ? '<br><span class="dup">⚠ ' + esc(dup) + '</span>' : '');
  }

  var BASE_H = 176;
  var prio = QuickMenu.attach({
    input: $('q'), host: document.body, groups: function () { return groupInfo; },
    onResize: function (h) { api.resizeQuick(Math.max(BASE_H, h)).catch(function () {}); }
  });

  function reset() {
    busy = false;
    $('q').value = '';
    $('q').disabled = false;
    $('preview').innerHTML = '';
    prio.close();
    $('q').focus();
  }

  function openForm() {
    var r = parse();
    var draft = { title: r.title, group: r.group, priority: r.priority, deadline: r.deadline ? C.toISO(r.deadline) : '' };
    busy = true;
    api.openMain({ draft: draft }).then(reset, reset);
  }

  function submit() {
    var v = $('q').value.trim();
    if (!v || busy) return;
    if (C.hasError(parse().issues)) { preview(); return; }
    busy = true;
    api.quickAdd(v).then(function (res) {
      if (res.needsForm) {
        api.openMain({ draft: res.draft }).then(reset, reset);
        return;
      }
      $('preview').innerHTML = '<span class="okk">&#10003; Đã thêm: ' + esc(res.task.title) + ' — ' + esc(C.fmtDeadline(res.task.deadline)) + '</span>';
      setTimeout(function () { api.hideQuick().then(reset, reset); }, 750);
    }).catch(function (e) {
      busy = false;
      $('preview').innerHTML = '<span class="warn">' + esc(e.message) + '</span>';
    });
  }

  $('q').addEventListener('input', preview);
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.shiftKey) openForm(); else submit(); }
    else if (e.key === 'Tab') { e.preventDefault(); openForm(); }
    else if (e.key === 'Escape') { e.preventDefault(); api.hideQuick().then(reset, reset); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') api.hideQuick().then(reset, reset);
  });

  api.onQuickFocus(function () {
    reset();
    api.getState().then(function (s) { groups = s.groups || []; tasks = s.tasks || []; groupInfo = s.groupStats || []; }).catch(function () {});
  });
  api.onState(function (s) { groups = s.groups || []; tasks = s.tasks || []; groupInfo = s.groupStats || []; });
  $('q').focus();
})();
