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
    let shotBox = null;
    if (fullPreviewEnabled && !isBoardTab(tab)) {
        shotBox = document.createElement('div');
        shotBox.id = 'preview-shot';
        preview.appendChild(shotBox);
    }

    // Place below the tile, or above it if there isn't room; keep it on screen.
    preview.style.display = "block";
    const rect = anchorEl.getBoundingClientRect();
    const box = preview.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - 4 && rect.top - 6 - box.height >= 4) {
        top = rect.top - 6 - box.height;
    }
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - box.width - 4));
    preview.style.top = top + "px";
    preview.style.left = left + "px";

    if (shotBox) fillPreviewShot(tab, shotBox, token);
}

let previewToken = 0;      // bumps on every show/hide so stale async work is ignored
let previewObjectUrl = null;
let fullPreviewEnabled = false;
const PREVIEW_DWELL_MS = 500;

function setShotMessage(shotBox, text) {
    shotBox.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'preview-shot-msg';
    msg.textContent = text;
    shotBox.appendChild(msg);
}

function showShot(shotBox, record) {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(record.blob);
    const img = document.createElement('img');
    img.src = previewObjectUrl;
    img.alt = 'Tab preview';
    const age = document.createElement('div');
    age.className = 'preview-shot-age';
    age.textContent = 'as of ' + new Date(record.at).toLocaleTimeString();
    shotBox.replaceChildren(img, age);
}

// Screen position of the preview box, for placing the temporary capture window over it.
function shotBoxScreenRect(shotBox) {
    const r = shotBox.getBoundingClientRect();
    const chromeTop = window.outerHeight - window.innerHeight;   // tab strip + toolbar
    const chromeSide = (window.outerWidth - window.innerWidth) / 2;
    return { left: window.screenX + chromeSide + r.left, top: window.screenY + chromeTop + r.top };
}

// Show the stored screenshot if it matches the tab's current URL; otherwise,
// after a short hover, ask background.js to capture one (which may briefly
// load the page muted in a small window over this box).
async function fillPreviewShot(tab, shotBox, token) {
    setShotMessage(shotBox, '');
    let record = null;
    try { record = await PreviewStore.get(tab.id); } catch (e) { /* no store */ }
    if (token !== previewToken) return;
    if (record && record.url === tab.url) {
        showShot(shotBox, record);
        return;
    }
    await sleep(PREVIEW_DWELL_MS);
    if (token !== previewToken) return;
    setShotMessage(shotBox, 'Loading preview…');
    let response;
    try {
        response = await chrome.runtime.sendMessage({ type: 'preview_request', tabId: tab.id, rect: shotBoxScreenRect(shotBox) });
    } catch (e) {
        response = { ok: false, reason: e.message };
    }
    if (token !== previewToken) return;
    if (!response || !response.ok) {
        setShotMessage(shotBox, (response && response.reason) || 'No preview available.');
        return;
    }
    try { record = await PreviewStore.get(tab.id); } catch (e) { record = null; }
    if (token !== previewToken) return;
    if (record) showShot(shotBox, record);
    else setShotMessage(shotBox, 'No preview available.');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    if (message.type === "sync_browser_state") { syncGroupDataFromBrowser(); }
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
    const jsonStr = JSON.stringify(serializeGroups(groups), null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab_layout.json';
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

// Internal save: one snapshot kept in chrome.storage.local.
function saveStateInternal() {
    const savedState = serializeGroups(groupData || []);
    chrome.storage.local.set({ savedState, savedAt: Date.now() }, () => {
        if (chrome.runtime.lastError) {
            alert(`Internal save failed: ${chrome.runtime.lastError.message}`);
        }
    });
}

// The internal save slots, in the order shown in the Load dialog.
const INTERNAL_SLOTS = [
    { label: 'Manual save (Ctrl+S)', dataKey: 'savedState', timeKey: 'savedAt' },
    { label: 'Autosave', dataKey: 'autoSave', timeKey: 'autoSavedAt' },
    { label: 'Autosave from previous browser session', dataKey: 'autoSavePrev', timeKey: 'autoSavePrevAt' },
];

// "Load (Internal)": show every available slot and let the user pick one.
// Choosing a slot replaces the open tabs, so the dialog doubles as confirmation.
function loadStateInternal() {
    const keys = INTERNAL_SLOTS.flatMap(s => [s.dataKey, s.timeKey]);
    chrome.storage.local.get(keys, (result) => {
        const dialog = document.getElementById('load-dialog');
        const list = document.getElementById('load-dialog-list');
        list.replaceChildren();

        const available = INTERNAL_SLOTS.filter(s => Array.isArray(result[s.dataKey]) && result[s.dataKey].length);
        if (!available.length) {
            alert("No internal saves yet. Press Ctrl+S / 'Save (Internal)', or turn on autosave.");
            return;
        }
        for (const slot of available) {
            const data = result[slot.dataKey];
            const tabCount = data.reduce((n, w) => n + (w.tabs || []).filter(t => !isBoardTab(t)).length, 0);
            const when = result[slot.timeKey] ? new Date(result[slot.timeKey]).toLocaleString() : 'unknown time';

            const row = document.createElement('div');
            row.className = 'load-slot';
            const info = document.createElement('div');
            const name = document.createElement('b');
            name.textContent = slot.label;
            const meta = document.createElement('div');
            meta.className = 'load-slot-meta';
            meta.textContent = `${when} · ${data.length} window(s), ${tabCount} tab(s)`;
            info.append(name, meta);

            const btn = document.createElement('button');
            btn.className = 'state-btn';
            btn.textContent = 'Load';
            btn.title = 'Replace all open tabs with this save';
            btn.addEventListener('click', async () => {
                dialog.close();
                try {
                    await restoreState(data, { replace: true });
                } catch (err) {
                    console.error(err);
                    alert(`Could not load "${slot.label}": ${err.message}`);
                }
            });
            row.append(info, btn);
            list.appendChild(row);
        }
        dialog.showModal();
    });
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

//Gets tab data from the chrome API - renderBoard
// Only normal browser windows are shown; popup windows (the tab switcher, the
// preview capture window, site popups) are left out.
function syncGroupDataFromBrowser() {
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        if (chrome.runtime.lastError) return;
        pruneTitles(windows);
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

    group.addEventListener('dragover', e => {
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
            group.classList.remove('dragover');
            clearPlaceholder();
        }
    });

    group.addEventListener('drop', e => {
        e.preventDefault();
        group.classList.remove('dragover');
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
    saveBtn.title = 'Save this window group';
    saveBtn.windowId = windowId
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupDataToSave = groupData[idx];
        if (groupDataToSave && groupDataToSave.length > 0) {
            downloadStateAsFile([groupDataToSave]);
        }
    });
    group.appendChild(saveBtn);

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
function renderBoard() {
    parentGrid.innerHTML = '';
    groupData = groupData.filter(g => g.length);
    groupData.forEach((items, idx) => {
        const windowId = items[0]?.windowId;
        const titleText = windowId && titles[windowId] ? titles[windowId] : '-';
        parentGrid.appendChild(createGroup(items, idx, windowId, titleText));
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
                    chrome.windows.update(prevWindow.id, { focused: true }, () => {
                        syncGroupDataFromBrowser();
                    });
                }
            );
        });
    });

    parentGrid.appendChild(newWindowBtn);
    highlightActiveTab()
    //console.log("groupData:", groupData)
}

document.getElementById('internal-save-btn').addEventListener('click', () => {
    saveStateInternal();
});

document.getElementById('internal-load-btn').addEventListener('click', () => {
    loadStateInternal();
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
        saveStateInternal();

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

document.getElementById('load-dialog-cancel').addEventListener('click', () => {
    document.getElementById('load-dialog').close();
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
chrome.storage.local.get(['titles'], (result) => {
    if (result && result.titles) titles = result.titles;
    syncGroupDataFromBrowser();
});
