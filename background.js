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
/* Tab history (most-recently-used order, like Alt+Tab)                */
/* ------------------------------------------------------------------ */
//
// `mru` holds tab ids, most recent first. The board tab is never included.
// Alt+Shift+Left steps to older tabs, Alt+Shift+Right back toward newer ones.
// While stepping, the order is frozen; the navigation is "committed" (the
// landed-on tab moves to the front) once no history key has been pressed for
// NAV_SETTLE_MS, or as soon as the user activates a tab some other way.
//
// The list lives in chrome.storage.session so it survives the service worker
// being suspended, and does not depend on the board being open.

const MRU_LIMIT = 200;
const NAV_SETTLE_MS = 1000;

let mru = [];
let nav = null;           // { cursor, expectedTabId } while stepping through history
let navTimer = null;

const ready = (async () => {
  const { mru: saved } = await chrome.storage.session.get("mru");
  if (Array.isArray(saved)) {
    mru = saved;
    return;
  }
  // First run in this browser session: seed from each tab's last access time.
  const tabs = await chrome.tabs.query({});
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

function commitNav() {
  clearTimeout(navTimer);
  navTimer = null;
  if (nav && nav.cursor > 0 && nav.cursor < mru.length) {
    moveToFront(mru[nav.cursor]);
  }
  nav = null;
}

async function recordActivation(tab) {
  await ready;
  if (nav && tab.id === nav.expectedTabId) return; // caused by our own navigation
  commitNav();
  if (!isBoardUrl(tab.url)) moveToFront(tab.id);
}

async function navigateHistory(direction) {
  await ready;
  if (!nav) {
    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // If the current tab heads the list, the first step should skip it.
    nav = { cursor: current && current.id === mru[0] ? 0 : -1, expectedTabId: null };
  }

  const step = direction === "older" ? 1 : -1;
  let target = nav.cursor + step;
  while (target >= 0 && target < mru.length) {
    const tabId = mru[target];
    try {
      const tab = await chrome.tabs.get(tabId);
      nav.cursor = target;
      nav.expectedTabId = tabId;
      await chrome.tabs.update(tabId, { active: true });
      const { historyStayInApp } = await chrome.storage.local.get("historyStayInApp");
      if (!historyStayInApp) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      break;
    } catch (e) {
      // Tab no longer exists: drop it and try the next one in the same direction.
      mru.splice(target, 1);
      persistMru();
      if (step < 0) {
        nav.cursor--;   // the removed entry sat before the cursor
        target += step;
      }
    }
  }

  clearTimeout(navTimer);
  navTimer = setTimeout(commitNav, NAV_SETTLE_MS);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return;
  }
  recordActivation(tab);
  if (!isBoardUrl(tab.url)) {
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
  if (nav && idx < nav.cursor) nav.cursor--;
});

/* ------------------------------------------------------------------ */
/* Keyboard commands                                                   */
/* ------------------------------------------------------------------ */

// Run history steps one at a time so fast repeated key presses don't interleave.
let navQueue = Promise.resolve();
function queueNavigate(direction) {
  navQueue = navQueue.then(() => navigateHistory(direction)).catch(e => console.warn("History navigation failed", e));
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "prev_tab") queueNavigate("older");
  else if (command === "next_tab") queueNavigate("newer");
  else if (command === "home") openOrFocusBoard();
});
