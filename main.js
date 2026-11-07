//I should probably rewrite this to use worker scripts

const parentGrid = document.getElementById('parent-grid');
const dropIndicator = document.getElementById('drop-indicator');
const outsideOverlay = document.getElementById('outside-overlay');

//probably want hash maps here
let lastSelectedIndex = null;
let draggedItem = null;
let draggedId = null;
let placeholder = null;
let nextItemId = 1;
let windowGroupData = [];
let titles = {};
// Board order of windows (window ids). The browser API has no window order to
// read or set, so the board keeps its own; new windows are appended. Saves are
// written in this order and restores create windows in it, so it carries over.
let windowOrder = [];
let draggedWindowId = null;
let selectedTabIds = new Set();
let groupData; //probably should be json object
let windowData;
let currentActiveTabId = null;
// APP_URL, isBoardTab, serializeTabGroups etc. come from shared.js.

// Built with DOM nodes / textContent (not innerHTML) so page titles and URLs
// can never inject markup into the extension page.
function showTabPreview(tab, anchorEl) {
    let preview = document.getElementById('tab-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'tab-hover-preview';
        document.body.appendChild(preview);
    }
    preview.replaceChildren();

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;';
    if (tab.favIconUrl) {
        const img = document.createElement('img');
        img.src = tab.favIconUrl;
        img.width = 20;
        img.height = 20;
        img.style.borderRadius = '3px';
        header.appendChild(img);
    }
    const titleEl = document.createElement('b');
    titleEl.textContent = tab.title || tab.text || '';
    header.appendChild(titleEl);

    const urlEl = document.createElement('div');
    urlEl.style.color = '#8ab4f8';
    urlEl.textContent = tab.url || '';

    preview.append(header, urlEl);

    const token = ++previewToken;
    preview.style.maxWidth = '';
    preview.style.display = "block";
    positionPreview(preview, anchorEl);
    if (fullPreviewEnabled && !isBoardTab(tab)) fillPreviewShot(tab, preview, anchorEl, token);
}

// Place below the tile, or above it if there isn't room; keep it on screen.
function positionPreview(preview, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const box = preview.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - 4 && rect.top - 6 - box.height >= 4) {
        top = rect.top - 6 - box.height;
    }
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - box.width - 4));
    preview.style.top = top + "px";
    preview.style.left = left + "px";
}

let previewToken = 0;      // bumps on every show/hide so stale async work is ignored
let previewObjectUrl = null;
let fullPreviewEnabled = false;
const PREVIEW_SCALE = 8;   // previews show at 1/8 of the captured size

// Show the last screenshot taken of this tab, if it still matches the tab's
// URL. Tabs are never loaded just to preview them, so a tab you haven't viewed
// (e.g. one restored unloaded) only gets a short note.
async function fillPreviewShot(tab, preview, anchorEl, token) {
    let record = null;
    try { record = await PreviewStore.get(tab.id); } catch (e) { /* no store */ }
    if (token !== previewToken) return;

    if (record && record.url === tab.url && record.blob) {
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = URL.createObjectURL(record.blob);
        const shotBox = document.createElement('div');
        shotBox.id = 'preview-shot';
        // 1/8 of the original capture size, so the box keeps the tab's aspect
        // ratio. Older screenshots have no size stored: 240px wide, natural ratio.
        if (record.width && record.height) {
            shotBox.style.width = Math.round(record.width / PREVIEW_SCALE) + 'px';
            shotBox.style.height = Math.round(record.height / PREVIEW_SCALE) + 'px';
        } else {
            shotBox.style.width = '240px';
        }
        preview.style.maxWidth = `max(420px, ${shotBox.style.width})`;
        const img = document.createElement('img');
        img.src = previewObjectUrl;
        img.alt = 'Tab preview';
        const age = document.createElement('div');
        age.className = 'preview-shot-age';
        age.textContent = 'as of ' + new Date(record.at).toLocaleTimeString();
        shotBox.append(img, age);
        preview.appendChild(shotBox);
    } else {
        const note = document.createElement('div');
        note.className = 'preview-none';
        note.textContent = 'No screenshot yet (taken when you view the tab)';
        preview.appendChild(note);
    }
    positionPreview(preview, anchorEl);
}

function hideTabPreview() {
    previewToken++;
    const preview = document.getElementById('tab-hover-preview');
    if (preview) preview.style.display = "none";
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
}

function highlightActiveTab() {
    const allItems = document.querySelectorAll('.grid-item');
    allItems.forEach(item => {
        if (Number(item.dataset.id) === currentActiveTabId) {
            item.classList.add('active-tab-glow');
        } else { item.classList.remove('active-tab-glow'); }
    });
}
// message events - highlightActiveTab - syncGroupDataFromBrowser
chrome.runtime.onMessage.addListener((message) => {
    // Tab history itself lives in background.js; the board only shows the glow.
    if (message.type === "active_tab_changed") {
        currentActiveTabId = message.tabId;
        highlightActiveTab();
    }
    if (message.type === "sync_browser_state") {
        if (message.focusWindowId != null) focusWindowBox(message.focusWindowId);
        syncGroupDataFromBrowser();
    }
});

/* ------------------------------------------------------------------ */
/* Saving and restoring layouts                                        */
/* ------------------------------------------------------------------ */
// Saved format: see serializeTabGroups in shared.js.

// Convert board groups into the saved format.
function serializeGroups(groups = groupData) {
    return serializeTabGroups(groups, titles);
}

// Throws a readable error if `saved` isn't a layout we can restore.
// Returns the windows with board tabs and unusable entries removed.
function prepareSavedLayout(saved) {
    if (!Array.isArray(saved)) throw new Error('File is not a saved tab layout (expected a list of windows).');
    const windows = saved
        .filter(win => win && Array.isArray(win.tabs))
        .map(win => ({
            title: typeof win.title === 'string' ? win.title : '',
            tabs: win.tabs.filter(t => t && typeof t.url === 'string' && t.url && !isBoardTab(t)),
        }))
        .filter(win => win.tabs.length > 0);
    if (windows.length === 0) throw new Error('The saved layout contains no tabs to restore.');
    return windows;
}

// Resolve once a newly created tab has committed its URL (or after a timeout),
// so that discarding it keeps the right address.
function waitForTabUrl(tabId, timeoutMs = 3000) {
    return new Promise(resolve => {
        const done = () => {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        const listener = (id, changeInfo) => {
            if (id === tabId && (changeInfo.url || changeInfo.status === 'complete')) done();
        };
        const timer = setTimeout(done, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Create a background tab and unload it right away so it costs almost nothing
// until the user opens it.
async function createUnloadedTab(windowId, url) {
    const tab = await chrome.tabs.create({ windowId, url, active: false });
    await waitForTabUrl(tab.id);
    try {
        await chrome.tabs.discard(tab.id);
    } catch (e) {
        // Some pages (e.g. browser-internal ones) can't be discarded; leave them loaded.
    }
    return tab;
}

// Run `fn` over `items` with at most `limit` running at once.
async function runLimited(items, limit, fn) {
    const results = [];
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = { ok: true, value: await fn(items[i], i) };
            } catch (error) {
                results[i] = { ok: false, error };
            }
        }
    });
    await Promise.all(workers);
    return results;
}

let restoreInProgress = false;

// Recreate the saved windows. With replace=true, every existing tab except the
// board is closed, but only after the saved windows have been created.
async function restoreState(saved, { replace = false } = {}) {
    if (restoreInProgress) {
        alert('A restore is already in progress.');
        return;
    }
    const windows = prepareSavedLayout(saved);
    restoreInProgress = true;
    // Tell the background autosave to hold off so it doesn't capture a
    // half-restored session (expires on its own in case this page dies).
    await chrome.storage.session.set({ restoreBusyUntil: Date.now() + 10 * 60 * 1000 });
    const failed = [];
    try {
        const boardWindow = await chrome.windows.getCurrent();
        const toClose = replace
            ? (await chrome.tabs.query({ windowType: 'normal' })).filter(t => !isBoardTab(t)).map(t => t.id)
            : [];

        for (const win of windows) {
            const [first, ...rest] = win.tabs;
            let newWindow;
            try {
                newWindow = await chrome.windows.create({ state: 'maximized', focused: true, url: first.url });
            } catch (e) {
                // The first URL may be one the browser refuses to open; fall back to a blank window.
                failed.push(first.url);
                newWindow = await chrome.windows.create({ state: 'maximized', focused: true });
            }
            // Keep the user on the board while the rest of the window fills in.
            await chrome.windows.update(boardWindow.id, { focused: true });

            if (win.title && win.title !== '_' && win.title !== '-') {
                titles[newWindow.id] = win.title;
            }
            // Keep the saved board order: each restored window goes to the end.
            windowOrder = windowOrder.filter(id => id !== newWindow.id).concat(newWindow.id);
            chrome.storage.local.set({ windowOrder });

            const results = await runLimited(rest, 6, tab => createUnloadedTab(newWindow.id, tab.url));
            results.forEach((r, i) => { if (!r.ok) failed.push(rest[i].url); });
        }
        chrome.storage.local.set({ titles });

        if (toClose.length) {
            await chrome.tabs.remove(toClose).catch(e => console.warn('Failed to close some tabs:', e));
        }
    } finally {
        restoreInProgress = false;
        chrome.storage.session.remove('restoreBusyUntil');
        syncGroupDataFromBrowser();
    }

    if (failed.length) {
        console.warn('Tabs that could not be restored:', failed);
        alert(`${failed.length} tab(s) could not be restored (see the console with F12 for the list).`);
    }
}

function downloadStateAsFile(groups = groupData) {
    downloadJson(serializeGroups(groups), 'tab_layout.json');
}

// Download a saved layout (or any data) as a .json file.
function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Give the download a moment to start before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// append=false replaces the current session; append=true adds to it.
function uploadStateFromFile(file, append = false) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const saved = JSON.parse(e.target.result);
            await restoreState(saved, { replace: !append });
        } catch (err) {
            console.error(err);
            alert(`Could not load "${file.name}": ${err.message}`);
        }
    };
    reader.readAsText(file);
}

// Internal saves (named, in folders) live in saves.js.

function defaultSessionName() {
    return 'Session ' + new Date().toLocaleString();
}

function saveSessionInternal() {
    if (document.querySelector('dialog[open]')) return;
    openSaveDialog(serializeGroups(groupData || []), defaultSessionName());
}


function createEditableTitleBox(parentElement, windowId) {
    const title = document.createElement('input');
    title.className = 'editable-title';
    title.id = `window-title-${windowId}`;
    title.value = titles[windowId] || "";
    parentElement.appendChild(title);
    
    title.addEventListener('change', () =>{
        titles[windowId] = title.value
        console.log(titles[windowId], title.value)
        chrome.storage.local.set({ titles }, () => { });
    })
    return title;
}

// Drop titles for windows that no longer exist (window ids are not reused
// within a browser session, so a stale entry can never be shown again).
function pruneTitles(windows) {
    const live = new Set(windows.map(w => String(w.id)));
    let changed = false;
    for (const id of Object.keys(titles)) {
        if (!live.has(id)) { delete titles[id]; changed = true; }
    }
    if (changed) chrome.storage.local.set({ titles });
}

// Sort windows into the board's saved order; windows not in it yet (new ones)
// go at the end. Closed windows are dropped from the saved order.
function applyWindowOrder(windows) {
    const byId = new Map(windows.map(w => [w.id, w]));
    const ordered = windowOrder.filter(id => byId.has(id)).map(id => byId.get(id));
    const known = new Set(ordered.map(w => w.id));
    for (const w of windows) if (!known.has(w.id)) ordered.push(w);
    const newOrder = ordered.map(w => w.id);
    if (newOrder.join() !== windowOrder.join()) {
        windowOrder = newOrder;
        chrome.storage.local.set({ windowOrder });
    }
    return ordered;
}

// Move a window box before/after another one on the board.
function moveWindowOnBoard(movedId, targetId, after) {
    const order = groupData.map(g => g[0] && g[0].windowId).filter(id => id != null);
    const from = order.indexOf(movedId);
    if (from === -1 || movedId === targetId) return;
    order.splice(from, 1);
    let to = order.indexOf(targetId);
    if (to === -1) return;
    if (after) to++;
    order.splice(to, 0, movedId);
    windowOrder = order;
    chrome.storage.local.set({ windowOrder });
    const byId = new Map(groupData.map(g => [g[0].windowId, g]));
    groupData = order.map(id => byId.get(id));
    renderBoard();
}

function clearWindowDropMarks() {
    document.querySelectorAll('.child-grid.drop-before, .child-grid.drop-after')
        .forEach(el => el.classList.remove('drop-before', 'drop-after'));
}

//Gets tab data from the chrome API - renderBoard
// Only normal browser windows are shown; popup windows (the tab switcher, the
// preview capture window, site popups) are left out.
function syncGroupDataFromBrowser() {
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        if (chrome.runtime.lastError) return;
        pruneTitles(windows);
        windows = applyWindowOrder(windows);
        groupData = windows.map(win => {
            return (win.tabs || []).map(tab => ({
                id: tab.id, // also seems redundant
                text: tab.title ? tab.title : tab.url || "No title",
                windowId: win.id, //this is redundant
                groupId: tab.groupId || null,
                ...tab
            }));
        });
        renderBoard();
    });
}




//edge case for dragging - hideDropIndicator - deactivateOutsideOverlay - showDropIndicator - activateOutsideOverlay
function onDragAnywhere(ev) {
    const grids = Array.from(document.elementsFromPoint(ev.clientX, ev.clientY))
        .filter(e => e.classList && e.classList.contains('child-grid'));
    if (grids.length === 0 && draggedItem) {
        showDropIndicator(ev.clientX, ev.clientY);
        activateOutsideOverlay();
    } else {
        hideDropIndicator();
        deactivateOutsideOverlay();
    }
}

function showDropIndicator(x, y) {
    dropIndicator.style.display = 'block';
    dropIndicator.style.left = (x + 14) + 'px';
    dropIndicator.style.top = (y - 28) + 'px';
}

function hideDropIndicator() {
    dropIndicator.style.display = 'none';
}

function clearPlaceholder() {
    if (placeholder && placeholder.parentElement) {
        placeholder.parentElement.removeChild(placeholder);
        placeholder = null;
    }
}

// Move tabs (in the given order) into a window so the first one lands at
// `index` and the rest follow it. `index` counts only the tabs that are NOT
// being moved. Done in two steps so it also works for tabs already in the
// target window: first append them all to the end, then move the block, which
// now sits entirely after `index`, into place.
async function moveTabsToWindow(tabIds, windowId, index) {
    try {
        await chrome.tabs.move(tabIds, { windowId, index: -1 });
        await chrome.tabs.move(tabIds, { windowId, index });
    } catch (e) {
        console.warn('Failed to move tabs', e);
    }
    syncGroupDataFromBrowser();
}

function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.grid-item:not(.dragging)')];
    let afterElement = null;
    let minDistance = Infinity;
    for (const child of draggableElements) {
        const box = child.getBoundingClientRect();
        if (y >= box.top && y <= box.bottom) {
            const offset = x - box.left;
            if (offset < 0 && Math.abs(offset) < minDistance) {
                minDistance = Math.abs(offset);
                afterElement = child;
            }
        }
    }
    if (!afterElement) {
        for (const child of draggableElements) {
            const box = child.getBoundingClientRect();
            if (box.top > y) {
                const dist = box.top - y;
                if (dist < minDistance) {
                    minDistance = dist;
                    afterElement = child;
                }
            }
        }
    }
    return afterElement;
}

// creates the group UI element which holds the tabs - createPlaceholder - removeFromGroupData - moveTabsToWindow - renderBoard - hideDropIndicator - deactivateOutsideOverlay - syncGroupDataFromBrowser - downloadStateAsFile - createGridItem - createEditableTextbox
function createGroup(items = [], idx, windowId = null, titleText = '-') {
    const group = document.createElement('div');
    group.className = 'child-grid';
    group.dataset.group = idx;
    if (windowId != null) {
        group.dataset.windowId = windowId;
        applyFocusFlash(group, windowId);
    }


    const plusTabBtn = document.createElement('button');
    plusTabBtn.className = 'plus-tab-btn';
    plusTabBtn.textContent = '＋';
    plusTabBtn.title = "Add new tab";
    plusTabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (windowId != null) {
            chrome.tabs.create({ windowId: windowId, active: false }, () => {
                syncGroupDataFromBrowser();
            });
        }
    });
    group.appendChild(plusTabBtn);

    // Move the whole window box by dragging its empty space (the padding and
    // the gaps between tabs). Pressing on a tab, button or the title keeps
    // their normal behaviour, so the box is only made draggable for presses
    // that land directly on it.
    group.addEventListener('mousedown', e => {
        group.draggable = e.target === group;
    });
    group.addEventListener('dragstart', e => {
        if (e.target !== group) return; // a tab being dragged (bubbled up)
        draggedWindowId = windowId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'window');
        setTimeout(() => group.classList.add('window-dragging'), 0);
    });
    group.addEventListener('dragend', e => {
        if (e.target !== group) return;
        draggedWindowId = null;
        group.draggable = false;
        group.classList.remove('window-dragging');
        clearWindowDropMarks();
    });

    // Window being dragged over this box: mark the side it would land on.
    function windowDropSide(e) {
        // Boxes stack down columns, so the top half = before, bottom half = after.
        const r = group.getBoundingClientRect();
        return e.clientY > r.top + r.height / 2 ? 'after' : 'before';
    }

    group.addEventListener('dragover', e => {
        if (draggedWindowId != null) {
            e.preventDefault();
            clearWindowDropMarks();
            if (draggedWindowId !== windowId) group.classList.add('drop-' + windowDropSide(e));
            return;
        }
        e.preventDefault();
        group.classList.add('dragover');
        if (!draggedItem) return;
        const afterElement = getDragAfterElement(group, e.clientX, e.clientY);
        clearPlaceholder();
        placeholder = document.createElement('div');
        placeholder.classList.add('placeholder');
        placeholder.style.minHeight = draggedItem.offsetHeight + 'px';
        placeholder.style.width = draggedItem.offsetWidth + 'px';
        if (afterElement == null) {
            group.appendChild(placeholder);
        } else {
            group.insertBefore(placeholder, afterElement);
        }
    });

    group.addEventListener('dragleave', e => {
        if (e.relatedTarget && !group.contains(e.relatedTarget)) {
            group.classList.remove('dragover', 'drop-before', 'drop-after');
            clearPlaceholder();
        }
    });

    group.addEventListener('drop', e => {
        e.preventDefault();
        group.classList.remove('dragover');
        if (draggedWindowId != null) {
            const moved = draggedWindowId;
            const side = windowDropSide(e);
            draggedWindowId = null;
            clearWindowDropMarks();
            moveWindowOnBoard(moved, windowId, side === 'after');
            return;
        }
        if (!draggedItem || draggedId === null) return;
        let tabsToMove = Array.from(selectedTabIds).map(id => getItemById(id)).filter(Boolean);
        if (!tabsToMove.length) tabsToMove = [getItemById(draggedId)];
        tabsToMove = tabsToMove.filter(Boolean);
        // Keep the moved tabs in their on-screen order, not the order they were selected.
        const screenOrder = Array.from(document.querySelectorAll('.grid-item')).map(el => Number(el.dataset.id));
        tabsToMove.sort((a, b) => screenOrder.indexOf(a.id) - screenOrder.indexOf(b.id));
        const movingIds = new Set(tabsToMove.map(t => t.id));
        for (const tab of tabsToMove) {
            removeFromGroupData(tab.id);
        }
        // Drop position counted among the tabs that stay put (the dragged tiles
        // are only hidden, so they must be excluded explicitly).
        const childrenArray = Array.from(group.children).filter(ch =>
            (ch.classList.contains('grid-item') && !movingIds.has(Number(ch.dataset.id))) || ch === placeholder
        );
        let newIndex = placeholder && placeholder.parentElement === group
            ? childrenArray.indexOf(placeholder)
            : childrenArray.length;
        clearPlaceholder();
        const targetWindowId = windowId != null
            ? windowId
            : (tabsToMove.length ? tabsToMove[0].windowId : null);
        if (targetWindowId != null && tabsToMove.length) {
            moveTabsToWindow(tabsToMove.map(t => t.id), targetWindowId, newIndex);
        }
        if (!groupData[idx]) groupData[idx] = [];
        groupData[idx].splice(newIndex, 0, ...tabsToMove);
        renderBoard();
        hideDropIndicator();
        deactivateOutsideOverlay();
        selectedTabIds.clear();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'group-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = "Delete this group";
    deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (groupData[idx] && groupData[idx].length > 0) {
            const windowId = groupData[idx][0].windowId;
            chrome.windows.remove(windowId, () => {
                syncGroupDataFromBrowser();
            });
        } else {
            groupData.splice(idx, 1);
            renderBoard();
        }
    });
    group.appendChild(deleteBtn);

    // Save group button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'group-save-btn';
    saveBtn.textContent = '';
    saveBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V3zm-6 15h14v3H5v-3z" />'
    saveBtn.title = 'Download this window as JSON';
    saveBtn.windowId = windowId
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupDataToSave = groupData[idx];
        if (groupDataToSave && groupDataToSave.length > 0) {
            downloadStateAsFile([groupDataToSave]);
        }
    });
    group.appendChild(saveBtn);

    // Save this window as an internal save (a one-window session).
    const saveInternalBtn = document.createElement('button');
    saveInternalBtn.className = 'group-save-btn group-save-internal-btn';
    saveInternalBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v4h8V5H7zm5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
    saveInternalBtn.title = 'Save this window internally';
    saveInternalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabs = groupData[idx];
        if (!tabs || !tabs.length) return;
        const name = titles[windowId] || tabs.find(t => !isBoardTab(t))?.title || 'Window';
        openSaveDialog(serializeGroups([tabs]), name);
    });
    group.appendChild(saveInternalBtn);

    for (const itemObj of items) {
        //console.log('item obj:',itemObj)
        group.appendChild(createGridItem(itemObj));
    }
    createEditableTitleBox(group, windowId);
    return group;
}

// Speaker icon for tabs that are playing sound (🔊) or muted (🔇). Clicking it
// toggles mute without leaving the board. Returns null for silent tabs.
function createAudioButton(itemObj) {
    const muted = !!(itemObj.mutedInfo && itemObj.mutedInfo.muted);
    if (!itemObj.audible && !muted) return null;
    const btn = document.createElement('button');
    btn.className = 'audio-btn';
    btn.type = 'button';
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Unmute tab' : 'Mute tab';
    btn.draggable = false;
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('click', e => {
        e.stopPropagation();
        chrome.tabs.update(itemObj.id, { muted: !muted });
    });
    return btn;
}

//creates the tab UI element - onDragAnywhere - hideDropIndicator - deactivateOutsideOverlay - clearPlaceholder - showTabPreview - hideTabPreview
function createGridItem(itemObj) {
    // Container
    const item = document.createElement('div');
    item.classList.add('grid-item');


    // Create the favicon image element
    const faviconImg = document.createElement('img');
    faviconImg.src = getFaviconUrl(itemObj.url, 16); // 16x16 px size is typical for icons
    faviconImg.alt = 'favicon';
    faviconImg.style.width = '16px';
    faviconImg.style.height = '16px';
    faviconImg.style.marginRight = '0px';
    faviconImg.style.verticalAlign = 'middle';
    faviconImg.style.borderRadius = '3px'; // optional styling

    // Create a span for the text content
    const textSpan = document.createElement('span');
    textSpan.textContent = itemObj.text;


    // Clear existing content and append favicon + text
    item.textContent = '';
    item.appendChild(faviconImg);
    const audioBtn = createAudioButton(itemObj);
    if (audioBtn) item.appendChild(audioBtn);
    item.appendChild(textSpan);
    if (itemObj.id === currentActiveTabId) {
        item.classList.add('active-tab-glow');
    }
    if (isBoardTab(itemObj)) {
        item.style.background = "green";
    }

    item.draggable = true;
    item.dataset.id = itemObj.id;


    item.addEventListener('click', (e) => {
        // Get the full flat list of all tab elements in the order shown on screen
        const allItems = Array.from(document.querySelectorAll('.grid-item'));
        const currentIndex = allItems.indexOf(item);

        if (e.shiftKey && lastSelectedIndex !== null) {
            const start = Math.min(currentIndex, lastSelectedIndex);
            const end = Math.max(currentIndex, lastSelectedIndex);

            // Clear previous selected classes to avoid stale selections
            allItems.forEach(el => el.classList.remove('selected'));
            selectedTabIds.clear();

            // Select the range between lastSelectedIndex and currentIndex (inclusive)
            for (let i = start; i <= end; i++) {
                const rangeItem = allItems[i];
                const id = Number(rangeItem.dataset.id);
                selectedTabIds.add(id);
                rangeItem.classList.add('selected');
            }
        } else if (e.ctrlKey || e.metaKey) {
            const id = Number(item.dataset.id);
            if (selectedTabIds.has(id)) {
                selectedTabIds.delete(id);
                item.classList.remove('selected');
            } else {
                selectedTabIds.add(id);
                item.classList.add('selected');
            }
        } else {
            // Normal click: clear all previous selections and select only the clicked tab
            allItems.forEach(el => el.classList.remove('selected'));
            selectedTabIds.clear();
            const id = Number(item.dataset.id);
            selectedTabIds.add(id);
            item.classList.add('selected');
        }

        // Update lastSelectedIndex to current for next shift-click
        lastSelectedIndex = currentIndex;
    });

    item.addEventListener('dragstart', e => {
        if (!selectedTabIds.has(itemObj.id)) {
            document.querySelectorAll('.grid-item.selected').forEach(el => el.classList.remove('selected'));
            selectedTabIds.clear();
            selectedTabIds.add(itemObj.id);
            item.classList.add('selected');
        }
        draggedItem = item;
        draggedId = itemObj.id;
        item.classList.add('dragging');
        setTimeout(() => { item.style.display = 'none'; }, 0);
        document.addEventListener('dragover', onDragAnywhere);
    });
    item.addEventListener('dragend', e => {
        draggedItem = null;
        draggedId = null;
        item.style.display = '';
        item.classList.remove('dragging');
        hideDropIndicator();
        deactivateOutsideOverlay();
        clearPlaceholder();
        document.removeEventListener('dragover', onDragAnywhere);
    });
    item.addEventListener('contextmenu', e => {
        e.preventDefault();
        chrome.tabs.update(itemObj.id, { active: true }, () => {
            if (itemObj.windowId != null) { //wtf is itemObj exactly?
                chrome.windows.update(itemObj.windowId, { focused: true });
            }
        });
    });
    item.addEventListener('mouseenter', e => { showTabPreview(itemObj, item); });
    item.addEventListener('mouseleave', e => { hideTabPreview(); });

    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = '×';
    btn.onclick = e => {
        e.stopPropagation();
        chrome.tabs.remove(itemObj.id, () => {
            syncGroupDataFromBrowser();
        });
    };
    item.appendChild(btn);

    if (selectedTabIds.has(itemObj.id)) item.classList.add('selected');
    return item;
}

function removeFromGroupData(id) { //hash is useable here
    for (const group of groupData) {
        const index = group.findIndex(item => item.id === id);
        if (index !== -1) {
            group.splice(index, 1);
            break;
        }
    }
}

function getItemById(id) { //this is what needs to be replaced by a hash
    for (const group of groupData) {
        for (const item of group) {
            if (item.id === id) return item;
        }
    }
    return null;
}



//these are functions for the overlay element when dragging 
function activateOutsideOverlay() {
    outsideOverlay.classList.add('active');
}

function deactivateOutsideOverlay() {
    outsideOverlay.classList.remove('active');
}

outsideOverlay.addEventListener('dragenter', e => e.preventDefault());
outsideOverlay.addEventListener('dragover', e => e.preventDefault());

// removeFromGroupData - getItemById - syncGroupDataFromBrowser - renderBoard - hideDropIndicator - deactivateOutsideOverlay
outsideOverlay.addEventListener('drop', ev => {
    ev.preventDefault();
    if (!draggedItem || draggedId == null) return;

    let tabsToMove = Array.from(selectedTabIds).map(id => getItemById(id)).filter(Boolean);
    if (tabsToMove.length === 0) {
        const itemObj = getItemById(draggedId);
        if (!itemObj) return;
        tabsToMove = [itemObj];
    }

    for (const tab of tabsToMove) {
        removeFromGroupData(tab.id);
    }
    groupData.push([...tabsToMove]);

    chrome.windows.getCurrent(prevWindow => {
        chrome.windows.create({ state: 'maximized', focused: true }, newWindow => {
            if (!newWindow || !newWindow.id) return;
            const newWindowId = newWindow.id;
            focusWindowBox(newWindowId); // scroll the board to the new window
            const tabIdsToMove = tabsToMove.map(t => t.id);

            chrome.tabs.move(tabIdsToMove, { windowId: newWindowId, index: -1 }, () => {
                // Remove default new tab created by chrome.windows.create if it exists and is not one of our tabs
                if (newWindow.tabs && newWindow.tabs.length > 0) {
                    const defaultTabIds = newWindow.tabs.filter(t => !tabIdsToMove.includes(t.id)).map(t => t.id);
                    if (defaultTabIds.length) {
                        chrome.tabs.remove(defaultTabIds, () => {
                            chrome.windows.update(prevWindow.id, { focused: true }, () => {
                                syncGroupDataFromBrowser();
                            });
                        });
                    } else {
                        chrome.windows.update(prevWindow.id, { focused: true }, () => {
                            syncGroupDataFromBrowser();
                        });
                    }
                } else {
                    chrome.windows.update(prevWindow.id, { focused: true }, () => {
                        syncGroupDataFromBrowser();
                    });
                }
            });
        });
    });

    renderBoard();
    hideDropIndicator();
    deactivateOutsideOverlay();
    selectedTabIds.clear();
});

//render the board - syncGroupDataFromBrowser - highlightActiveTab
// "Zoom to" a window box: scroll the board to it and flash it. Used when
// opening the board (the window you came from) and after creating a window
// (new-window button, dragging tabs out). Requests wait for the box to appear
// (the window may not be on the board until the next sync) and expire after 10s.
let pendingFocus = null; // { windowId, until }
let focusFlash = null;   // { windowId, start } so the highlight survives board re-renders
const FOCUS_FLASH_MS = 1500;

// Give a (re)created box the highlight, continuing the animation where it is.
function applyFocusFlash(box, windowId) {
    if (!focusFlash || focusFlash.windowId !== windowId) return;
    const elapsed = Date.now() - focusFlash.start;
    if (elapsed >= FOCUS_FLASH_MS) {
        focusFlash = null;
        return;
    }
    box.style.animationDelay = `-${elapsed}ms`;
    box.classList.add('focus-flash');
}

function focusWindowBox(windowId) {
    pendingFocus = { windowId, until: Date.now() + 10000 };
    applyPendingFocus();
}

function applyPendingFocus() {
    if (!pendingFocus) return;
    if (Date.now() > pendingFocus.until) {
        pendingFocus = null;
        return;
    }
    const box = parentGrid.querySelector(`.child-grid[data-window-id="${pendingFocus.windowId}"]`);
    if (!box) return;
    pendingFocus = null;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusFlash = { windowId: Number(box.dataset.windowId), start: Date.now() };
    applyFocusFlash(box, focusFlash.windowId);
}

// Board layout: "shortest column first" masonry. Window boxes are placed in
// board order, each into whichever column is currently shortest, so they read
// left-to-right like a grid but each box is only as tall as its tabs need.
const BOARD_COLUMNS = 2;
let boardItems = []; // window boxes + the new-window button, in board order

function layoutBoard() {
    // Rebuilding empties the board for a moment, and measuring the columns
    // mid-rebuild would let the browser clamp the scroll position to the
    // shorter page. Hold the board's height and put the scroll position back,
    // so closing, moving or updating windows/tabs never scrolls the board.
    const keepX = window.scrollX;
    const keepY = window.scrollY;
    parentGrid.style.minHeight = `${parentGrid.offsetHeight}px`;
    const columns = Array.from({ length: BOARD_COLUMNS }, () => {
        const col = document.createElement('div');
        col.className = 'board-column';
        return col;
    });
    parentGrid.replaceChildren(...columns);
    for (const el of boardItems) {
        // Leftmost column wins ties, so the first boxes go side by side.
        let target = columns[0];
        for (const col of columns) if (col.offsetHeight < target.offsetHeight) target = col;
        target.appendChild(el);
    }
    parentGrid.style.minHeight = '';
    // Only touch the scroll position if it moved: an unconditional scrollTo
    // would cut short a "zoom to window" smooth scroll that is under way.
    if (window.scrollX !== keepX || window.scrollY !== keepY) window.scrollTo(keepX, keepY);
}

// Re-place boxes when the board width changes (tab text wraps differently).
let layoutTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(layoutBoard, 150);
});

function renderBoard() {
    groupData = groupData.filter(g => g.length);
    boardItems = groupData.map((items, idx) => {
        const windowId = items[0]?.windowId;
        const titleText = windowId && titles[windowId] ? titles[windowId] : '-';
        return createGroup(items, idx, windowId, titleText);
    });
    // create a new window
    // because of the issue with updating, first create a new window that is maximized, then return to the previous window (so interaction with reflection board is not interrupted)
    // finally, just resync the state with background.js

    const newWindowBtn = document.createElement('button');
    newWindowBtn.className = 'new-window-btn';
    newWindowBtn.textContent = '+';
    newWindowBtn.title = 'Create new window';
    newWindowBtn.type = 'button';
    newWindowBtn.addEventListener('click', () => {
        chrome.windows.getCurrent((prevWindow) => {
            chrome.windows.create(
                { state: "maximized", focused: true },
                (newWindow) => {
                    if (newWindow) focusWindowBox(newWindow.id); // scroll the board to it
                    chrome.windows.update(prevWindow.id, { focused: true }, () => {
                        syncGroupDataFromBrowser();
                    });
                }
            );
        });
    });

    boardItems.push(newWindowBtn);
    layoutBoard();
    applyPendingFocus();
    highlightActiveTab()
    //console.log("groupData:", groupData)
}

document.getElementById('internal-save-btn').addEventListener('click', () => {
    saveSessionInternal();
});

document.getElementById('internal-load-btn').addEventListener('click', () => {
    openLoadDialog();
});

document.getElementById('download-btn').addEventListener('click', () => {
    downloadStateAsFile();
});

const uploadFileInput = document.getElementById('upload-file-input');
const addFileInput = document.getElementById('add-file-input');

document.getElementById('upload-btn').addEventListener('click', () => {
    uploadFileInput.click();
});

document.getElementById('add-btn').addEventListener('click', () => {
    addFileInput.click();
});

// Clear the input after reading so choosing the same file again still fires 'change'.
uploadFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadStateFromFile(e.target.files[0], false);
    }
    e.target.value = '';
});

addFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadStateFromFile(e.target.files[0], true);
    }
    e.target.value = '';
});

// Ctrl+S triggers internal save only
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveSessionInternal();

        const saveBtn = document.getElementById('internal-save-btn');
        if (saveBtn) {
            saveBtn.classList.add('glow');
            setTimeout(() => {
                saveBtn.classList.remove('glow');
            }, 1000); // match animation duration
        }
    }
});

document.body.addEventListener('click', (e) => {
    if (e.target.classList.contains('state-btn')) {
        const btn = e.target;
        btn.classList.add('glow');
        setTimeout(() => {
            btn.classList.remove('glow');
        }, 1000); // Matches CSS animation duration
    }
});

// "view history in app": when checked, history hotkeys switch the active tab in
// its window but keep focus on the board, so you can watch the glow move here.
// The setting is read by background.js, which performs the navigation.
const checkbox = document.getElementById('active-tab-history')
chrome.storage.local.get(['historyStayInApp'], (result) => {
    checkbox.checked = !!(result && result.historyStayInApp);
});
checkbox.addEventListener('change', (e) => {
    chrome.storage.local.set({ historyStayInApp: e.target.checked });
})

// "autosave": background.js saves the session ~10s after tabs change.
const autosaveCheckbox = document.getElementById('autosave');
chrome.storage.local.get(['autosaveEnabled'], (result) => {
    autosaveCheckbox.checked = !!(result && result.autosaveEnabled);
});
autosaveCheckbox.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ autosaveEnabled: e.target.checked });
    if (e.target.checked) chrome.runtime.sendMessage({ type: 'autosave_now' }).catch(() => { });
});

// "full preview": hovering a tab shows a 300×300 screenshot of it.
const fullPreviewCheckbox = document.getElementById('full-preview');
chrome.storage.local.get(['fullPreview'], (result) => {
    fullPreviewEnabled = !!(result && result.fullPreview);
    fullPreviewCheckbox.checked = fullPreviewEnabled;
});
fullPreviewCheckbox.addEventListener('change', (e) => {
    fullPreviewEnabled = e.target.checked;
    chrome.storage.local.set({ fullPreview: fullPreviewEnabled });
});



// app.js or content script

/* // Listen for refresh command FIRST (before any load events)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'save-scroll-and-reload') {
    const scrollY = window.scrollY;
    
    // Double-save with delay to ensure persistence
    chrome.storage.local.set({ scrollY }, () => {
      setTimeout(() => {
        chrome.storage.local.set({ scrollY });  // Redundant save
        setTimeout(() => location.reload(true), 50);  // Final delay
      }, 50);
    });
  }
});

// Restore with aggressive timing
function restoreScroll() {
  chrome.storage.local.get(['scrollY'], ({ scrollY }) => {
    if (scrollY != null && scrollY > 0) {
      // Multiple restore attempts
      const attempts = [0, 100, 500, 1000];
      attempts.forEach(delay => {
        setTimeout(() => {
          window.scrollTo(0, scrollY);
          document.documentElement.scrollTop = scrollY;  // Fallback
          document.body.scrollTop = scrollY;              // Extra fallback
        }, delay);
      });
      chrome.storage.local.remove('scrollY');
    }
  });
}

// Bind to multiple load events
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreScroll);
  window.addEventListener('load', restoreScroll);
} else {
  restoreScroll();
}
window.addEventListener('load', restoreScroll);  */


// Startup: load persisted window titles first, then pull the live browser state.
// (groupData is undefined until the first sync, so we must not render before it.)
// Opened from the toolbar/hotkey while no board existed: scroll to the window
// the user came from (left in session storage by background.js).
chrome.storage.session.get('boardFocusWindow').then(({ boardFocusWindow }) => {
    if (boardFocusWindow && Date.now() - boardFocusWindow.at < 15000) focusWindowBox(boardFocusWindow.id);
    chrome.storage.session.remove('boardFocusWindow');
}).catch(() => { });

chrome.storage.local.get(['titles', 'windowOrder'], (result) => {
    if (result && result.titles) titles = result.titles;
    if (result && Array.isArray(result.windowOrder)) windowOrder = result.windowOrder;
    syncGroupDataFromBrowser();
});
