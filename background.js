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
  await captureCurrentView(); // full preview: remember the tab we're leaving
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
  const { autosaveEnabled, titles = {} } = await chrome.storage.local.get(["autosaveEnabled", "titles"]);
  if (!autosaveEnabled) return;

  // The board sets this while restoring, so we don't save a half-built session.
  const { restoreBusyUntil } = await chrome.storage.session.get("restoreBusyUntil");
  if (restoreBusyUntil && Date.now() < restoreBusyUntil) {
    scheduleAutosave();
    return;
  }

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
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

// Window titles are edited on the board; include renames in the next autosave.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.titles) scheduleAutosave();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "autosave_now") runAutosave();
});

/* ------------------------------------------------------------------ */
/* Tab history (most-recently-used order) and the tab switcher         */
/* ------------------------------------------------------------------ */
//
// `mru` holds tab ids, most recent first. The board tab and tabs in popup
// windows are never included. It lives in chrome.storage.session so it
// survives the service worker being suspended and doesn't need the board.
//
// Alt+Shift+Left/Right opens the switcher (switcher.html) in a small popup
// window listing recent tabs. While it is open it has keyboard focus, so key
// presses go to it rather than the page. Further presses move the highlight
// (Left = older, Right = newer); releasing Alt switches to the highlighted
// tab, Esc cancels. Only the committed tab moves to the front of the list.

const MRU_LIMIT = 200;
const SWITCHER_MAX_ITEMS = 15;

let mru = [];
let switcher = null; // { windowId, pageTabId, items, cursor, originWindowId }

const ready = (async () => {
  const { mru: saved } = await chrome.storage.session.get("mru");
  if (Array.isArray(saved)) {
    mru = saved;
    return;
  }
  // First run in this browser session: seed from each tab's last access time.
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  mru = tabs
    .filter(t => !isBoardUrl(t.url))
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
  if (isBoardUrl(tab.url) || isOwnPage(tab.url)) return;
  if (!(await isNormalWindow(tab.windowId))) return;
  moveToFront(tab.id);
}

/* ---- switcher window ---- */

function tabToItem(tab) {
  return {
    id: tab.id,
    title: tab.title || tab.url || "Untitled",
    url: tab.url || "",
    windowId: tab.windowId,
    discarded: !!tab.discarded,
    audible: !!tab.audible,
  };
}

async function openSwitcher(step) {
  await ready;
  await captureCurrentView(); // full preview: remember the tab we're leaving
  const origin = await chrome.windows.getLastFocused({ populate: true });
  const current = origin && origin.tabs ? origin.tabs.find(t => t.active) : null;

  // Collect the most recent tabs that still exist.
  const items = [];
  for (const id of [...mru]) {
    if (items.length >= SWITCHER_MAX_ITEMS) break;
    try {
      items.push(tabToItem(await chrome.tabs.get(id)));
    } catch (e) {
      mru.splice(mru.indexOf(id), 1);
    }
  }
  persistMru();
  if (!items.length) return;

  // If the current tab heads the list, the first step should skip it.
  const start = current && items[0].id === current.id ? 0 : -1;
  const cursor = Math.max(0, Math.min(items.length - 1, start + step));

  const width = 520;
  const rows = Math.min(items.length, 10);
  const height = 150 + rows * 42;
  const base = origin && origin.width ? origin : { left: 0, top: 0, width: 1280, height: 800 };
  const left = Math.round(base.left + (base.width - width) / 2);
  const top = Math.round(base.top + Math.max(40, (base.height - height) / 3));

  switcher = { windowId: null, pageTabId: null, items, cursor, originWindowId: origin ? origin.id : null };
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("switcher.html"),
      type: "popup",
      focused: true,
      width, height, left, top,
    });
    if (!switcher) { // cancelled while the window was opening
      chrome.windows.remove(win.id).catch(() => { });
      return;
    }
    switcher.windowId = win.id;
    switcher.pageTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
  } catch (e) {
    console.warn("Could not open the tab switcher", e);
    switcher = null;
  }
}

function moveSwitcher(step) {
  if (!switcher) return;
  switcher.cursor = Math.max(0, Math.min(switcher.items.length - 1, switcher.cursor + step));
  if (switcher.pageTabId != null) {
    chrome.tabs.sendMessage(switcher.pageTabId, { type: "switcher_update", cursor: switcher.cursor }).catch(() => { });
  }
}

async function closeSwitcherWindow(s) {
  if (s.windowId != null) await chrome.windows.remove(s.windowId).catch(() => { });
}

async function commitSwitcher(index) {
  const s = switcher;
  if (!s) return;
  switcher = null;
  const target = s.items[Number.isInteger(index) ? index : s.cursor];
  await closeSwitcherWindow(s);
  if (!target) return;
  try {
    const tab = await chrome.tabs.update(target.id, { active: true });
    const { historyStayInApp } = await chrome.storage.local.get("historyStayInApp");
    if (historyStayInApp && s.originWindowId != null) {
      // "view history in app": switch the tab but keep focus where it was.
      await chrome.windows.update(s.originWindowId, { focused: true });
    } else {
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
  await closeSwitcherWindow(s);
  if (s.originWindowId != null) chrome.windows.update(s.originWindowId, { focused: true }).catch(() => { });
}

// Messages from switcher.html
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || !message.type.startsWith("switcher_")) return;
  if (message.type === "switcher_ready") {
    sendResponse(switcher ? { items: switcher.items, cursor: switcher.cursor } : null);
    return;
  }
  // Ignore stale pages (e.g. a switcher window left over from a previous one).
  if (!switcher || !sender.tab || sender.tab.windowId !== switcher.windowId) return;
  if (message.type === "switcher_move") queueSwitcher(() => moveSwitcher(message.step));
  else if (message.type === "switcher_commit") queueSwitcher(() => commitSwitcher(message.index));
  else if (message.type === "switcher_cancel") queueSwitcher(() => cancelSwitcher());
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (switcher && switcher.windowId === windowId) switcher = null; // closed by the user
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

const PREVIEW_WIDTH = 600;          // stored width in px (shown at 300px)
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

async function shrinkScreenshot(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, PREVIEW_WIDTH / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
}

// Screenshot the visible tab of `windowId` and store it for `storeAs.tabId`
// (defaults to that visible tab). Throws if it can't be captured.
async function captureVisible(windowId, storeAs) {
  return queueCapture(async () => {
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (!active) throw new Error("No visible tab");
    const target = storeAs || { tabId: active.id, url: active.url };
    if (!storeAs && (!canScreenshot(active.url) || active.status !== "complete")) {
      throw new Error("Tab can't be captured right now");
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
    const blob = await shrinkScreenshot(dataUrl);
    await PreviewStore.put(target.tabId, { url: target.url, blob, at: Date.now() });
  });
}

// Best-effort capture of what the user is looking at, before they move away.
async function captureCurrentView(timeoutMs = 400) {
  if (!(await previewEnabled())) return;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (!win || win.state === "minimized") return;
    await Promise.race([
      captureVisible(win.id),
      new Promise(r => setTimeout(r, timeoutMs)),
    ]);
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
