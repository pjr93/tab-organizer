// "Unsaved" marks on the board: a window box gets a subtle * in its top right
// corner unless it matches what was last saved for it.
//
// What was saved is kept per window as a signature (its title and tab URLs in
// order; see windowSaveSignature in shared.js) in chrome.storage.local
// "savedWindows" ({ windowId: signature }). A window counts as saved while its
// current signature equals the stored one, so adding, closing, moving or
// navigating a tab, or renaming the window, brings the * back, and undoing
// the change removes it again.
//
// Recorded by: an internal save (save dialog), downloading JSON (whole board,
// one window or the selection) and loading a save into new windows. A save of
// only some of a window's tabs records those tabs, so the window stays
// unsaved. Autosaves don't count.
// After a browser restart the background worker carries the signatures over
// to the restored windows along with their titles (titleSnapshot).
//
// Uses from main.js: groupData, titles, pruneWindowMap.

let savedWindows = {};

// The signature of a live window box (its tab array in groupData).
function liveSignature(tabs) {
    if (!tabs || !tabs.length) return null;
    return windowSaveSignature(titles[tabs[0].windowId] || '', tabs);
}

function isWindowSaved(tabs) {
    if (!tabs || !tabs.every || tabs.every(isBoardTab)) return true; // nothing to save
    const sig = savedWindows[tabs[0].windowId];
    return sig != null && sig === liveSignature(tabs);
}

// Toggle the .unsaved class on every window box. Cheap; called after each
// board render and whenever titles or savedWindows change.
function updateUnsavedMarks() {
    if (!groupData) return;
    for (const box of document.querySelectorAll('.child-grid[data-window-id]')) {
        const tabs = groupData.find(g => g[0] && String(g[0].windowId) === box.dataset.windowId);
        box.classList.toggle('unsaved', !isWindowSaved(tabs));
    }
}

// Record windows in the saved format (serializeTabGroups) as saved.
function markWindowsSaved(windows) {
    let changed = false;
    for (const win of windows || []) {
        if (!win || win.windowId == null) continue;
        savedWindows[win.windowId] = windowSaveSignature(win.title || '', win.tabs || []);
        changed = true;
    }
    if (!changed) return;
    chrome.storage.local.set({ savedWindows });
    updateUnsavedMarks();
}

// Windows just created from a save: record what they hold now.
async function markLiveWindowsSaved(windowIds) {
    for (const id of windowIds) {
        try {
            const tabs = await chrome.tabs.query({ windowId: id });
            if (tabs.length) savedWindows[id] = windowSaveSignature(titles[id] || '', tabs);
        } catch (e) { /* window closed meanwhile */ }
    }
    chrome.storage.local.set({ savedWindows });
    updateUnsavedMarks();
}

function pruneSavedWindows(live) {
    pruneWindowMap('savedWindows', live, () => savedWindows, v => { savedWindows = v; updateUnsavedMarks(); });
}

chrome.storage.local.get('savedWindows', ({ savedWindows: stored }) => {
    if (stored && typeof stored === 'object') savedWindows = { ...stored, ...savedWindows };
    updateUnsavedMarks();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.savedWindows) {
        const next = changes.savedWindows.newValue || {};
        if (JSON.stringify(next) !== JSON.stringify(savedWindows)) { // not our own write
            savedWindows = next;
            updateUnsavedMarks();
        }
    }
    if (changes.titles) setTimeout(updateUnsavedMarks, 0); // after main.js adopts them
});
