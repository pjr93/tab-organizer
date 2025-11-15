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
const appUrlPrefix = chrome.runtime.getURL('');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function showTabPreview(tab, anchorEl) {
    let preview = document.getElementById('tab-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'tab-hover-preview';
        preview.style.position = 'fixed';
        preview.style.zIndex = 9999;
        preview.style.background = '#23272e';
        preview.style.color = 'white';
        preview.style.padding = '8px 14px';
        preview.style.borderRadius = '6px';
        preview.style.boxShadow = '0 2px 12px #0007';
        preview.style.fontSize = '13px';
        preview.style.opacity = '0.75';
        document.body.appendChild(preview);
    }
    preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      ${tab.favIconUrl ? `<img src="${tab.favIconUrl}" width="20" height="20" style="border-radius:3px;">` : ""}
      <b>${tab.title || tab.text}</b>
    </div>
    <div style="color:#8ab4f8">${tab.url || ""}</div>
  `;
    const rect = anchorEl.getBoundingClientRect();
    preview.style.top = (rect.bottom + 6) + "px";
    preview.style.left = (rect.left) + "px";
    preview.style.display = "block";
}

function hideTabPreview() {
    const preview = document.getElementById('tab-hover-preview');
    if (preview) preview.style.display = "none";
}

function highlightActiveTab() {
    const allItems = document.querySelectorAll('.grid-item');
    allItems.forEach(item => {
        if (Number(item.dataset.id) === currentActiveTabId) {
            item.classList.add('active-tab-glow');
        } else {
            item.classList.remove('active-tab-glow');
        }
    });
}
// message events - highlightActiveTab - syncGroupDataFromBrowser
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "active_tab_changed") {
        currentActiveTabId = message.tabId;
        highlightActiveTab();
    }
    if (message.type === "sync_browser_state") {
        syncGroupDataFromBrowser();
    }
});

//straightfoward I think. Must be async due to the async nature of chrome.windows.getAll
async function maximizeAllWindowsAndFocusAppTab() {
    // Maximize all windows
    const windows = await new Promise(resolve => chrome.windows.getAll({}, resolve));
    for (const win of windows) {
        chrome.windows.update(win.id, { state: 'maximized' }, () => { });
    }

    // Focus the tab running app.html
    const appUrl = chrome.runtime.getURL('app.html');
    chrome.tabs.query({ url: appUrl }, (tabs) => { //should only be one
        if (tabs.length > 0) {
            const tab = tabs[0];
            chrome.tabs.update(tab.id, { active: true }, () => {
                chrome.windows.update(tab.windowId, { focused: true });
            });
        }
    });
}

// I think this function can go. It should just be another initialization, but with different parameters = TRY 1 - syncGroupDataFromBrowser - maximizeAllWindowsAndFocusAppTab
// or I can write it myself to first close every tab except reflection board. Then load the windows with the first tab of each one. The reflection board can be saved, but
//if the reflection board is detected on load, it does not make a new window. When creating the tabs, it first needs to check if app.html is a part of the list of tabs
function createWindow(options) {
    return new Promise((resolve, reject) => {
        chrome.windows.create(options, (newWindow) => {
            if (chrome.runtime.lastError || !newWindow) {
                reject(chrome.runtime.lastError || new Error("Failed to create window"));
            } else {
                resolve(newWindow);
            }
        });
    });
}

function createTab(options) {
    return new Promise((resolve, reject) => {
        chrome.tabs.create(options, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                reject(chrome.runtime.lastError || new Error("Failed to create tab"));
            } else {
                resolve(tab);
            }
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function openTabsSequentially(tabs, windowId) {
    for (const tab of tabs) {
        if (tab.title !== "Reflection Board") { //might want to do check for Reflection Board so Reflection board's tabs go in the current app location
            chrome.tabs.create({ windowId, url: tab.url, active: false });
            await sleep(500);
        }
    }
}

function getCurrentWindow() {
    return new Promise(resolve => chrome.windows.getCurrent(resolve));
}

function createWindow(url = "") {
    return new Promise(resolve => chrome.windows.create({ state: "maximized", focused: true, url: url }, resolve));
}

function updateWindow(windowId) {
    return new Promise(resolve => chrome.windows.update(windowId, { focused: true }, resolve));
}

// Assume openTabsSequentially is async and returns a Promise that resolves when done
async function restoreState(firstToClose, restToClose, saved) {
    // Close tabs synchronously without awaiting since tabs.remove accepts callback but can be fire and forget
    for (const tabId of firstToClose) {
        try {
            chrome.tabs.remove(tabId);
        } catch (e) {
            console.warn(`Failed to close tab ${tabId}:`, e);
        }
    }
    for (const tabId of restToClose) {
        try {
            chrome.tabs.remove(tabId);
        } catch (e) {
            console.warn(`Failed to close tab ${tabId}:`, e);
        }
    }

    try {
        for (const win of saved) {
            console.log('sliced tabs:', win.tabs.length)
            const prevWindow = await getCurrentWindow();
            const newTabs = win.tabs.filter(t => t.title != 'Reflection Board')
            const newWindow = await createWindow(url = newTabs[0].url);
            await updateWindow(prevWindow.id);
            await openTabsSequentially(newTabs.slice(1,newTabs.length), newWindow.id);
        }
    } catch (error) {
        console.error("Error restoring windows and tabs:", error);
    }
}
// this needs to be adapted for a per window basis - would there be an advantage in putting the data organization separate? - yes for saving individual windows
//
function downloadStateAsFile(groups = groupData) {
    const saved = groups.map(group => {
        if (!group.length) return null;
        const windowId = group[0].windowId;
        const title = titles[windowId] || '-';
        const tabs = group.map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            windowId: tab.windowId,
            groupId: tab.groupId || null,
        }));
        return { windowId, title, tabs };
    }).filter(g => g !== null);

    const jsonStr = JSON.stringify(saved, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab_layout.json';
    a.click();
    URL.revokeObjectURL(url);
}

//requires restoreState so I need to alter it
function uploadStateFromFile(file, append = false) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const saved = JSON.parse(e.target.result);
            const appTitle = 'Reflection Board'
            var appLocation = {}
            var i = 0
            for (win of saved) {
                var j = 0
                for (tab of win.tabs) {
                    if (tab.title == appTitle) {
                        appLocation.winId = tab.windowId
                        appLocation.tabId = tab.id
                        appLocation.url = tab.url
                        appLocation.appPosition = [i, j]
                    }
                    j++
                }
                i++
            }
            var currentAppLocation = {}
            var k = 0
            for (group of groupData) {
                var m = 0
                for (item of group) {
                    if (item.title == appTitle) {
                        currentAppLocation.winId = item.windowId
                        currentAppLocation.tabId = item.id
                        currentAppLocation.url = item.url
                        currentAppLocation.appPosition = [k, m]
                    }
                    m++
                }
                k++
            }
            var firstToClose;
            var restToClose;

            if (!append) {
                k = currentAppLocation.appPosition[0]
                m = currentAppLocation.appPosition[1]
                firstToClose = groupData[k].filter(element => element.title != appTitle).map(element => element.id)
                restToCloseArr = groupData.filter((element, idx) => idx != k)
                var restToClose = []
                for (tabs of restToCloseArr) {
                    restToClose = restToClose.concat(tabs.map(tab => tab.id))
                }
            } else {
                firstToClose = []
                restToClose = []
            }
            console.log('to close', firstToClose, restToClose)
            restoreState(firstToClose, restToClose, saved);
        } catch (err) {
            alert('check the console after pressing F12');
            console.log(err)
        }
    };
    reader.readAsText(file);
}

function groupTabsByWindow(tabs, titlesMap) { //I think the titles map here is annoying. the tabs should be sufficient (which is why group data should have this stuff. This should take the window object and get the tabs from there)
    const groups = {};
    for (const tab of tabs) {
        if (
            !tab.url ||
            tab.url.startsWith(chrome.runtime.getURL('')) || // exclude your extension pages
            tab.url.startsWith('brave://') // exclude chrome internal pages (should I really?)
        ) continue;

        if (!groups[tab.windowId]) groups[tab.windowId] = [];
        groups[tab.windowId].push({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            windowId: tab.windowId,
            groupId: tab.groupId || null,
        });
    }
    return Object.entries(groups).map(([windowId, tabs]) => ({
        windowId: Number(windowId),
        title: titlesMap[windowId] || '-',
        tabs,
    }));
}

function saveStateInternal() {
    chrome.windows.getAll({ populate: true }, (windows) => {
        const appUrl = chrome.runtime.getURL('app.html');
        let appWindow = null;
        const otherWindows = [];

        windows.forEach(win => {
            const hasAppTab = (win.tabs || []).some(tab => tab.url === appUrl);
            if (hasAppTab) {
                appWindow = win;
            } else {
                otherWindows.push(win);
            }
        });

        function serializeWindow(win) {
            return {
                windowId: win.id,
                title: titles[win.id] || '-',
                tabs: (win.tabs || [])
                    .filter(tab => tab.url && !tab.url.startsWith('chrome://'))
                    .map(tab => ({
                        id: tab.id,
                        title: tab.title,
                        url: tab.url,
                        windowId: tab.windowId,
                        groupId: tab.groupId || null,
                    }))
            };
        }

        const savedAppWindow = appWindow ? serializeWindow(appWindow) : null;
        const savedOtherWindows = otherWindows.map(serializeWindow).filter(w => w.tabs.length > 0);

        chrome.storage.local.set({ savedAppWindow, savedOtherWindows }, () => {
            console.log('Saved app window and other windows', savedAppWindow, savedOtherWindows);
        });
    });
}

//loads the state from local storage - restoreState
function loadStateInternal() {
    chrome.storage.local.get(['savedTabState'], (result) => {
        if (result.savedTabState) {
            restoreState(result.savedTabState);
        } else {
            alert("No saved internal tab state found.");
        }
    });
}


function createEditableTitleBox(parentElement) {
    const title = document.createElement('div');
    title.className = 'editable-title';
    title.contentEditable = 'true';
    title.textContent = '-';
    parentElement.appendChild(title);
    return title;
}

//Gets tab data from the chrome API - renderBoard
function syncGroupDataFromBrowser() {
    chrome.windows.getAll({ populate: true }, (windows) => {
        if (chrome.runtime.lastError) return;
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



function getFaviconUrl(pageUrl, size = 32) {
    const url = new URL(chrome.runtime.getURL('_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', size.toString());
    return url.toString();
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

//moves to a new window - syncGroupDataFromBrowser
function smartMoveTab(tabId, targetWindowId, targetIndex) {
    if (targetWindowId == null) {
        chrome.windows.getCurrent((prevWindow) => {
            chrome.windows.create(
                { state: "maximized", focused: true },
                (newWindow) => {
                    if (chrome.runtime.lastError) return;
                    chrome.tabs.move(
                        tabId,
                        { windowId: newWindow.id, index: targetIndex || 0 },
                        () => {
                            chrome.windows.update(prevWindow.id, { focused: true }, () => {
                                syncGroupDataFromBrowser();
                            });
                            if (newWindow.tabs && newWindow.tabs.length > 0) {
                                const defaultTabId = newWindow.tabs[0].id;
                                if (defaultTabId !== tabId) {
                                    chrome.tabs.remove(defaultTabId, () => { });
                                }
                            }
                        }
                    );
                }
            );
        });
    } else {
        chrome.tabs.move(
            tabId,
            { windowId: targetWindowId, index: targetIndex },
            () => {
                syncGroupDataFromBrowser();
            }
        );
    }
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

// creates the group UI element which holds the tabs - createPlaceholder - removeFromGroupData - smartMoveTab - renderBoard - hideDropIndicator - deactivateOutsideOverlay - syncGroupDataFromBrowser - downloadStateAsFile - createGridItem - createEditableTextbox
function createGroup(items = [], idx, windowId = null, titleText = '-') {
    const group = document.createElement('div');
    group.className = 'child-grid';
    group.dataset.group = idx;


    const plusTabBtn = document.createElement('button');
    plusTabBtn.className = 'plus-tab-btn';
    plusTabBtn.textContent = '+';
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
        for (const tab of tabsToMove) {
            removeFromGroupData(tab.id);
        }
        const childrenArray = Array.from(group.children).filter(ch =>
            ch.classList.contains('grid-item') || ch === placeholder
        );
        let newIndex = placeholder && placeholder.parentElement === group
            ? childrenArray.indexOf(placeholder)
            : childrenArray.length;
        clearPlaceholder();
        let targetWindowId = null;
        if (groupData[idx] && groupData[idx].length > 0) {
            targetWindowId = groupData[idx][0].windowId;
        } else {
            targetWindowId = tabsToMove.length ? tabsToMove[0].windowId : null;
        }
        tabsToMove.forEach((tab, i) => {
            smartMoveTab(tab.id, targetWindowId, newIndex + i);
        });
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
    saveBtn.textContent = 'S';
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
    const title = createEditableTitleBox(group);
    title.textContent = titleText;
    title.addEventListener('blur', () => {
        const text = title.textContent.trim() || 'Untitled';
        if (windowId) {
            titles[windowId] = text;
            chrome.storage.local.set({ titles }, () => { });
        }
    });
    return group;
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
    faviconImg.style.marginRight = '6px';
    faviconImg.style.verticalAlign = 'middle';
    faviconImg.style.borderRadius = '3px'; // optional styling

    // Create a span for the text content
    const textSpan = document.createElement('span');
    textSpan.textContent = itemObj.text;


    // Clear existing content and append favicon + text
    item.textContent = '';
    item.appendChild(faviconImg);
    item.appendChild(textSpan);
    if (itemObj.id === currentActiveTabId) {
        item.classList.add('active-tab-glow');
    }
    if (item.textContent == "Reflection Board") {
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
            if (itemObj.windowId != null) {
                chrome.windows.update(itemObj.windowId, { focused: true });
            }
        });
    });
    item.addEventListener('mouseenter', e => {
        showTabPreview(itemObj, item);
    });
    item.addEventListener('mouseleave', e => {
        hideTabPreview();
    });

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
            const windowId = group[0]?.windowId;
            if (windowId && titles[windowId]) {
                delete titles[windowId];
                chrome.storage.local.set({ titles });
            }
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
    //saveStateInternal();
    console.log('not today criminal!')
});

document.getElementById('internal-load-btn').addEventListener('click', () => {
    //loadStateInternal();
    console.log('not today criminal!')
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

uploadFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadStateFromFile(e.target.files[0]);
    }
});

addFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadStateFromFile(e.target.files[0], append = true);
    }
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

renderBoard();
