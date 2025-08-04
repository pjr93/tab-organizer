const parentGrid = document.getElementById('parent-grid');
const dropIndicator = document.getElementById('drop-indicator');
const outsideOverlay = document.getElementById('outside-overlay');



let draggedItem = null;     // The DOM element being dragged
let draggedId = null;       // The unique id of dragged item
let placeholder = null;     // Placeholder element showing drop position
let nextItemId = 1;         // Global unique id counter
let windowGroupData = [];

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

    if (previousActiveTabId !== null) {
        console.log("Switched from tab", previousActiveTabId, "to tab", newActiveTabId);
    } else {
        console.log("Active tab initially is", newActiveTabId);
    }

    previousActiveTabId = newActiveTabId;
});


async function initialize() {
    try {
        const data = await chrome.storage.local.get(["windows"]);
        const { windows } = data;

        windowGroupData = (windows || []).map(window => {
            if (!window.tabs) return [];
            return window.tabs
                .filter(tab => tab && typeof tab.title === "string")
                .map(tab => ({
                    id: tab.id,
                    text: tab.title.slice(0, 20),
                    ...tab
                }));
        });

        groupData = windowGroupData.length ? windowGroupData : [[]]; // fallback if empty

        renderBoard();  // Now that groupData is populated, render!

    } catch (err) {
        console.error("Failed to load windows/tabs:", err);
        groupData = [[]];  // Fallback to empty group to avoid errors
        renderBoard();
    }
}

function setupAddButtons() {

    // Enhance `createGroup` to add "+ New Tab" button inside each group
    const originalCreateGroup = createGroup; // Save original

    window.createGroup = function (items = [], idx) {
        const group = originalCreateGroup(items, idx);

        // Create "+ New Tab" button for this group
        const plusTabBtn = document.createElement('button');
        plusTabBtn.className = 'plus-tab-btn';
        plusTabBtn.textContent = '+';
        plusTabBtn.title = "Add new tab";


        plusTabBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Get window ID of this group
            const groupDataArray = groupData[idx];
            const windowId = (groupDataArray && groupDataArray[0]) ? groupDataArray[0].windowId : null;

            if (windowId != null) {
                // Create new tab in the group's window
                chrome.tabs.create({ windowId: windowId, active: false }, () => {
                    syncGroupDataFromBrowser();
                });
            }
        });

        group.appendChild(plusTabBtn);

        // Show the "+ New Tab" button on group hover
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

function syncGroupDataFromBrowser() {
    chrome.windows.getAll({ populate: true }, (windows) => {
        if (chrome.runtime.lastError) {
            console.error("Failed to get windows:", chrome.runtime.lastError);
            return;
        }

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


let groupData


initialize().then(() => {
    // After initializing local storage data, sync browser windows/tabs for current state
    syncGroupDataFromBrowser();
});
console.log("HELP")
console.log(groupData)

// Clear existing placeholder if any
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
                { state: "maximized", focused: true }, // must be focused for maximize to apply
                (newWindow) => {
                    if (chrome.runtime.lastError) {
                        console.error("Failed to create window:", chrome.runtime.lastError);
                        return;
                    }

                    // Move the tab into the new window at the desired index
                    chrome.tabs.move(
                        tabId,
                        { windowId: newWindow.id, index: targetIndex || 0 },
                        () => {
                            // Refocus previous window to restore focus
                            chrome.windows.update(prevWindow.id, { focused: true }, () => {
                                syncGroupDataFromBrowser();
                            });

                            // Remove the default "New Tab" page tab created in the new window
                            if (newWindow.tabs && newWindow.tabs.length > 0) {
                                const defaultTabId = newWindow.tabs[0].id;

                                // Only remove if default tab is NOT the tab you just moved
                                if (defaultTabId !== tabId) {
                                    chrome.tabs.remove(defaultTabId, () => {
                                        if (chrome.runtime.lastError) {
                                            console.error("Failed to remove default tab:", chrome.runtime.lastError);
                                        }
                                    });
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



// Find nearest item element in flex-wrap container for insertion logic
function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.grid-item:not(.dragging)')];

    // Will hold the element just after the pointer
    let afterElement = null;

    // Keep track of minimum distance to decide the "closest after"
    let minDistance = Infinity;

    for (const child of draggableElements) {
        const box = child.getBoundingClientRect();

        // Check if pointer is within vertical extent of the child element (same "row")
        if (y >= box.top && y <= box.bottom) {
            // Pointer horizontal relative to child
            const offset = x - box.left;

            // If pointer is to the left of element start, it's candidate for insertion before the element
            if (offset < 0 && Math.abs(offset) < minDistance) {
                minDistance = Math.abs(offset);
                afterElement = child;
            }
        }
    }

    // If none found in same row, check for first element below the pointer vertically
    if (!afterElement) {
        for (const child of draggableElements) {
            const box = child.getBoundingClientRect();

            if (box.top > y) {
                // closer vertical element below pointer
                const dist = box.top - y;
                if (dist < minDistance) {
                    minDistance = dist;
                    afterElement = child;
                }
            }
        }
    }

    // return element before which to insert, or null for append
    return afterElement;
}

function createGroup(items = [], idx) {
    const group = document.createElement('div');
    group.className = 'child-grid';
    group.dataset.group = idx;

    group.addEventListener('dragover', e => {
        e.preventDefault();
        group.classList.add('dragover');
        if (!draggedItem) return;

        const afterElement = getDragAfterElement(group, e.clientX, e.clientY);
        clearPlaceholder();

        // Create placeholder with same size as dragged item
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
        const itemObj = getItemById(draggedId);
        if (!itemObj) {
            hideDropIndicator();
            deactivateOutsideOverlay();
            return;
        }
        removeFromGroupData(draggedId);

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

            targetWindowId = itemObj.windowId;
        }

        smartMoveTab(itemObj.id, targetWindowId, newIndex);

        groupData[idx].splice(newIndex, 0, itemObj);
        renderBoard();
        hideDropIndicator();
        deactivateOutsideOverlay();
    });

    // Add group delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'group-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = "Delete this group";
    deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        // Close entire window corresponding to this group
        if (groupData[idx] && groupData[idx].length > 0) {
            const windowId = groupData[idx][0].windowId;
            chrome.windows.remove(windowId, () => {
                if (chrome.runtime.lastError) {
                    console.error("Failed to close window:", chrome.runtime.lastError);
                }
                // After closing, sync UI state:
                syncGroupDataFromBrowser();
            });
        } else {
            // fallback: just remove from groupData if no tabs (should be rare)
            groupData.splice(idx, 1);
            renderBoard();
        }
    });
    group.appendChild(deleteBtn);

    // Add items to group
    for (const itemObj of items) {
        group.appendChild(createGridItem(itemObj));
    }

    return group;
}

function createGridItem(itemObj) {
    const item = document.createElement('div');
    item.className = 'grid-item';
    item.textContent = itemObj.text;

    if (item.textContent == "Reflection Board") {
        item.style.background = "green"
    }
    item.draggable = true;
    item.dataset.id = itemObj.id;

    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = '×';
    btn.onclick = e => {
        e.stopPropagation();
        // Close the tab in the browser
        chrome.tabs.remove(itemObj.id, () => {
            if (chrome.runtime.lastError) {
                console.error("Failed to close tab:", chrome.runtime.lastError);
            }
            // After closing, sync UI state:
            syncGroupDataFromBrowser();
        });
    };


    item.appendChild(btn);


    item.addEventListener('dragstart', e => {
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
            if (chrome.runtime.lastError) {
                console.error("Failed to focus tab:", chrome.runtime.lastError);
            } else {
                // Also optionally focus the window containing this tab
                if (itemObj.windowId != null) {
                    chrome.windows.update(itemObj.windowId, { focused: true });
                }
            }
        });
    });

    item.addEventListener('mouseenter', e => {
        showTabPreview(itemObj, item);
    });
    item.addEventListener('mouseleave', e => {
        hideTabPreview();
    });


    return item;
}

function removeFromGroupData(id) {
    for (const group of groupData) {
        const index = group.findIndex(item => item.id === id);
        if (index !== -1) {
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
    const itemObj = getItemById(draggedId);
    if (!itemObj) return;
    removeFromGroupData(draggedId);
    groupData.push([itemObj]);

    smartMoveTab(itemObj.id, null, 0);

    renderBoard();
    hideDropIndicator();
    deactivateOutsideOverlay();
});

function renderBoard() {
    parentGrid.innerHTML = '';
    groupData = groupData.filter(g => g.length);
    groupData.forEach((items, idx) => parentGrid.appendChild(createGroup(items, idx)));

    const newWindowBtn = document.createElement('button');
    newWindowBtn.className = 'new-window-btn';
    newWindowBtn.textContent = '+';
    newWindowBtn.title = 'Create new window';
    newWindowBtn.type = 'button';
    // The .new-window-btn CSS style already ensures correct appearance

    newWindowBtn.addEventListener('click', () => {
        chrome.windows.getCurrent((prevWindow) => {
            chrome.windows.create(
                { state: "maximized", focused: true },
                (newWindow) => {
                    if (chrome.runtime.lastError) {
                        console.error("Failed to create window:", chrome.runtime.lastError);
                        return;
                    }
                    chrome.windows.update(prevWindow.id, { focused: true }, () => {
                        syncGroupDataFromBrowser();
                    });
                }
            );
        });
    });

    parentGrid.appendChild(newWindowBtn);
}


window.addDemoItem = function () {
    if (groupData.length === 0) groupData.push([]);
    groupData[0].push({ id: nextItemId++, text: 'Random' + Math.floor(Math.random() * 90 + 10) });
    renderBoard();
};

renderBoard();


