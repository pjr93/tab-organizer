const parentGrid = document.getElementById('parent-grid');
const dropIndicator = document.getElementById('drop-indicator');
const outsideOverlay = document.getElementById('outside-overlay');

let lastSelectedIndex = null;
let draggedItem = null;
let draggedId = null;
let placeholder = null;
let nextItemId = 1;
let windowGroupData = [];
let titles = {};
let selectedTabIds = new Set();
let groupData;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "sync_browser_state") {
        syncGroupDataFromBrowser();
    }
});

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

let previousActiveTabId = null;

chrome.tabs.onActivated.addListener(activeInfo => {
    const newActiveTabId = activeInfo.tabId;
    previousActiveTabId = newActiveTabId;
});

async function initialize() {
    try {
        const windowsData = await chrome.storage.local.get(['windows']);
        const titlesData = await chrome.storage.local.get(['titles']);
        if (titlesData && titlesData.titles) {
            titles = titlesData.titles;
        }
        const windows = windowsData.windows || [];
        windowGroupData = windows.map(window => {
            if (!window.tabs) return [];
            return window.tabs
                .filter(tab => tab && typeof tab.title === 'string')
                .map(tab => ({
                    id: tab.id,
                    text: tab.title.slice(0, 20),
                    ...tab
                }));
        });
        groupData = windowGroupData.length ? windowGroupData : [[]];
        renderBoard();
    } catch (err) {
        groupData = [[]];
        renderBoard();
    }
}

async function maximizeAllWindowsAndFocusAppTab() {
    // Maximize all windows
    const windows = await new Promise(resolve => chrome.windows.getAll({}, resolve));
    for (const win of windows) {
        chrome.windows.update(win.id, { state: 'maximized' }, () => { });
    }

    // Focus the tab running app.html
    const appUrl = chrome.runtime.getURL('app.html');
    chrome.tabs.query({ url: appUrl }, (tabs) => {
        if (tabs.length > 0) {
            const tab = tabs[0];
            chrome.tabs.update(tab.id, { active: true }, () => {
                chrome.windows.update(tab.windowId, { focused: true });
            });
        }
    });
}


async function restoreState() {
  const appUrl = chrome.runtime.getURL('app.html');
  const data = await new Promise(resolve => chrome.storage.local.get(['savedAppWindow', 'savedOtherWindows'], resolve));
  const savedAppWindow = data.savedAppWindow;
  const savedOtherWindows = data.savedOtherWindows || [];

  const newTitles = {};

  // 1. Restore all non-app windows first (same as existing code)
  for (const group of savedOtherWindows) {
    const { title, tabs } = group;
    if (!tabs.length) continue;

    const newWindow = await new Promise(resolve => {
      chrome.windows.create(
        { url: tabs[0].url, focused: false },
        win => {
          if (chrome.runtime.lastError || !win) {
            console.error('Window creation failed', chrome.runtime.lastError);
            resolve(undefined);
          } else {
            resolve(win);
          }
        }
      );
    });
    if (!newWindow) continue;

    chrome.windows.update(newWindow.id, { state: 'maximized' });

    for (let i = 1; i < tabs.length; i++) {
      await new Promise(resolve =>
        chrome.tabs.create({ windowId: newWindow.id, url: tabs[i].url, active: false }, resolve)
      );
    }
    newTitles[newWindow.id] = title;
  }

  // 2. Ensure app tab exists or create it, and get its current windowId
  const appTabs = await new Promise(resolve => chrome.tabs.query({ url: appUrl }, resolve));
  let appWindowId = null;
  if (appTabs.length > 0) {
    const existingAppTab = appTabs[0];
    appWindowId = existingAppTab.windowId;
    chrome.windows.update(appWindowId, { focused: true });
    chrome.tabs.update(existingAppTab.id, { active: true });
    newTitles[appWindowId] = savedAppWindow?.title || '---';
  } else if (savedAppWindow) {
    const appWindow = await new Promise(resolve => {
      chrome.windows.create(
        { url: appUrl, focused: true },
        win => resolve(win)
      );
    });
    appWindowId = appWindow.id;
    newTitles[appWindowId] = savedAppWindow.title || '---';
  }

  // 3. Close all old tabs except those in the app window (preserving tabs shared with app.html)
  const tabsToClose = [];
  const currentWindows = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
  for (const win of currentWindows) {
    for (const tab of (win.tabs || [])) {
      if (win.id !== appWindowId && tab.url && !tab.url.startsWith('chrome://')) {
        tabsToClose.push(tab.id);
      }
    }
  }
  for (const tabId of tabsToClose) {
    try {
      await new Promise(resolve => chrome.tabs.remove(tabId, resolve));
    } catch (e) {
      console.warn(`Failed to close tab ${tabId}:`, e);
    }
  }

  // 4. Update titles and sync UI
  titles = newTitles;
  chrome.storage.local.set({ titles: newTitles });

  setTimeout(() => {
    syncGroupDataFromBrowser();
    maximizeAllWindowsAndFocusAppTab();
  }, 800);
}

















function downloadStateAsFile() {
    const saved = groupData.map(group => {
        if (!group.length) return null;
        const windowId = group[0].windowId;
        const title = titles[windowId] || '---';
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

function uploadStateFromFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const saved = JSON.parse(e.target.result);
            await restoreState(saved);
        } catch (err) {
            alert('Invalid JSON file');
        }
    };
    reader.readAsText(file);
}



function groupTabsByWindow(tabs, titlesMap) {
  const groups = {};
  for (const tab of tabs) {
    if (
      !tab.url ||
      tab.url.startsWith(chrome.runtime.getURL('')) || // exclude your extension pages
      tab.url.startsWith('chrome://') // exclude chrome internal pages
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
    title: titlesMap[windowId] || '---',
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
        title: titles[win.id] || '---',
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






function loadStateInternal() {
    chrome.storage.local.get(['savedTabState'], (result) => {
        if (result.savedTabState) {
            restoreState(result.savedTabState);
        } else {
            alert("No saved internal tab state found.");
        }
    });
}


function setupAddButtons() {
    const originalCreateGroup = createGroup;
    window.createGroup = function (items, idx, windowId, titleText) {
        const group = originalCreateGroup(items, idx, windowId, titleText);
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
        group.addEventListener('mouseenter', () => {
            plusTabBtn.style.display = 'flex';
        });
        group.addEventListener('mouseleave', () => {
            plusTabBtn.style.display = 'none';
        });
        return group;
    };
}
setupAddButtons();

function createEditableTitleBox(parentElement) {
    const title = document.createElement('div');
    title.className = 'editable-title';
    title.contentEditable = 'true';
    title.textContent = '---';
    parentElement.appendChild(title);
    return title;
}

function syncGroupDataFromBrowser() {
    chrome.windows.getAll({ populate: true }, (windows) => {
        if (chrome.runtime.lastError) return;
        groupData = windows.map(win => {
            return (win.tabs || []).map(tab => ({
                id: tab.id,
                text: tab.title ? tab.title.slice(0, 20) : tab.url || "No title",
                windowId: win.id,
                groupId: tab.groupId || null,
                ...tab
            }));
        });
        renderBoard();
    });
}
initialize().then(() => {
    syncGroupDataFromBrowser();
    maximizeAllWindowsAndFocusAppTab();  // <--- add this call here
});


function clearPlaceholder() {
    if (placeholder && placeholder.parentElement) {
        placeholder.parentElement.removeChild(placeholder);
        placeholder = null;
    }
}

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

function createGroup(items = [], idx, windowId = null, titleText = '---') {
    const group = document.createElement('div');
    group.className = 'child-grid';
    group.dataset.group = idx;

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

    for (const itemObj of items) {
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

function createGridItem(itemObj) {
    const item = document.createElement('div');
    item.className = 'grid-item';
    item.textContent = itemObj.text;
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

function removeFromGroupData(id) {
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

function getItemById(id) {
    for (const group of groupData) {
        for (const item of group) {
            if (item.id === id) return item;
        }
    }
    return null;
}

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

function activateOutsideOverlay() {
    outsideOverlay.classList.add('active');
}

function deactivateOutsideOverlay() {
    outsideOverlay.classList.remove('active');
}

outsideOverlay.addEventListener('dragenter', e => e.preventDefault());
outsideOverlay.addEventListener('dragover', e => e.preventDefault());
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






function renderBoard() {
    parentGrid.innerHTML = '';
    groupData = groupData.filter(g => g.length);
    groupData.forEach((items, idx) => {
        const windowId = items[0]?.windowId;
        const titleText = windowId && titles[windowId] ? titles[windowId] : '---';
        parentGrid.appendChild(createGroup(items, idx, windowId, titleText));
    });
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
document.getElementById('upload-btn').addEventListener('click', () => {
    uploadFileInput.click();
});
uploadFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadStateFromFile(e.target.files[0]);
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
