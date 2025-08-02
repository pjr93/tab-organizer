const parentGrid = document.getElementById('parent-grid');
const dropIndicator = document.getElementById('drop-indicator');
const outsideOverlay = document.getElementById('outside-overlay');

let draggedItem = null;     // The DOM element being dragged
let draggedId = null;       // The unique id of dragged item
let placeholder = null;     // Placeholder element showing drop position
let nextItemId = 1;         // Global unique id counter
let windowGroupData = [];

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



let groupData = [
    [{ id: nextItemId++, text: "Alpha" }, { id: nextItemId++, text: "Beta" }],
    [{ id: nextItemId++, text: "Gamma" }, { id: nextItemId++, text: "Delta" }, { id: nextItemId++, text: "Epsilon" }],
    [{ id: nextItemId++, text: "Zeta" }],
];
initialize()
console.log("HELP")
console.log(groupData)

// Clear existing placeholder if any
function clearPlaceholder() {
    if (placeholder && placeholder.parentElement) {
        placeholder.parentElement.removeChild(placeholder);
        placeholder = null;
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

        // Filter for only grid items and placeholder to calculate an accurate index
        const childrenArray = Array.from(group.children).filter(ch =>
            ch.classList.contains('grid-item') || ch === placeholder
        );

        let newIndex = placeholder && placeholder.parentElement === group
            ? childrenArray.indexOf(placeholder)
            : childrenArray.length;

        clearPlaceholder();

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
        groupData.splice(idx, 1);
        renderBoard();
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
    item.draggable = true;
    item.dataset.id = itemObj.id;

    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = '×';
    btn.onclick = e => {
        e.stopPropagation();
        removeFromGroupData(itemObj.id);
        renderBoard();
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
    renderBoard();
    hideDropIndicator();
    deactivateOutsideOverlay();
});

function renderBoard() {
    parentGrid.innerHTML = '';
    groupData = groupData.filter(g => g.length);
    groupData.forEach((items, idx) => parentGrid.appendChild(createGroup(items, idx)));
}

window.addDemoItem = function () {
    if (groupData.length === 0) groupData.push([]);
    groupData[0].push({ id: nextItemId++, text: 'Random' + Math.floor(Math.random() * 90 + 10) });
    renderBoard();
};

renderBoard();

chrome.windows.onRemoved.addListener(function(changes, namespace){
    console.log("changes")
    console.log(changes)
    console.log("namespace")
    console.log(namespace)
})

chrome.storage.onChanged.addListener(function (changes, namespace) {
  chrome.storage.local.get("browserData", function(data) {
        //console.log("data")
        //console.log(data)
    })
});


