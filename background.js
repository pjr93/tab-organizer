importScripts("shared.js"); // APP_URL, isBoardTab, isOwnPage, serializeTabGroups

function isBoardUrl(url) {
  return typeof url === "string" && url.startsWith(APP_URL);
}

function getBoardTabs() {
  return chrome.tabs.query({ url: APP_URL });
}

// Send a message to every open board tab. A board that is still loading may
// not have its listener yet; that's fine, it syncs itself on startup.
async function messageBoards(message) {
  const tabs = await getBoardTabs();
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => { });
  }
}

/* ------------------------------------------------------------------ */
/* Opening / focusing the board                                        */
/* ------------------------------------------------------------------ */

async function openOrFocusBoard() {
  captureCurrentView(); // full preview: remember the tab we're leaving (not awaited)
  const tabs = await getBoardTabs();
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    // Refresh the board's data in place rather than reloading the page, so the
    // scroll position and selection are kept.
    chrome.tabs.sendMessage(tab.id, { type: "sync_browser_state" }).catch(() => { });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
}

chrome.action.onClicked.addListener(() => { openOrFocusBoard(); });

/* ------------------------------------------------------------------ */
/* Keeping the board in sync with the browser                          */
/* ------------------------------------------------------------------ */

// Many tab events fire in bursts (a single page load emits several
// onUpdated events), so coalesce them into one board refresh.
let syncTimer = null;
function scheduleBoardSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    messageBoards({ type: "sync_browser_state" });
  }, 150);
}

// Only these onUpdated changes affect what the board displays.
const RELEVANT_UPDATE_KEYS = ["title", "url", "favIconUrl", "pinned", "groupId", "discarded", "audible", "mutedInfo"];

function onBrowserChanged() {
  scheduleBoardSync();
  scheduleAutosave();
}

chrome.tabs.onCreated.addListener(onBrowserChanged);
chrome.tabs.onRemoved.addListener(onBrowserChanged);
chrome.tabs.onMoved.addListener(onBrowserChanged);
chrome.tabs.onAttached.addListener(onBrowserChanged);
chrome.tabs.onDetached.addListener(onBrowserChanged);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (RELEVANT_UPDATE_KEYS.some(key => key in changeInfo)) onBrowserChanged();
});
chrome.windows.onCreated.addListener(onBrowserChanged);
chrome.windows.onRemoved.addListener(onBrowserChanged);

/* ------------------------------------------------------------------ */
/* Autosave                                                            */
/* ------------------------------------------------------------------ */
// When enabled (board checkbox), the session is saved to its own slot
// ("autoSave") about 10s after the last tab/window change. It never touches
// the manual Ctrl+S save. On browser startup the previous session's autosave
// is moved to "autoSavePrev" so a fresh, empty session can't overwrite it.

const AUTOSAVE_DELAY_MS = 10000;
let autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DELAY_MS);
}

async function runAutosave() {
  autosaveTimer = null;
  const { autosaveEnabled, titles = {}, windowOrder = [] } = await chrome.storage.local.get(["autosaveEnabled", "titles", "windowOrder"]);
  if (!autosaveEnabled) return;

  // The board sets this while restoring, so we don't save a half-built session.
  const { restoreBusyUntil } = await chrome.storage.session.get("restoreBusyUntil");
  if (restoreBusyUntil && Date.now() < restoreBusyUntil) {
    scheduleAutosave();
    return;
  }

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  // Save in the board's window order (windows it hasn't seen yet go last).
  const rank = id => { const i = windowOrder.indexOf(id); return i === -1 ? Infinity : i; };
  windows.sort((a, b) => rank(a.id) - rank(b.id));
  const saved = serializeTabGroups(windows.map(w => w.tabs || []), titles);
  if (!saved.some(w => w.tabs.some(t => !isBoardTab(t)))) return; // nothing worth saving
  await chrome.storage.local.set({ autoSave: saved, autoSavedAt: Date.now() });
}

chrome.runtime.onStartup.addListener(async () => {
  const { autoSave, autoSavedAt } = await chrome.storage.local.get(["autoSave", "autoSavedAt"]);
  if (autoSave) {
    await chrome.storage.local.set({ autoSavePrev: autoSave, autoSavePrevAt: autoSavedAt });
    await chrome.storage.local.remove(["autoSave", "autoSavedAt"]);
  }
});

// Window titles and order are edited on the board; include them in the next autosave.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.titles || changes.windowOrder)) scheduleAutosave();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "autosave_now") runAutosave();
});

/* ------------------------------------------------------------------ */
/* Tab history (most-recently-used order) and the tab switcher         */
/* ------------------------------------------------------------------ */
//
// `mru` holds tab ids, most recent first. The board is included; the
// extension's other pages (switcher window) and tabs in popup windows are not. It lives in chrome.storage.session so it
// survives the service worker being suspended and doesn't need the board.
//
// Alt+Shift+Arrow opens the switcher listing recent tabs (see below for
// overlay vs. window). Left/Right are browser shortcuts; Up/Down are caught by
// the overlay script in the page. While open it captures the keyboard: arrows
// move the highlight (Left/Down = older, Right/Up = newer), Enter switches,
// Esc cancels. Only the tab switched to moves to the front of the list.

const MRU_LIMIT = 200;
const SWITCHER_MAX_ITEMS = 15;

let mru = [];
let switcher = null; // see "the switcher" below

const ready = (async () => {
  const { mru: saved } = await chrome.storage.session.get("mru");
  if (Array.isArray(saved)) {
    mru = saved;
    return;
  }
  // First run in this browser session: seed from each tab's last access time.
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  mru = tabs
    .filter(t => isBoardUrl(t.url) || !isOwnPage(t.url))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .map(t => t.id)
    .slice(0, MRU_LIMIT);
  persistMru();
})();

function persistMru() {
  chrome.storage.session.set({ mru });
}

function moveToFront(tabId) {
  const idx = mru.indexOf(tabId);
  if (idx === 0) return;
  if (idx > 0) mru.splice(idx, 1);
  mru.unshift(tabId);
  if (mru.length > MRU_LIMIT) mru.length = MRU_LIMIT;
  persistMru();
}

async function isNormalWindow(windowId) {
  try {
    const win = await chrome.windows.get(windowId);
    return win.type === "normal";
  } catch (e) {
    return false;
  }
}

async function recordActivation(tab) {
  await ready;
  if (switcher) return; // the switcher commits its own choice
  if (isOwnPage(tab.url) && !isBoardUrl(tab.url)) return;
  if (!(await isNormalWindow(tab.windowId))) return;
  moveToFront(tab.id);
}

/* ---- the switcher ---- */
//
// Preferred: an overlay drawn inside the current page by switcher-overlay.js
// (content script; also loaded by the board). Keyboard focus stays in the page,
// so the overlay sees Alt being released even on a quick tap.
// Fallback: switcher.html in a small popup window, for pages extensions can't
// script (chrome://, web store, new tab page, PDF viewer) or when the page
// doesn't have keyboard focus (e.g. typing in the address bar).
//
// switcher = { mode: "overlay" | "window", items, cursor, originWindowId,
//              overlayTabId (overlay), windowId + pageTabId (window) }

// Icons for the switcher. The overlay runs inside a web page, which can't load
// chrome://, extension or favicon-service images, so icons are fetched here
// and passed along as data: URLs. Cached by page URL.
const iconCache = new Map(); // url -> data URL
const ICON_CACHE_LIMIT = 300;

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function loadIcon(url) {
  if (iconCache.has(url)) return iconCache.get(url);
  // The board uses the extension's own icon; everything else comes from the
  // browser's favicon service (also covers chrome:// pages).
  const src = isBoardUrl(url) ? chrome.runtime.getURL("icon32.png") : getFaviconUrl(url, 32);
  const dataUrl = await blobToDataUrl(await (await fetch(src)).blob());
  if (iconCache.size >= ICON_CACHE_LIMIT) iconCache.delete(iconCache.keys().next().value);
  iconCache.set(url, dataUrl);
  return dataUrl;
}

// Fetch icons the cache doesn't have yet and send them to the open switcher.
async function fillMissingIcons(s) {
  const missing = s.items.filter(item => !item.icon && item.url);
  if (!missing.length) return;
  const icons = {};
  await Promise.all(missing.map(async item => {
    try { icons[item.id] = item.icon = await loadIcon(item.url); } catch (e) { /* no icon */ }
  }));
  if (switcher !== s || !Object.keys(icons).length) return;
  const { tabId, frameId } = switcherTabTarget(s);
  if (tabId == null) return;
  const opts = frameId != null ? { frameId } : undefined;
  chrome.tabs.sendMessage(tabId, { type: "switcher_icons", icons }, opts).catch(() => { });
}

function tabToItem(tab) {
  return {
    id: tab.id,
    title: tab.title || tab.url || "Untitled",
    url: tab.url || "",
    icon: iconCache.get(tab.url) || "",
    windowId: tab.windowId,
    discarded: !!tab.discarded,
    audible: !!tab.audible,
  };
}

// Ask the page to show the overlay. Injects the script if the tab was opened
// before the extension loaded. Resolves true if the overlay is up.
async function showOverlay(tabId, items, cursor) {
  const message = { type: "overlay_show", items, cursor };
  const trySend = () => chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  let response;
  try {
    response = await trySend();
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["switcher-overlay.js"] });
      response = await trySend();
    } catch (e2) {
      return false; // page can't be scripted
    }
  }
  return !!(response && response.ok);
}

async function openSwitcherWindow(origin, items, cursor) {
  const width = 520;
  const rows = Math.min(items.length, 10);
  const height = 150 + rows * 42;
  const base = origin && origin.width ? origin : { left: 0, top: 0, width: 1280, height: 800 };
  const left = Math.round(base.left + (base.width - width) / 2);
  const top = Math.round(base.top + Math.max(40, (base.height - height) / 3));
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("switcher.html"),
    type: "popup",
    focused: true,
    width, height, left, top,
  });
  return win;
}

async function openSwitcher(step) {
  await ready;
  captureCurrentView(); // full preview: remember the tab we're leaving (not awaited)
  const origin = await chrome.windows.getLastFocused({ populate: true });
  const current = origin && origin.tabs ? origin.tabs.find(t => t.active) : null;

  // Collect the most recent tabs that still exist (one query, not one per tab).
  const allTabs = new Map((await chrome.tabs.query({})).map(t => [t.id, t]));
  const items = [];
  const alive = [];
  for (const id of mru) {
    const tab = allTabs.get(id);
    if (!tab) continue;
    alive.push(id);
    if (items.length < SWITCHER_MAX_ITEMS) items.push(tabToItem(tab));
  }
  if (alive.length !== mru.length) { mru = alive; persistMru(); }
  if (!items.length) return;

  // If the current tab heads the list, the first step should skip it.
  const start = current && items[0].id === current.id ? 0 : -1;
  const cursor = Math.max(0, Math.min(items.length - 1, start + step));
  const originWindowId = origin ? origin.id : null;

  // 1) Overlay in the current page.
  if (current && origin && origin.type === "normal") {
    switcher = { mode: "overlay", overlayTabId: current.id, items, cursor, originWindowId };
    if (await showOverlay(current.id, items, cursor)) {
      fillMissingIcons(switcher);
      return;
    }
  }

  // 2) Popup window.
  switcher = { mode: "window", windowId: null, pageTabId: null, items, cursor, originWindowId };
  try {
    const win = await openSwitcherWindow(origin, items, cursor);
    if (!switcher) { // cancelled while the window was opening
      chrome.windows.remove(win.id).catch(() => { });
      return;
    }
    switcher.windowId = win.id;
    switcher.pageTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
    // The page may not be listening yet; it also gets icons via switcher_ready.
    fillMissingIcons(switcher);
  } catch (e) {
    console.warn("Could not open the tab switcher", e);
    switcher = null;
  }
}

function switcherTabTarget(s) {
  return s.mode === "overlay" ? { tabId: s.overlayTabId, frameId: 0 } : { tabId: s.pageTabId, frameId: undefined };
}

function moveSwitcher(step) {
  if (!switcher) return;
  switcher.cursor = Math.max(0, Math.min(switcher.items.length - 1, switcher.cursor + step));
  const { tabId, frameId } = switcherTabTarget(switcher);
  if (tabId != null) {
    const opts = frameId != null ? { frameId } : undefined;
    chrome.tabs.sendMessage(tabId, { type: "switcher_update", cursor: switcher.cursor }, opts).catch(() => { });
  }
}

// Remove the switcher UI (overlay or window).
async function closeSwitcherUI(s) {
  if (s.mode === "overlay") {
    chrome.tabs.sendMessage(s.overlayTabId, { type: "overlay_hide" }, { frameId: 0 }).catch(() => { });
  } else if (s.windowId != null) {
    await chrome.windows.remove(s.windowId).catch(() => { });
  }
}

async function commitSwitcher(index) {
  const s = switcher;
  if (!s) return;
  switcher = null;
  const target = s.items[Number.isInteger(index) ? index : s.cursor];
  await closeSwitcherUI(s);
  if (!target) return;
  try {
    const tab = await chrome.tabs.update(target.id, { active: true });
    const { historyStayInApp } = await chrome.storage.local.get("historyStayInApp");
    if (historyStayInApp && s.originWindowId != null) {
      // "view history in app": switch the tab but keep focus where it was.
      await chrome.windows.update(s.originWindowId, { focused: true });
    } else if (tab.windowId !== s.originWindowId || s.mode === "window") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    moveToFront(target.id);
  } catch (e) {
    // The tab was closed while the switcher was open.
    const idx = mru.indexOf(target.id);
    if (idx !== -1) { mru.splice(idx, 1); persistMru(); }
  }
}

async function cancelSwitcher() {
  const s = switcher;
  if (!s) return;
  switcher = null;
  await closeSwitcherUI(s);
  if (s.mode === "window" && s.originWindowId != null) {
    chrome.windows.update(s.originWindowId, { focused: true }).catch(() => { });
  }
}

function isFromCurrentSwitcher(sender) {
  if (!switcher || !sender.tab) return false;
  if (switcher.mode === "overlay") return sender.tab.id === switcher.overlayTabId && sender.frameId === 0;
  return sender.tab.windowId === switcher.windowId;
}

// Messages from the overlay and from switcher.html
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || !message.type.startsWith("switcher_")) return;
  if (message.type === "switcher_open_request") {
    // Alt+Shift+Up/Down caught by the overlay script in a page (Chrome allows
    // only 4 suggested extension shortcuts, so these aren't browser commands).
    if (sender.tab) onHistoryKey(message.step === 1 ? 1 : -1);
    return;
  }
  if (message.type === "switcher_ready") {
    sendResponse(switcher && switcher.mode === "window" ? { items: switcher.items, cursor: switcher.cursor } : null);
    return;
  }
  // Messages are queued, so one sent while the switcher is still opening is
  // checked once opening has finished.
  queueSwitcher(() => {
    if (!isFromCurrentSwitcher(sender)) return; // stale overlay/window
    if (message.type === "switcher_move") return moveSwitcher(message.step);
    if (message.type === "switcher_commit") return commitSwitcher(message.index);
    if (message.type === "switcher_cancel") return cancelSwitcher();
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (switcher && switcher.mode === "window" && switcher.windowId === windowId) switcher = null; // closed by the user
});

// The page showing the overlay was closed or navigated away.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (switcher && switcher.mode === "overlay" && switcher.overlayTabId === tabId) switcher = null;
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && switcher && switcher.mode === "overlay" && switcher.overlayTabId === tabId) {
    switcher = null;
  }
});

/* ---- tracking activations ---- */

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return;
  }
  recordActivation(tab);
  if (!isOwnPage(tab.url) && await isNormalWindow(tab.windowId)) {
    messageBoards({ type: "active_tab_changed", tabId: tab.id });
  }
});

// Switching windows does not fire tabs.onActivated, so record the newly
// focused window's active tab as well.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) recordActivation(tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  const idx = mru.indexOf(tabId);
  if (idx === -1) return;
  mru.splice(idx, 1);
  persistMru();
});

/* ------------------------------------------------------------------ */
/* Keyboard commands                                                   */
/* ------------------------------------------------------------------ */

// Run switcher actions one at a time so fast repeated key presses don't
// interleave (e.g. a second press arriving while the window is opening).
let switcherQueue = Promise.resolve();
function queueSwitcher(fn) {
  switcherQueue = switcherQueue.then(fn).catch(e => console.warn("Tab switcher action failed", e));
}

function onHistoryKey(step) {
  queueSwitcher(() => (switcher ? moveSwitcher(step) : openSwitcher(step)));
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "prev_tab") onHistoryKey(1);       // older
  else if (command === "next_tab") onHistoryKey(-1); // newer
  else if (command === "home") openOrFocusBoard();
});

/* ------------------------------------------------------------------ */
/* Full preview screenshots                                            */
/* ------------------------------------------------------------------ */
// When "full preview" is on (board checkbox), the visible tab is screenshotted
// so the board can show how each tab looked when you last saw it:
//   - shortly after a tab is shown or finishes loading,
//   - right before leaving it via the tab switcher or the board hotkey/icon,
//   - every 30 seconds for the tab you're looking at.
// A tab is never loaded just to preview it: tabs you haven't viewed since
// the feature was turned on (e.g. restored unloaded tabs) simply have none.
// Screenshots are shrunk and stored in IndexedDB (PreviewStore in shared.js).

const PREVIEW_WIDTH = 600;          // stored width in px (shown at 1/8 of the capture size)
const CAPTURE_SPACING_MS = 600;     // captureVisibleTab allows ~2 calls/second

async function previewEnabled() {
  const { fullPreview } = await chrome.storage.local.get("fullPreview");
  return !!fullPreview;
}

function canScreenshot(url) {
  return typeof url === "string" && /^(https?|file|ftp):/.test(url);
}

// Serialize captureVisibleTab calls and keep them under the rate limit.
let captureChain = Promise.resolve();
let lastCaptureAt = 0;
function queueCapture(fn) {
  const run = captureChain.then(async () => {
    const wait = lastCaptureAt + CAPTURE_SPACING_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCaptureAt = Date.now();
    }
  });
  captureChain = run.catch(() => { });
  return run;
}

// Returns the shrunk JPEG plus the capture's original pixel size (the board
// shows previews at 1/8 of that size, keeping the tab's aspect ratio).
async function shrinkScreenshot(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, PREVIEW_WIDTH / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 }), width, height };
}

// Screenshot the visible tab of `windowId` and store it under that tab's id.
// With `expectTabId`, only capture if that tab is still the visible one (the
// capture may run a little later because of the rate limit). Throws if it
// can't be captured.
async function captureVisible(windowId, expectTabId) {
  return queueCapture(async () => {
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (!active) throw new Error("No visible tab");
    if (expectTabId != null && active.id !== expectTabId) throw new Error("Tab no longer visible");
    if (!canScreenshot(active.url) || active.status !== "complete") {
      throw new Error("Tab can't be captured right now");
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
    const { blob, width, height } = await shrinkScreenshot(dataUrl);
    await PreviewStore.put(active.id, { url: active.url, blob, width, height, at: Date.now() });
  });
}

// Screenshot what the user is looking at as they move away (switcher, board
// hotkey). Not awaited by callers: it captures the tab's own contents, so it
// can run while the switcher window opens on top.
async function captureCurrentView() {
  if (!(await previewEnabled())) return;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"], populate: true });
    if (!win || win.state === "minimized") return;
    const active = (win.tabs || []).find(t => t.active);
    if (active) await captureVisible(win.id, active.id);
  } catch (e) { /* nothing visible to capture */ }
}

// Capture a tab shortly after it's shown, once it has finished loading.
const pendingShown = new Map(); // tabId -> timer
function captureWhenShown(tabId, delay = 700) {
  clearTimeout(pendingShown.get(tabId));
  pendingShown.set(tabId, setTimeout(async () => {
    pendingShown.delete(tabId);
    if (!(await previewEnabled())) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active || tab.status !== "complete" || !canScreenshot(tab.url)) return;
      if (!(await isNormalWindow(tab.windowId))) return;
      await captureVisible(tab.windowId);
    } catch (e) { /* tab gone or not capturable */ }
  }, delay));
}

chrome.tabs.onActivated.addListener(({ tabId }) => captureWhenShown(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) captureWhenShown(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { PreviewStore.delete(tabId).catch(() => { }); });
// Tab ids start over in each browser session, so old screenshots are useless.
chrome.runtime.onStartup.addListener(() => { PreviewStore.clear().catch(() => { }); });

// Periodic refresh of the tab being looked at, only while the feature is on.
async function syncPreviewAlarm() {
  if (await previewEnabled()) {
    chrome.alarms.create("preview-refresh", { periodInMinutes: 0.5 });
  } else {
    chrome.alarms.clear("preview-refresh");
  }
}
syncPreviewAlarm();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.fullPreview) syncPreviewAlarm();
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "preview-refresh") return;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (win && win.focused && win.state !== "minimized") await captureVisible(win.id);
  } catch (e) { /* ignore */ }
});
