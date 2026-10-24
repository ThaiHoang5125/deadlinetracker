'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || r.ok === false) throw new Error((r && r.error) || 'Lỗi không xác định');
  return r.data;
}

function listen(channel, cb) {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),
  onState: (cb) => listen('state', cb),
  getInfo: () => call('app:info'),

  addTask: (fields) => call('task:add', fields),
  updateTask: (id, patch) => call('task:update', id, patch),
  toggleDone: (id) => call('task:toggle', id),
  deleteTask: (id) => call('task:delete', id),
  restoreTask: (id) => call('task:restore', id),
  snooze: (id, minutes) => call('task:snooze', id, minutes),

  addGroup: (name) => call('group:add', name),
  renameGroup: (from, to) => call('group:rename', from, to),
  deleteGroup: (name) => call('group:delete', name),
  assignGroup: (ids, name) => call('group:assign', ids, name),

  quickAdd: (text) => call('quick:add', text),
  hideQuick: () => call('quick:hide'),
  resizeQuick: (height) => call('quick:resize', height),
  onQuickFocus: (cb) => listen('quick:focus', cb),
  onShowList: (cb) => listen('main:show-list', cb),

  syncNow: () => call('sync:now'),
  connect: (link, key) => call('sync:connect', link, key),
  disconnect: () => call('sync:disconnect'),
  setSettings: (patch) => call('settings:set', patch),
  testNotification: () => call('app:test-notification'),

  openMain: (opts) => call('win:open-main', opts || {}),
  onOpenTask: (cb) => listen('main:open-task', cb),
  onOpenDraft: (cb) => listen('main:open-draft', cb),

  card: {
    onItems: (cb) => listen('card:items', cb),
    action: (id, action) => call('card:action', id, action),
    dismissAll: () => call('card:dismiss-all'),
    resize: (height) => call('card:resize', height)
  }
});
