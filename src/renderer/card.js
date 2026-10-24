(function () {
  'use strict';
  var api = window.api;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var MAX = 4;

  function render(items) {
    var shown = items.slice(0, MAX);
    var html = shown.map(function (it) {
      var isTest = it.id === 'test';
      return '<div class="item" data-id="' + esc(it.id) + '">' +
        '<div class="t">' + esc(it.title) + '</div>' +
        '<div class="b">' + (it.late && !it.snooze ? '<span class="late">Bị lỡ · </span>' : '') + esc(it.body.replace(/^Lời nhắc bị lỡ · /, '')) + '</div>' +
        '<div class="acts">' +
        (isTest ? '' : '<button class="btn primary" data-a="done">Xong rồi</button><button class="btn" data-a="snooze">Nhắc lại 1h</button><button class="btn" data-a="open">Mở</button>') +
        '<button class="btn" data-a="dismiss">' + (isTest ? 'Đóng' : 'Bỏ qua') + '</button></div></div>';
    }).join('');
    if (items.length > MAX) html += '<div class="item b">… và ' + (items.length - MAX) + ' việc khác trong app</div>';
    $('items').innerHTML = html;
    $('all').style.display = items.length > 1 ? '' : 'none';
    var h = $('wrap').offsetHeight + 4;
    api.card.resize(h).catch(function () {});
  }

  $('items').addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    var item = e.target.closest('.item');
    if (!b || !item) return;
    api.card.action(item.getAttribute('data-id'), b.getAttribute('data-a')).catch(function () {});
  });
  $('all').addEventListener('click', function () { api.card.dismissAll().catch(function () {}); });
  api.card.onItems(render);
})();
