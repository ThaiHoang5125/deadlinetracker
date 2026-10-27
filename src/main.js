'use strict';
const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain,
  nativeImage, powerMonitor, screen, shell
} = require('electron');
const { Engine } = require('./engine.js');
const Core = require('./core.js');

const APP_ID = 'vn.deadline.tracker';
const SHORTCUT = 'CommandOrControl+Alt+N';
const SHORTCUT_LIST = 'CommandOrControl+Alt+L';
let shortcutListOk = false;
// icon nằm ngoài file asar (asarUnpack) để Windows đọc được cho khay hệ thống/cửa sổ
const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png')
  : path.join(__dirname, '..', 'assets', 'icon.png');
const startedHidden = process.argv.includes('--hidden');
const testMode = process.env.DEADLINE_TEST === '1';

// Một số máy Windows hiển thị cửa sổ trắng do lỗi card đồ họa -> tắt tăng tốc phần cứng (app rất nhẹ)
app.disableHardwareAcceleration();
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('lang', 'vi'); // ngày giờ, ô chọn ngày hiển thị kiểu Việt Nam

if (!testMode && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let engine = null;
let mainWin = null;
let quickWin = null;
let cardWin = null;
let tray = null;
let quitting = false;
let shortcutOk = false;
let cardItems = [];
const liveNotifications = new Set();

// ------------------------------------------------------------------ cửa sổ
function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    backgroundThrottling: false
  };
}

function logLine(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* bỏ qua */ }
}

const AUTHOR_URL = 'https://candid-truffle-741aaf.netlify.app/';

function lockNavigation(win) {
  win.webContents.on('did-fail-load', (_e, code, desc, url) => logLine('did-fail-load ' + code + ' ' + desc + ' ' + url));
  win.webContents.on('render-process-gone', (_e, d) => logLine('render-process-gone ' + JSON.stringify(d)));
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 2) logLine('renderer ' + message + ' @' + src + ':' + line); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createMain(show) {
  mainWin = new BrowserWindow({
    width: 1020, height: 740, minWidth: 780, minHeight: 560,
    show: false, title: 'Deadline Tracker', icon: ICON, backgroundColor: '#f4f4f8',
    webPreferences: webPrefs()
  });
  lockNavigation(mainWin);
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => { if (show) mainWin.show(); });
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('session-end', () => { quitting = true; });
  mainWin.on('closed', () => { mainWin = null; });
  return mainWin;
}

function showMain(msg, payload) {
  if (!mainWin) createMain(false);
  const go = () => {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (msg) mainWin.webContents.send(msg, payload);
  };
  if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', go);
  else go();
}

function createQuick() {
  quickWin = new BrowserWindow({
    width: 680, height: 176, show: false, frame: false, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, title: 'Thêm nhanh', icon: ICON,
    backgroundColor: '#ffffff', webPreferences: webPrefs()
  });
  lockNavigation(quickWin);
  quickWin.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  quickWin.on('blur', () => {
    setTimeout(() => {
      if (quickWin && !quickWin.isDestroyed() && !quickWin.isFocused()) quickWin.hide();
    }, 120);
  });
  quickWin.on('closed', () => { quickWin = null; });
}

function showQuick() {
  if (!quickWin) createQuick();
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const [w, h] = quickWin.getSize();
  quickWin.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.18));
  const go = () => {
    quickWin.show();
    quickWin.focus();
    quickWin.webContents.send('quick:focus');
  };
  if (quickWin.webContents.isLoading()) quickWin.webContents.once('did-finish-load', go);
  else go();
}

function createCard() {
  cardWin = new BrowserWindow({
    width: 390, height: 140, show: false, frame: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, title: 'Nhắc việc',
    backgroundColor: '#ffffff', webPreferences: webPrefs()
  });
  cardWin.setAlwaysOnTop(true, 'floating');
  lockNavigation(cardWin);
  cardWin.loadFile(path.join(__dirname, 'renderer', 'card.html'));
  cardWin.on('closed', () => { cardWin = null; });
}

function placeCard(height) {
  if (!cardWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 390;
  const h = Math.max(110, Math.min(height || 140, Math.round(wa.height * 0.8)));
  cardWin.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h });
}

function pushCardItems() {
  if (!cardWin) return;
  cardWin.webContents.send('card:items', cardItems);
  if (!cardItems.length) cardWin.hide();
}

function showCard(items) {
  items.forEach((it) => {
    cardItems = cardItems.filter((x) => x.id !== it.id);
    cardItems.unshift(it);
  });
  if (!cardWin) createCard();
  const go = () => {
    pushCardItems();
    placeCard(60 + Math.min(cardItems.length, 4) * 98);
    cardWin.showInactive();
  };
  if (cardWin.webContents.isLoading()) cardWin.webContents.once('did-finish-load', go);
  else go();
}

// ------------------------------------------------------------ thông báo
function nativeNotify(title, body, onClick) {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, silent: false, icon: nativeImage.createFromPath(ICON) });
  liveNotifications.add(n);
  const release = () => liveNotifications.delete(n);
  n.on('click', () => { release(); if (onClick) onClick(); });
  n.on('close', release);
  n.on('failed', release);
  n.show();
  setTimeout(release, 10 * 60 * 1000);
  return true;
}

function handleReminders(items) {
  const style = engine.data.settings.reminderStyle;
  let card = style === 'card' || style === 'both';
  const toast = style === 'toast' || style === 'both';
  if (card) {
    try { showCard(items); shell.beep(); } catch (e) { card = false; }
  }
  if (toast || !card) {
    if (items.length === 1) {
      nativeNotify(items[0].title, items[0].body, () => showMain('main:open-task', items[0].id));
    } else {
      const lines = items.slice(0, 4).map((i) => '• ' + i.taskTitle + ' (' + i.rel + ')');
      if (items.length > 4) lines.push('… và ' + (items.length - 4) + ' việc khác');
      nativeNotify('Bạn có ' + items.length + ' lời nhắc', lines.join('\n'), () => showMain());
    }
  }
}

// -------------------------------------------------------------------- khay
function trayTooltip() {
  const s = engine.state();
  const now = new Date();
  let over = 0;
  let today = 0;
  s.tasks.forEach((t) => {
    const b = Core.bucketOf(t, now);
    if (b === 'overdue') over++;
    else if (b === 'today') today++;
  });
  const parts = ['Deadline Tracker'];
  if (over) parts.push(over + ' quá hạn');
  parts.push(today + ' hôm nay');
  return parts.join(' · ');
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  const refresh = () => {
    tray.setToolTip(trayTooltip());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mở Deadline Tracker', click: () => showMain() },
      { label: 'Thêm nhanh (Ctrl+Alt+N)', click: () => showQuick() },
      { label: 'Xem danh sách (Ctrl+Alt+L)', click: () => showMain('main:show-list') },
      { label: 'Đồng bộ ngay', click: () => engine.syncNow() },
      { type: 'separator' },
      { label: 'Thoát', click: () => { quitting = true; app.quit(); } }
    ]));
  };
  refresh();
  tray.on('click', () => showMain());
  engine.on('change', refresh);
  setInterval(refresh, 60 * 1000).unref();
}

// ------------------------------------------------------------------- IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

function setupIpc() {
  handle('state:get', () => engine.state());
  handle('app:info', () => ({
    version: app.getVersion(), shortcut: 'Ctrl+Alt+N', shortcutOk, shortcutListOk,
    dataFile: engine.file, platform: process.platform
  }));
  handle('task:add', (f) => engine.addTask(f));
  handle('task:update', (id, p) => engine.updateTask(id, p));
  handle('task:toggle', (id) => { engine.toggleDone(id); removeCardItem(id); });
  handle('task:delete', (id) => { engine.deleteTask(id); removeCardItem(id); });
  handle('task:restore', (id) => engine.restoreTask(id));
  handle('task:snooze', (id, m) => { engine.snooze(id, m); removeCardItem(id); });
  handle('group:add', (n) => engine.addGroup(n));
  handle('group:rename', (from, to) => engine.renameGroup(from, to));
  handle('group:delete', (n) => engine.deleteGroup(n));
  handle('group:assign', (ids, n) => engine.assignGroup(ids, n));
  handle('quick:add', (text) => engine.quickAdd(text));
  handle('quick:hide', () => { if (quickWin) quickWin.hide(); });
  handle('quick:resize', (h) => {
    if (!quickWin) return;
    // cửa sổ không resizable nên Windows khóa min = max = kích thước hiện tại: setSize không thu nhỏ được, setBounds thì được
    const b = quickWin.getBounds();
    quickWin.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.max(176, Math.min(Math.round(Number(h) || 176), 520)) });
  });
  handle('sync:now', () => engine.syncNow());
  handle('sync:connect', (link, key) => engine.connect(link, key));
  handle('sync:disconnect', () => engine.disconnect());
  handle('settings:set', (patch) => {
    engine.setSettings(patch);
    if ('autostart' in patch) applyAutostart();
  });
  handle('win:open-main', (opts) => {
    if (opts.draft) showMain('main:open-draft', opts.draft);
    else if (opts.taskId) showMain('main:open-task', opts.taskId);
    else showMain();
    if (quickWin) quickWin.hide();
  });
  // URL cố định trong main, renderer không được truyền URL vào
  handle('app:open-author', () => shell.openExternal(AUTHOR_URL));
  handle('app:test-notification', () => {
    handleReminders([{
      id: 'test', title: 'Thử thông báo', body: 'Nếu bạn thấy thông báo này, nhắc việc đã hoạt động.',
      taskTitle: 'Thông báo thử', rel: 'ngay bây giờ', group: '', deadline: new Date().toISOString(),
      offset: 0, late: false, snooze: false, test: true
    }]);
  });
  handle('card:action', (id, action) => {
    if (id === 'test') { removeCardItem(id); return; }
    if (action === 'done') engine.markDone(id);
    else if (action === 'snooze') engine.snooze(id, 60);
    else if (action === 'open') showMain('main:open-task', id);
    removeCardItem(id);
  });
  handle('card:dismiss-all', () => { cardItems = []; pushCardItems(); });
  handle('card:resize', (h) => placeCard(h));
}

function removeCardItem(id) {
  const before = cardItems.length;
  cardItems = cardItems.filter((x) => x.id !== id);
  if (before !== cardItems.length) pushCardItems();
}

// ---------------------------------------------------------- khởi động cùng máy
// Bản portable chạy từ thư mục tạm; đường dẫn file .exe thật nằm trong biến môi trường này
function exePath() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }

function applyAutostart() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!engine.data.settings.autostart, path: exePath(), args: ['--hidden'] });
  } catch (e) { /* bỏ qua */ }
}

// Windows cần một shortcut có AppUserModelID trong Start Menu thì thông báo (toast) mới hiện đúng
function ensureStartMenuShortcut() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Deadline Tracker.lnk');
    shell.writeShortcutLink(lnk, 'replace', {
      target: exePath(), cwd: path.dirname(exePath()), appUserModelId: APP_ID,
      icon: exePath(), iconIndex: 0, description: 'Deadline Tracker'
    });
  } catch (e) { /* bỏ qua */ }
}

// -------------------------------------------------------------------- chạy
if (!testMode) {
  app.on('second-instance', () => showMain());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  engine = new Engine({ file: path.join(app.getPath('userData'), 'deadline-data.json') }).load();
  engine.on('error', (e) => console.error('engine:', e));
  engine.on('change', (s) => {
    [mainWin, quickWin].forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send('state', s); });
  });
  engine.on('reminders', handleReminders);
  engine.on('digest', (d) => nativeNotify(d.title, d.body, () => showMain()));

  setupIpc();
  buildTray();
  applyAutostart();
  ensureStartMenuShortcut();

  shortcutOk = globalShortcut.register(SHORTCUT, showQuick);
  shortcutListOk = globalShortcut.register(SHORTCUT_LIST, () => showMain('main:show-list'));

  const firstRun = !engine.linked() && Object.keys(engine.data.tasks).length === 0;
  createMain(!startedHidden || firstRun);
  engine.start();

  powerMonitor.on('resume', () => { setTimeout(() => { engine.tick(); engine.syncNow(); }, 3000); });
  powerMonitor.on('unlock-screen', () => { engine.tick(); });

  if (testMode && process.env.DEADLINE_TEST_HOOK) {
    require(process.env.DEADLINE_TEST_HOOK)({ app, engine, getMain: () => mainWin, showQuick, showCard, getQuick: () => quickWin, getCard: () => cardWin });
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (engine) engine.stop();
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => { /* ở lại khay hệ thống */ });
