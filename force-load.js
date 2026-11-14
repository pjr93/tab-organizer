// Force load: load unloaded tabs in the background, pause any media they
// start, and screenshot them for the board's hover preview.
// Loaded into the service worker by background.js (importScripts), after
// shared.js and media-control.js. Uses from background.js: canScreenshot,
// shrinkScreenshot; from media-control.js: pauseMediaFor; from
// shared.js: isBoardTab, PreviewStore.
//
// The board sends { type: "force_load", tabIds } and gets back { queued }
// (tabs already loaded, closed, or already queued are skipped). Progress is
// published in chrome.storage.session "forceLoad" =
//   { pending: [tabIds queued or in progress], done, total, failed }
// so any board (including one opened mid-job) can show it.
//
// Pipeline, so that nothing waits on anything it doesn't need:
//   load slots ("parallel loads" setting, default 8): mute the tab (if it
//     wasn't) -> reload -> as soon as the page starts loading, inject a
//     pause watcher that runs until the page's load event -> wait until the
//     load completes or the "load timeout seconds" setting passes -> inject
//     a pause watcher for the next few seconds -> hand the tab to the
//     screenshot queue and take the next tab.
//   screenshot queue (2 at a time): screenshot through the debugger (works
//     for tabs that aren't visible, unlike captureVisibleTab).
//   unmute timers: each tab is unmuted once its pause watcher has finished.
//     Pending unmutes are kept in chrome.storage.session "forceLoadMuted" so
//     a tab is still unmuted if the worker is stopped mid-job.
// Each tab's timings are logged to the service worker console
// ("[force load] ..."), plus a summary when the job is done.

const FORCE_LOAD_DEFAULT_PARALLEL = 8;
const FORCE_LOAD_MAX_PARALLEL = 32;
const FORCE_LOAD_DEFAULT_TIMEOUT_SEC = 6;
const PAUSE_WATCH_MS = 4000;      // keep pausing late-starting players this long after the load
const SCREENSHOT_CONCURRENCY = 2;
const DEBUGGER_CAPTURE_TIMEOUT_MS = 5000;
const FORCE_LOAD_RESET_MS = 3000; // keep the final count shown this long

/* ---------------- settings ---------------- */

let forceLoadParallel = FORCE_LOAD_DEFAULT_PARALLEL;
let forceLoadTimeoutMs = FORCE_LOAD_DEFAULT_TIMEOUT_SEC * 1000;

async function readForceLoadSettings() {
  const { forceLoadParallel: p, forceLoadTimeoutSec: t } =
    await chrome.storage.local.get(["forceLoadParallel", "forceLoadTimeoutSec"]);
  const parallel = Math.round(Number(p));
  forceLoadParallel = parallel >= 1 ? Math.min(parallel, FORCE_LOAD_MAX_PARALLEL) : FORCE_LOAD_DEFAULT_PARALLEL;
  const sec = Number(t);
  forceLoadTimeoutMs = (sec > 0 ? sec : FORCE_LOAD_DEFAULT_TIMEOUT_SEC) * 1000;
}
const forceLoadSettingsReady = readForceLoadSettings().catch(() => { });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.forceLoadParallel || changes.forceLoadTimeoutSec)) return;
  readForceLoadSettings().then(() => pumpForceLoad()).catch(() => { });
});

/* ---------------- job state ---------------- */

const forceLoadJob = {
  queue: [],             // tab ids waiting for a load slot
  loading: new Set(),    // tab ids in a load slot
  shotQueue: [],         // { tabId, tab, timing } waiting for a screenshot
  shooting: new Set(),   // tab ids being screenshotted
  done: 0, total: 0, failed: 0,
  startedAt: 0, shotFailures: 0,
};
let forceLoadResetTimer = null;

// The job lives in memory: if the worker was stopped, anything published
// before is stale, and tabs it had muted must be unmuted.
chrome.storage.session.remove("forceLoad").catch(() => { });
chrome.storage.session.get("forceLoadMuted").then(({ forceLoadMuted = [] }) => {
  for (const id of forceLoadMuted) chrome.tabs.update(id, { muted: false }).catch(() => { });
  return chrome.storage.session.remove("forceLoadMuted");
}).catch(() => { });

function forceLoadPendingIds() {
  const j = forceLoadJob;
  return [...j.queue, ...j.loading, ...j.shotQueue.map(i => i.tabId), ...j.shooting];
}

function publishForceLoad() {
  const j = forceLoadJob;
  chrome.storage.session.set({
    forceLoad: { pending: forceLoadPendingIds(), done: j.done, total: j.total, failed: j.failed },
  }).catch(() => { });
}

function needsLoading(tab) {
  return tab && !isBoardTab(tab) && (tab.discarded || tab.status === "unloaded");
}

async function enqueueForceLoad(tabIds) {
  await forceLoadSettingsReady;
  const tabs = await Promise.all((tabIds || []).map(id => chrome.tabs.get(id).catch(() => null)));
  const known = new Set(forceLoadPendingIds());
  let queued = 0;
  for (const tab of tabs) {
    if (!needsLoading(tab) || known.has(tab.id)) continue;
    known.add(tab.id);
    forceLoadJob.queue.push(tab.id);
    queued++;
  }
  if (queued) {
    clearTimeout(forceLoadResetTimer);
    if (!forceLoadJob.total) forceLoadJob.startedAt = Date.now();
    forceLoadJob.total += queued;
    publishForceLoad();
    pumpForceLoad();
  }
  return queued;
}

/* ---------------- load slots ---------------- */

function pumpForceLoad() {
  const j = forceLoadJob;
  while (j.loading.size < forceLoadParallel && j.queue.length) {
    const tabId = j.queue.shift();
    j.loading.add(tabId);
    loadTabForForceLoad(tabId)
      .catch(e => {
        unmuteNow(tabId);
        return { tabId, ok: false, timing: { url: "", note: `failed: ${e.message}` } };
      })
      .then(result => {
        j.loading.delete(tabId);
        if (result.tab && canScreenshot(result.tab.url)) {
          j.shotQueue.push(result);
          pumpScreenshots();
        } else {
          finishForceLoadTab(result.ok, result.timing);
        }
        publishForceLoad();
        pumpForceLoad();
      });
  }
}

// Resolves "complete", "timeout" or "closed". Calls onLoading once, when the
// tab starts loading.
function waitForLoad(tabId, ms, onLoading) {
  return new Promise(resolve => {
    let started = false;
    const finish = (how) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(how);
    };
    const onUpdated = (id, changeInfo) => {
      if (id !== tabId) return;
      if (changeInfo.status === "loading" && !started) { started = true; onLoading(); }
      if (changeInfo.status === "complete") finish("complete");
    };
    const onRemoved = (id) => { if (id === tabId) finish("closed"); };
    const timer = setTimeout(() => finish("timeout"), ms);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// Inject the pause watcher (media-control.js) into every frame. Failures are
// ignored (pages scripts can't run in; a document that isn't there yet).
async function injectPause(tabId, ms, untilLoad = false) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: pauseMediaFor,
      args: [ms, untilLoad],
      injectImmediately: untilLoad, // don't wait for the page to be idle
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Returns { tabId, ok, timing, tab? } — `tab` when it should be screenshotted.
async function loadTabForForceLoad(tabId) {
  const t0 = Date.now();
  let tab = await chrome.tabs.get(tabId).catch(() => null);
  const timing = { url: tab ? (tab.url || tab.pendingUrl || "") : "", loadMs: 0, loadedBy: "", shotMs: null, note: "" };
  if (!needsLoading(tab)) return { tabId, ok: true, timing: { ...timing, note: "skipped (already loaded or closed)" } };

  if (!(tab.mutedInfo && tab.mutedInfo.muted)) await muteForLoad(tabId);

  // Pause from the moment the page starts loading (autoplay usually starts
  // before the load finishes). The first try can come before the new
  // document exists, so try once more shortly after.
  const loaded = waitForLoad(tabId, forceLoadTimeoutMs, () => {
    injectPause(tabId, forceLoadTimeoutMs, true).then(ok => {
      if (!ok) setTimeout(() => injectPause(tabId, forceLoadTimeoutMs, true), 300);
    });
  });
  await chrome.tabs.reload(tabId);
  timing.loadedBy = await loaded;
  timing.loadMs = Date.now() - t0;
  if (timing.loadedBy === "closed") {
    unmuteNow(tabId);
    return { tabId, ok: true, timing };
  }

  // Keep catching late players for a few seconds; unmute after that, without
  // holding this load slot.
  await injectPause(tabId, PAUSE_WATCH_MS);
  scheduleUnmute(tabId, PAUSE_WATCH_MS);

  tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { tabId, ok: true, timing };
  timing.url = tab.url || timing.url;
  return { tabId, ok: true, timing, tab };
}

/* ---------------- screenshot queue ---------------- */

function pumpScreenshots() {
  const j = forceLoadJob;
  while (j.shooting.size < SCREENSHOT_CONCURRENCY && j.shotQueue.length) {
    const item = j.shotQueue.shift();
    j.shooting.add(item.tabId);
    const t0 = Date.now();
    screenshotWithDebugger(item.tab)
      .then(() => true, (e) => {
        item.timing.note = `screenshot failed: ${e.message}`;
        j.shotFailures++;
        return false;
      })
      .then(ok => {
        item.timing.shotMs = Date.now() - t0;
        j.shooting.delete(item.tabId);
        finishForceLoadTab(ok, item.timing);
        pumpScreenshots();
      });
  }
}

// Same record shape as captureVisible in background.js.
async function screenshotWithDebugger(tab) {
  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, "1.3");
  try {
    const result = await withTimeout(
      chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "jpeg", quality: 80 }),
      DEBUGGER_CAPTURE_TIMEOUT_MS, "Screenshot");
    const { blob, width, height } = await shrinkScreenshot("data:image/jpeg;base64," + result.data);
    await PreviewStore.put(tab.id, { url: tab.url, blob, width, height, at: Date.now() });
  } finally {
    await chrome.debugger.detach(target).catch(() => { });
  }
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/* ---------------- finishing ---------------- */

function finishForceLoadTab(ok, timing) {
  const j = forceLoadJob;
  j.done++;
  if (!ok) j.failed++;
  logForceLoadTab(timing);
  publishForceLoad();
  if (!j.queue.length && !j.loading.size && !j.shotQueue.length && !j.shooting.size) {
    const secs = ((Date.now() - j.startedAt) / 1000).toFixed(1);
    console.info(`[force load] done: ${j.total} tab(s) in ${secs}s, ${j.failed} with problems` +
      (j.shotFailures ? `, ${j.shotFailures} screenshot(s) failed` : ""));
    forceLoadResetTimer = setTimeout(() => {
      j.done = j.total = j.failed = j.shotFailures = 0;
      publishForceLoad();
    }, FORCE_LOAD_RESET_MS);
  }
}

function logForceLoadTab(t) {
  const parts = [];
  if (t.loadedBy) parts.push(`load ${(t.loadMs / 1000).toFixed(1)}s (${t.loadedBy})`);
  if (t.shotMs != null) parts.push(`screenshot ${(t.shotMs / 1000).toFixed(1)}s`);
  if (t.note) parts.push(t.note);
  console.info(`[force load] ${parts.join(" · ")} · ${t.url}`);
}

/* ---------------- muting ---------------- */

const forceLoadMuted = new Map(); // tabId -> unmute timer (or null until scheduled)

function persistForceLoadMuted() {
  chrome.storage.session.set({ forceLoadMuted: [...forceLoadMuted.keys()] }).catch(() => { });
}

async function muteForLoad(tabId) {
  forceLoadMuted.set(tabId, null);
  persistForceLoadMuted();
  await chrome.tabs.update(tabId, { muted: true }).catch(() => { });
}

function scheduleUnmute(tabId, ms) {
  if (!forceLoadMuted.has(tabId)) return;
  clearTimeout(forceLoadMuted.get(tabId));
  forceLoadMuted.set(tabId, setTimeout(() => unmuteNow(tabId), ms));
}

function unmuteNow(tabId) {
  if (!forceLoadMuted.has(tabId)) return;
  clearTimeout(forceLoadMuted.get(tabId));
  forceLoadMuted.delete(tabId);
  persistForceLoadMuted();
  chrome.tabs.update(tabId, { muted: false }).catch(() => { });
}

/* ---------------- messages ---------------- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "force_load") return false;
  enqueueForceLoad(message.tabIds)
    .then(queued => sendResponse({ queued }))
    .catch(e => sendResponse({ queued: 0, error: e.message }));
  return true; // async response
});
