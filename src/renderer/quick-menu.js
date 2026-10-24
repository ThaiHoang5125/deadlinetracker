/*
 * quick-menu.js - menu xổ xuống gợi ý trong ô nhập nhanh, giống gợi ý hàm khi viết code.
 *   gõ "!"  -> các mức ưu tiên 1-5 kèm mốc nhắc
 *   gõ "#"  -> các nhóm đã có kèm số việc đang mở
 * Dùng chung cho cửa sổ chính và cửa sổ nhập nhanh.
 *
 * QuickMenu.attach({ input, host, groups, onResize })
 *   input    ô nhập; menu hiện ngay dưới vị trí dấu "!" / "#"
 *   host     phần tử có position: relative để đặt menu
 *   groups   hàm() trả về [{name, count}] các nhóm đã có
 *   onResize hàm(bottomPx): báo chiều cao cần có (0 = đã đóng), cửa sổ nhập nhanh dùng để giãn cửa sổ
 */
(function () {
  'use strict';
  var C = window.Core;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var canvas = document.createElement('canvas').getContext('2d');

  // ---- nguồn gợi ý: trả về { start, items:[{html, insert}] } hoặc null
  function priorityItems(value) {
    var tok = C.bangTyping(value);
    if (!tok) return null;
    // đã gõ trọn một mức ("!2", "!cao") thì không cần gợi ý nữa
    if (tok.typed && C.priorityFromWord(tok.typed) && (tok.typed.length > 1 || /^\d$/.test(tok.typed))) return null;
    var all = C.priorityOptions(tok.typed);
    var list = tok.typed ? all.filter(function (x) { return x.match; }) : all;
    return {
      start: tok.start,
      foot: '↑ ↓ chọn · Enter hoặc Tab để chèn · Esc đóng',
      items: list.map(function (o) {
        return {
          html: '<span class="qm-k">!' + o.level + '</span><span class="qm-l">' + esc(o.label) + '</span><span class="qm-r">' + esc(o.text) + '</span>',
          insert: '!' + o.level + ' '
        };
      })
    };
  }

  function groupItems(value, getGroups) {
    var tok = C.hashTyping(value);
    if (!tok) return null;
    var groups = getGroups ? getGroups() : [];
    var t = C.fold(tok.typed).replace(/\s+/g, ' ').replace(/^\s/, '');
    var list = groups.filter(function (g) {
      if (!t) return true;
      var n = C.fold(g.name);
      return n.indexOf(t) === 0 || (!/\s/.test(t) && (' ' + n).indexOf(' ' + t) >= 0);
    });
    if (!list.length) return null;
    // đã gõ trọn đúng tên một nhóm thì thôi gợi ý (để Enter lưu việc)
    if (t && list.length === 1 && C.fold(list[0].name) === t.replace(/\s+$/, '')) return null;
    return {
      start: tok.start,
      foot: '↑ ↓ chọn nhóm · Enter hoặc Tab để chèn · Esc đóng · gõ tên mới để tạo nhóm',
      items: list.map(function (g) {
        return {
          html: '<span class="qm-dot" style="background:' + C.groupColor(g.name) + '"></span><span class="qm-name">' + esc(g.name) + '</span>' +
            '<span class="qm-r">' + g.count + ' việc đang mở</span>',
          // tên nhiều từ thì đặt trong dấu nháy để có thể gõ tiếp tên việc phía sau
          insert: (/\s/.test(g.name) ? '#"' + g.name + '"' : '#' + g.name) + ' '
        };
      })
    };
  }

  function attach(o) {
    var input = o.input;
    var host = o.host;
    var menu = document.createElement('div');
    menu.className = 'qmenu hidden';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = '<div class="qm-list"></div><div class="qm-foot"></div>';
    host.appendChild(menu);
    var listEl = menu.firstChild;
    var footEl = menu.lastChild;

    var src = null;
    var lastX = -1;
    var lastY = -1;
    var active = 0;
    var open = false;

    function isOpen() { return open; }

    function report() {
      if (!o.onResize) return;
      requestAnimationFrame(function () {
        o.onResize(open ? Math.ceil(menu.getBoundingClientRect().bottom) + 14 : 0);
      });
    }

    function close() {
      if (!open) return;
      open = false;
      menu.classList.add('hidden');
      report();
    }

    function place(start) {
      var cs = getComputedStyle(input);
      canvas.font = cs.font;
      var hostBox = host.getBoundingClientRect();
      var box = input.getBoundingClientRect();
      var width = Math.min(host.clientWidth - 16, 560);
      var x = box.left - hostBox.left - host.clientLeft + parseFloat(cs.paddingLeft) +
        canvas.measureText(input.value.slice(0, start)).width - input.scrollLeft - 10;
      x = Math.max(0, Math.min(x, host.clientWidth - width));
      menu.style.width = width + 'px';
      menu.style.left = x + 'px';
      menu.style.top = (box.bottom - hostBox.top - host.clientTop + 4) + 'px';
    }

    function draw() {
      var keep = listEl.scrollTop;
      listEl.innerHTML = src.items.map(function (it, i) {
        return '<div class="qm-item' + (i === active ? ' on' : '') + '" role="option" data-i="' + i + '">' + it.html + '</div>';
      }).join('');
      footEl.textContent = src.foot;
      listEl.scrollTop = keep;
      var on = listEl.querySelector('.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function update() {
      var s = priorityItems(input.value) || groupItems(input.value, o.groups);
      if (!s || !s.items.length) { close(); return; }
      src = s;
      if (!open) { active = 0; lastX = -1; }
      active = Math.min(active, src.items.length - 1);
      draw();
      place(src.start);
      open = true;
      menu.classList.remove('hidden');
      report();
    }

    function pick(i) {
      var it = src && src.items[i];
      if (!it) { close(); return; }
      input.value = input.value.slice(0, src.start) + it.insert;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      close();
      input.dispatchEvent(new Event('input', { bubbles: true })); // cập nhật phần xem trước (và mở gợi ý tiếp nếu có)
    }

    // chạy trước các xử lý phím khác của ô nhập (Enter = lưu, Tab = mở form, Esc = đóng cửa sổ)
    input.addEventListener('keydown', function (e) {
      if (!open) return;
      var handled = true;
      var n = src.items.length;
      if (e.key === 'ArrowDown') active = (active + 1) % n;
      else if (e.key === 'ArrowUp') active = (active + n - 1) % n;
      else if (e.key === 'Enter' || e.key === 'Tab') pick(active);
      else if (e.key === 'Escape') close();
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (open) draw();
    }, true);

    input.addEventListener('input', update);
    input.addEventListener('blur', close);
    // mousedown (không phải click) để ô nhập không mất focus
    menu.addEventListener('mousedown', function (e) {
      var row = e.target.closest('[data-i]');
      e.preventDefault();
      if (row) pick(+row.getAttribute('data-i'));
    });
    // chỉ theo chuột khi chuột thật sự di chuyển; menu vừa hiện dưới con trỏ đứng yên sẽ bắn một mousemove giả
    menu.addEventListener('mousemove', function (e) {
      var moved = lastX >= 0 && (e.clientX !== lastX || e.clientY !== lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      var row = e.target.closest('[data-i]');
      if (moved && row && +row.getAttribute('data-i') !== active) { active = +row.getAttribute('data-i'); draw(); }
    });

    return { update: update, close: close, isOpen: isOpen };
  }

  window.QuickMenu = { attach: attach };
})();
