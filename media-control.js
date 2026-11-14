// Pausing media players in tabs, from the service worker (loaded by
// background.js with importScripts, before force-load.js, which uses
// pauseMediaFor after loading a tab).
//
// The board sends { type: "pause_media", tabIds } (the selection toolbar's
// pause button, or "Pause all media" with every tab) and gets back
// { paused, tabs }: how many players were paused, in how many tabs.
// Unloaded tabs are skipped (they aren't playing, and injecting a script
// would fail), as are pages scripts can't run in (browser pages).

// Runs in the page (every frame). Pauses every playing <video>/<audio>,
// including ones inside open shadow roots, then keeps doing so for `ms` to
// catch players that start late (0 = just once). The capture-phase "play"
// listener catches light-DOM players at once; the interval covers shadow DOM,
// where "play" doesn't reach the document. Returns how many players the first
// pass paused.
// With `untilLoad` (injected while the page is still loading), it stops when
// the page's load event fires instead, with `ms` as the upper limit; the pass
// injected after the load covers the seconds after that.
function pauseMediaFor(ms, untilLoad = false) {
  let pausedNow = 0;
  const pauseIn = (root) => {
    let n = 0;
    for (const el of root.querySelectorAll("video, audio")) {
      if (!el.paused) { try { el.pause(); n++; } catch (e) { /* ignore */ } }
    }
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) n += pauseIn(el.shadowRoot);
    }
    return n;
  };
  const pauseAll = () => { try { return pauseIn(document); } catch (e) { return 0; } };
  pausedNow = pauseAll();
  if (ms > 0) {
    const onPlay = (e) => {
      if (e.target instanceof HTMLMediaElement) { try { e.target.pause(); } catch (err) { /* ignore */ } }
    };
    document.addEventListener("play", onPlay, true);
    const timer = setInterval(pauseAll, 250);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("play", onPlay, true);
    };
    setTimeout(stop, ms);
    if (untilLoad) {
      if (document.readyState === "complete") stop();
      else window.addEventListener("load", () => { pauseAll(); stop(); }, { once: true });
    }
  }
  return pausedNow;
}

// Pause the players in these tabs once. Returns { paused, tabs }.
async function pauseMediaInTabs(tabIds) {
  const tabs = await Promise.all((tabIds || []).map(id => chrome.tabs.get(id).catch(() => null)));
  const targets = tabs.filter(t => t && !t.discarded && t.status !== "unloaded" && !isOwnPage(t.url));
  const results = await Promise.allSettled(targets.map(tab => chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: pauseMediaFor,
    args: [0],
  })));
  let paused = 0, inTabs = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue; // page doesn't allow scripts
    const n = r.value.reduce((sum, frame) => sum + (Number(frame.result) || 0), 0);
    paused += n;
    if (n) inTabs++;
  }
  return { paused, tabs: inTabs };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "pause_media") return false;
  pauseMediaInTabs(message.tabIds)
    .then(sendResponse)
    .catch(e => sendResponse({ paused: 0, tabs: 0, error: e.message }));
  return true; // async response
});
