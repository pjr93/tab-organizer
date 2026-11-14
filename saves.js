// Named internal saves, organised in folders (board page only).
//
// Storage: chrome.storage.local "internalSaves" =
//   { folders: ["Work", "Work/Research", ...],
//     saves: [{ id, name, folder, at, windows }],
//     lastSavedId,                  // save most recently created or overwritten
//     lastSessionSaveId }           // same, counting only whole-session saves
//                                   // (Ctrl+S / Save (Internal)); never autosaves
// `folder` is a "/"-separated path; "" is the top level. `windows` uses the
// same layout format as JSON files (serializeTabGroups in shared.js), so a
// save can be exported and later loaded with Upload JSON.
//
// The two autosave slots written by background.js are shown read-only in a
// virtual "Autosaves" folder.
//
// Uses from main.js: restoreState, downloadJson, isBoardTab.

const AUTOSAVE_FOLDER = '\u0000autosaves'; // virtual folder id (can't clash with a real name)
const AUTOSAVE_SLOTS = [
    { name: 'Autosave', dataKey: 'autoSave', timeKey: 'autoSavedAt' },
    { name: 'Autosave from previous browser session', dataKey: 'autoSavePrev', timeKey: 'autoSavePrevAt' },
];

let lastSaveFolder = '';       // folder last saved into (default for the next new save)

// Sort order for both dialogs' lists, kept in chrome.storage.local "savesSort".
// Folders are listed before saves and sorted by the same rule: by name, by
// their newest save, or by the tabs in all their saves (subfolders included).
// Ties are broken by name.
const SAVE_SORTS = [
    ['date-desc', 'Newest first'],
    ['date-asc', 'Oldest first'],
    ['name-asc', 'Name A–Z'],
    ['name-desc', 'Name Z–A'],
    ['tabs-desc', 'Most tabs'],
    ['tabs-asc', 'Fewest tabs'],
];
let savesSort = 'date-desc';
chrome.storage.local.get('savesSort').then(({ savesSort: stored }) => {
    if (SAVE_SORTS.some(([v]) => v === stored)) savesSort = stored;
}).catch(() => { });

/* ---------------- storage ---------------- */

async function readSavesStore() {
    const { internalSaves, savedState, savedAt } = await chrome.storage.local.get(['internalSaves', 'savedState', 'savedAt']);
    const store = internalSaves && Array.isArray(internalSaves.saves)
        ? internalSaves
        : { folders: [], saves: [] };
    if (!Array.isArray(store.folders)) store.folders = [];
    // One-time migration of the old single Ctrl+S slot.
    if (Array.isArray(savedState) && savedState.length) {
        const id = newSaveId();
        store.saves.push({ id, name: 'Manual save', folder: '', at: savedAt || Date.now(), windows: savedState });
        if (!store.lastSavedId) store.lastSavedId = id;
        await writeSavesStore(store);
        await chrome.storage.local.remove(['savedState', 'savedAt']);
    }
    return store;
}

async function writeSavesStore(store) {
    try {
        await chrome.storage.local.set({ internalSaves: store });
    } catch (e) {
        alert(`Could not write internal saves: ${e.message}`);
        throw e;
    }
}

function newSaveId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- folder helpers ---------------- */

function parentFolder(path) {
    const i = path.lastIndexOf('/');
    return i === -1 ? '' : path.slice(0, i);
}

function isInFolderTree(path, root) {
    return path === root || path.startsWith(root + '/');
}

function childFolders(store, path) {
    return store.folders.filter(f => parentFolder(f) === path);
}

// `items` are { name, at, tabs }; returns a sorted copy.
function sortBy(items, sort = savesSort) {
    const [field, dir] = sort.split('-');
    const sign = dir === 'asc' ? 1 : -1;
    const byName = (x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' });
    return [...items].sort((x, y) => {
        if (field === 'name') return sign * byName(x, y);
        const c = field === 'tabs' ? x.tabs - y.tabs : (x.at || 0) - (y.at || 0);
        return c ? sign * c : byName(x, y);
    });
}

function sortSaves(saves) {
    return sortBy(saves.map(s => ({ name: s.name, at: s.at, tabs: countTabs(s.windows), save: s }))).map(i => i.save);
}

function sortFolders(store, paths) {
    return sortBy(paths.map(path => {
        const inside = store.saves.filter(s => isInFolderTree(s.folder, path));
        return {
            name: path.split('/').pop(),
            at: inside.reduce((m, s) => Math.max(m, s.at || 0), 0),
            tabs: inside.reduce((n, s) => n + countTabs(s.windows), 0),
            path,
        };
    })).map(i => i.path);
}

function countTabs(windows) {
    return (windows || []).reduce((n, w) => n + (w.tabs || []).filter(t => !isBoardTab(t)).length, 0);
}

function describeSave(save) {
    const when = save.at ? new Date(save.at).toLocaleString() : 'unknown time';
    const w = (save.windows || []).length;
    return `${when} · ${w} window${w === 1 ? '' : 's'}, ${countTabs(save.windows)} tab(s)`;
}

function folderDisplay(folder) {
    return folder === AUTOSAVE_FOLDER ? 'Autosaves' : (folder || '/');
}

async function getAutosaves() {
    const keys = AUTOSAVE_SLOTS.flatMap(s => [s.dataKey, s.timeKey]);
    const result = await chrome.storage.local.get(keys);
    return AUTOSAVE_SLOTS
        .filter(s => Array.isArray(result[s.dataKey]) && result[s.dataKey].length)
        .map(s => ({ id: s.dataKey, name: s.name, folder: AUTOSAVE_FOLDER, at: result[s.timeKey], windows: result[s.dataKey], readOnly: true }));
}

/* ---------------- saves browser (shared by Load and Save dialogs) ---------------- */
//
// mode "manage": rows have Load / Add / Export JSON / Delete, folders can be
//                created and deleted, autosaves are shown.
// mode "pick":   file-dialog style: click a save to select it (onPick),
//                double-click to choose it (onActivate); no autosaves
//                (they can't be overwritten). onRender runs after each render.

// Both modes: the sort dropdown (sortEl), and dragging saves / folders onto a
// folder row or a crumb in the path bar moves them there (autosaves can't be
// moved or dropped into).

function createSavesBrowser({ listEl, pathEl, searchEl, sortEl = null, newFolderBtn = null, mode, onPick = null, onActivate = null, onRender = null }) {
    const b = { folder: '', selectedId: null, store: null, listEl, pathEl, searchEl, sortEl, newFolderBtn, mode, onPick, onActivate, onRender };
    b.highlight = null; // { saveId } | { folderPath }: row to flash after the next render
    // One-line status under the path bar ("Moved ... into ...").
    b.noteEl = document.createElement('div');
    b.noteEl.className = 'saves-note';
    b.noteEl.setAttribute('aria-live', 'polite');
    pathEl.after(b.noteEl);
    b.render = () => renderSavesBrowser(b);
    b.openAt = (folder) => { b.folder = folder; searchEl.value = ''; return b.render(); };
    searchEl.addEventListener('input', () => b.render());
    if (newFolderBtn) newFolderBtn.addEventListener('click', () => createFolder(b));
    enableDragAutoScroll(listEl);
    if (sortEl) {
        for (const [value, label] of SAVE_SORTS) sortEl.add(new Option(label, value));
        sortEl.addEventListener('change', () => {
            savesSort = sortEl.value;
            chrome.storage.local.set({ savesSort });
            b.render();
        });
    }
    return b;
}

/* ---------------- drag and drop into folders ---------------- */

// { kind: 'save', id, folder } | { kind: 'folder', path }, plus `row` (the
// element being dragged).
let savesDrag = null;

// Hovering a folder (row or path crumb) this long while dragging opens it, so
// you can drop inside it or go further down, like a file manager.
const SPRING_OPEN_MS = 800;
let springTimer = null;
let springEl = null;

function cancelSpringOpen() {
    clearTimeout(springTimer);
    springTimer = null;
    if (springEl) springEl.classList.remove('spring-pending');
    springEl = null;
}

function endSavesDrag() {
    cancelSpringOpen();
    if (savesDrag && savesDrag.row) savesDrag.row.classList.remove('row-dragging');
    savesDrag = null;
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    for (const holder of document.querySelectorAll('.drag-source-holder')) holder.replaceChildren();
}

// Re-rendering the list mid-drag (after a spring open) would remove the row
// being dragged, and a removed drag source never gets its dragend. Park it in
// a hidden holder in the same dialog until the drag ends.
function keepDragSource(b) {
    const row = savesDrag && savesDrag.row;
    if (!row || !b.listEl.contains(row)) return;
    const area = b.listEl.closest('dialog') || document.body;
    let holder = area.querySelector(':scope > .drag-source-holder');
    if (!holder) {
        holder = document.createElement('div');
        holder.className = 'drag-source-holder';
        holder.hidden = true;
        area.appendChild(holder);
    }
    holder.appendChild(row);
}

function makeRowDraggable(row, item) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
        savesDrag = { ...item, row };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.kind);
        row.classList.add('row-dragging');
    });
    row.addEventListener('dragend', endSavesDrag);
}

// Fallback in case a drag ends without a dragend reaching us: the first mouse
// move with no button held means no drag is going on.
document.addEventListener('mousemove', (e) => {
    if (savesDrag && e.buttons === 0) endSavesDrag();
});

// While dragging a save/folder, scroll the list when the pointer is near its
// top or bottom edge, or anywhere above/below it in the dialog (the mouse
// wheel doesn't work during a drag). Faster the closer to / further past the
// edge. dragover keeps firing while the pointer is still, and the loop stops
// once it stops firing (drop, drag end, or pointer back in the middle).
const AUTOSCROLL_ZONE_PX = 48;
const AUTOSCROLL_MAX_PX_PER_FRAME = 18;

function enableDragAutoScroll(listEl) {
    const area = listEl.closest('dialog') || listEl.parentElement;
    let speed = 0;          // px per frame, negative = up
    let lastOver = 0;
    let running = false;

    const step = () => {
        if (!speed || Date.now() - lastOver > 150) { running = false; speed = 0; return; }
        listEl.scrollTop += speed;
        requestAnimationFrame(step);
    };

    area.addEventListener('dragover', (e) => {
        if (!savesDrag) return;
        const r = listEl.getBoundingClientRect();
        const fromTop = e.clientY - r.top;
        const fromBottom = r.bottom - e.clientY;
        const strength = d => Math.min(1, (AUTOSCROLL_ZONE_PX - d) / AUTOSCROLL_ZONE_PX);
        if (fromTop < AUTOSCROLL_ZONE_PX) speed = -Math.ceil(strength(fromTop) * AUTOSCROLL_MAX_PX_PER_FRAME);
        else if (fromBottom < AUTOSCROLL_ZONE_PX) speed = Math.ceil(strength(fromBottom) * AUTOSCROLL_MAX_PX_PER_FRAME);
        else speed = 0;
        lastOver = Date.now();
        if (speed && !running) { running = true; requestAnimationFrame(step); }
    });
}

function canDropInto(path) {
    const d = savesDrag;
    if (!d || path === AUTOSAVE_FOLDER) return false;
    if (d.kind === 'save') return d.folder !== path;
    // A folder can't go into itself, a subfolder of itself, or where it already is.
    return !isInFolderTree(path, d.path) && parentFolder(d.path) !== path;
}

// Whether hovering folder `path` while dragging should open it.
function canSpringOpen(b, path) {
    const d = savesDrag;
    if (!d || path === AUTOSAVE_FOLDER || path === b.folder) return false;
    return !(d.kind === 'folder' && isInFolderTree(path, d.path)); // not into itself
}

// `el` (a folder row or path crumb) accepts drops into folder `path`, and
// opens that folder when hovered for SPRING_OPEN_MS.
function makeFolderDropTarget(el, b, path) {
    el.addEventListener('dragover', (e) => {
        if (canSpringOpen(b, path) && springEl !== el) {
            cancelSpringOpen();
            springEl = el;
            el.classList.add('spring-pending');
            springTimer = setTimeout(() => {
                cancelSpringOpen();
                if (!canSpringOpen(b, path)) return;
                keepDragSource(b);
                b.searchEl.value = '';
                b.folder = path;
                b.render();
            }, SPRING_OPEN_MS);
        }
        if (!canDropInto(path)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', (e) => {
        if (el.contains(e.relatedTarget)) return;
        el.classList.remove('drop-target');
        if (springEl === el) cancelSpringOpen();
    });
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        const d = savesDrag;
        const ok = d && canDropInto(path);
        endSavesDrag();
        if (!ok) return;
        if (d.kind === 'save') moveSaveToFolder(b, d.id, path);
        else moveFolderInto(b, d.path, path);
    });
}

// After a move: open the destination, flash the moved row there and say what
// happened.
function showMovedInto(b, target, highlight, message) {
    b.searchEl.value = '';
    b.folder = target;
    b.highlight = highlight;
    b.render();
    showSavesNote(b, message);
}

function showSavesNote(b, text) {
    clearTimeout(b.noteTimer);
    b.noteEl.textContent = text;
    b.noteEl.classList.add('visible');
    b.noteTimer = setTimeout(() => b.noteEl.classList.remove('visible'), 4000);
}

function folderLabel(path) {
    return path ? `📁 ${path}` : 'the top level';
}

function folderWhere(path) {
    return path ? `"${path}"` : 'the top level';
}

// A save with the same name already in the target is replaced after confirming,
// like saving over it.
async function moveSaveToFolder(b, saveId, target) {
    const store = await readSavesStore();
    const save = store.saves.find(s => s.id === saveId);
    if (!save || save.folder === target) return;
    const clash = store.saves.find(s => s !== save && s.folder === target && s.name === save.name);
    if (clash) {
        if (!confirm(`"${save.name}" already exists in ${folderWhere(target)}.\nDo you want to replace it?`)) return;
        store.saves = store.saves.filter(s => s !== clash);
        if (store.lastSavedId === clash.id) store.lastSavedId = save.id;
        if (store.lastSessionSaveId === clash.id) store.lastSessionSaveId = save.id;
    }
    save.folder = target;
    await writeSavesStore(store);
    showMovedInto(b, target, { saveId: save.id }, `Moved "${save.name}" into ${folderLabel(target)}.`);
}

// Moves the folder with its subfolders and saves. Refused if the target
// already has a folder with that name.
async function moveFolderInto(b, path, target) {
    const name = path.split('/').pop();
    const newPath = target ? `${target}/${name}` : name;
    const store = await readSavesStore();
    if (!store.folders.includes(path)) return;
    if (store.folders.includes(newPath)) {
        alert(`${folderWhere(target)} already has a folder named "${name}".`);
        return;
    }
    const remap = p => isInFolderTree(p, path) ? newPath + p.slice(path.length) : p;
    store.folders = store.folders.map(remap);
    for (const s of store.saves) s.folder = remap(s.folder);
    await writeSavesStore(store);
    lastSaveFolder = remap(lastSaveFolder);
    showMovedInto(b, target, { folderPath: newPath }, `Moved folder "${name}" into ${folderLabel(target)}.`);
}

function makeButton(label, title, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'state-btn small-btn ' + extraClass;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
}

function renderPathBar(b) {
    const container = b.pathEl;
    container.replaceChildren();
    const parts = [['Top level', '']];
    if (b.folder === AUTOSAVE_FOLDER) {
        parts.push(['Autosaves', AUTOSAVE_FOLDER]);
    } else {
        let acc = '';
        for (const seg of b.folder ? b.folder.split('/') : []) {
            acc = acc ? acc + '/' + seg : seg;
            parts.push([seg, acc]);
        }
    }
    parts.forEach(([label, path], i) => {
        if (i > 0) container.append(' / ');
        const crumb = document.createElement('button');
        crumb.type = 'button';
        crumb.className = 'crumb';
        crumb.textContent = label;
        crumb.disabled = i === parts.length - 1;
        crumb.addEventListener('click', () => { b.folder = path; b.render(); });
        container.appendChild(crumb);
        // Disabled buttons get no drag events, so the current folder isn't a
        // target (dropping there would do nothing anyway).
        makeFolderDropTarget(crumb, b, path);
    });
}

function folderRow(b, label, path, meta, onDelete) {
    const row = document.createElement('div');
    row.className = 'load-slot folder-row';
    row.dataset.folderPath = path;
    row.title = 'Open folder';
    const info = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = '📁 ' + label;
    const m = document.createElement('div');
    m.className = 'load-slot-meta';
    m.textContent = meta;
    info.append(name, m);
    row.appendChild(info);
    if (onDelete) {
        const actions = document.createElement('div');
        actions.className = 'load-slot-actions';
        actions.appendChild(makeButton('Delete', 'Delete this folder and everything in it', onDelete, 'danger-btn'));
        row.appendChild(actions);
    }
    row.addEventListener('click', () => {
        b.searchEl.value = ''; // opening a folder leaves search
        b.folder = path;
        b.render();
    });
    if (path !== AUTOSAVE_FOLDER) {
        row.title = 'Open folder · drop saves or folders here to move them in (hold over it to open it)';
        makeRowDraggable(row, { kind: 'folder', path });
        makeFolderDropTarget(row, b, path);
    }
    return row;
}

function saveRow(b, save, { showFolder = false, matchNote = '' } = {}) {
    const row = document.createElement('div');
    row.className = 'load-slot';
    const info = document.createElement('div');
    info.className = 'load-slot-info';
    const name = document.createElement('b');
    name.textContent = save.name;
    const meta = document.createElement('div');
    meta.className = 'load-slot-meta';
    meta.textContent = (showFolder ? `📁 ${folderDisplay(save.folder)} · ` : '') + describeSave(save);
    info.append(name, meta);
    if (matchNote) {
        const note = document.createElement('div');
        note.className = 'load-slot-match';
        note.textContent = matchNote;
        info.appendChild(note);
    }
    row.appendChild(info);
    row.dataset.saveId = save.id;
    if (!save.readOnly) makeRowDraggable(row, { kind: 'save', id: save.id, folder: save.folder });

    if (b.mode === 'pick') {
        row.classList.add('pick-row');
        if (save.id === b.selectedId) row.classList.add('picked');
        row.title = 'Click to select, double-click to save over it, drag onto a folder to move it';
        row.addEventListener('click', () => { if (b.onPick) b.onPick(save); });
        row.addEventListener('dblclick', () => { if (b.onActivate) b.onActivate(save); });
        return row;
    }

    const actions = document.createElement('div');
    actions.className = 'load-slot-actions';
    actions.append(
        makeButton('Add', 'Open this save alongside your current tabs', () => loadSave(save, false)),
        makeButton('Export JSON', 'Download this save as a .json file (loadable with Upload JSON)', () => exportSave(save)),
        makeButton('Load', 'Replace all open tabs with this save', () => loadSave(save, true)),
    );
    if (!save.readOnly) {
        actions.appendChild(makeButton('Delete', 'Delete this save', () => deleteSave(b, save), 'danger-btn'));
    }
    row.appendChild(actions);
    return row;
}

function searchMatch(save, q) {
    if (save.name.toLowerCase().includes(q)) return { hit: true, note: '' };
    for (const w of save.windows || []) {
        for (const t of w.tabs || []) {
            if ((t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q)) {
                return { hit: true, note: `contains: ${t.title || t.url}` };
            }
        }
        if ((w.title || '').toLowerCase().includes(q)) return { hit: true, note: `window: ${w.title}` };
    }
    return { hit: false };
}

function emptyNote(list, text) {
    const p = document.createElement('p');
    p.className = 'load-slot-meta';
    p.textContent = text;
    list.appendChild(p);
}

async function renderSavesBrowser(b) {
    await renderSavesBrowserInner(b);
    applySavesHighlight(b);
    if (b.onRender) b.onRender();
}

// Flash the row named by b.highlight (set after a move) and scroll it into view.
function applySavesHighlight(b) {
    const h = b.highlight;
    b.highlight = null;
    if (!h) return;
    const row = Array.from(b.listEl.querySelectorAll('.load-slot')).find(r =>
        (h.saveId && r.dataset.saveId === h.saveId) || (h.folderPath && r.dataset.folderPath === h.folderPath));
    if (!row) return;
    row.classList.add('just-moved');
    row.scrollIntoView({ block: 'nearest' });
    setTimeout(() => row.classList.remove('just-moved'), 1600);
}

async function renderSavesBrowserInner(b) {
    const store = await readSavesStore();
    b.store = store;
    const autosaves = b.mode === 'manage' ? await getAutosaves() : [];
    const list = b.listEl;
    const q = b.searchEl.value.trim().toLowerCase();
    if (b.sortEl) b.sortEl.value = savesSort; // the other dialog may have changed it
    list.replaceChildren();

    // The folder we were in may have been deleted.
    if (b.folder !== AUTOSAVE_FOLDER && b.folder !== '' && !store.folders.includes(b.folder)) b.folder = '';
    if (b.folder === AUTOSAVE_FOLDER && b.mode !== 'manage') b.folder = '';

    if (q) {
        // Search: flat results from every folder (and autosaves).
        b.pathEl.textContent = `Search results for "${q}"`;
        if (b.newFolderBtn) b.newFolderBtn.disabled = true;
        const matches = new Map();
        for (const s of [...store.saves, ...autosaves]) {
            const m = searchMatch(s, q);
            if (m.hit) matches.set(s, m);
        }
        const results = sortSaves([...matches.keys()]);
        const folderHits = sortFolders(store, store.folders.filter(f => f.split('/').pop().toLowerCase().includes(q)));
        for (const f of folderHits) list.appendChild(folderRow(b, f, f, 'folder', null));
        for (const s of results) list.appendChild(saveRow(b, s, { showFolder: true, matchNote: matches.get(s).note }));
        if (!results.length && !folderHits.length) emptyNote(list, 'No saves match.');
        return;
    }

    renderPathBar(b);

    if (b.folder === AUTOSAVE_FOLDER) {
        if (b.newFolderBtn) b.newFolderBtn.disabled = true;
        for (const s of sortSaves(autosaves)) list.appendChild(saveRow(b, s));
        if (!autosaves.length) emptyNote(list, 'No autosaves yet. Turn on the autosave checkbox on the board.');
        return;
    }

    if (b.newFolderBtn) b.newFolderBtn.disabled = false;
    if (b.folder === '' && autosaves.length) {
        list.appendChild(folderRow(b, 'Autosaves', AUTOSAVE_FOLDER, `${autosaves.length} autosave(s) · read-only`, null));
    }
    for (const f of sortFolders(store, childFolders(store, b.folder))) {
        const saves = store.saves.filter(s => isInFolderTree(s.folder, f)).length;
        const subs = store.folders.filter(x => x !== f && isInFolderTree(x, f)).length;
        list.appendChild(folderRow(b, f.split('/').pop(), f,
            `${saves} save(s)${subs ? `, ${subs} subfolder(s)` : ''}`,
            b.mode === 'manage' ? () => deleteFolder(b, f) : null));
    }
    for (const s of sortSaves(store.saves.filter(s => s.folder === b.folder))) list.appendChild(saveRow(b, s));
    if (!list.children.length) {
        emptyNote(list, b.folder ? 'This folder is empty.' : "No internal saves yet. Use 'Save (Internal)' or Ctrl+S.");
    }
}

/* ---------------- Load dialog ---------------- */

const loadBrowser = createSavesBrowser({
    listEl: document.getElementById('saves-list'),
    pathEl: document.getElementById('saves-path'),
    searchEl: document.getElementById('saves-search'),
    sortEl: document.getElementById('saves-sort'),
    newFolderBtn: document.getElementById('new-folder-btn'),
    mode: 'manage',
});

async function openLoadDialog() {
    const dialog = document.getElementById('load-dialog');
    loadBrowser.searchEl.value = '';
    if (!dialog.open) dialog.showModal();
    await loadBrowser.render();
    loadBrowser.searchEl.focus();
}

/* ---------------- Save dialog ("Save As" style) ---------------- */
//
// Works like an operating system's Save As dialog: browse to a folder (or
// make a New folder there), type a name or click an existing save to reuse
// its name, then Save. If the name already exists in that folder, the save
// is replaced after confirming. Double-clicking a save saves over it.
//
// Starting name and folder depend on what is being saved (`kind`):
//   "session" (Ctrl+S, Save (Internal)): the last whole-session save, so
//       saving over it again is one step (lastSessionSaveId; for older stores
//       without it, the newest save with more than one window). Without one,
//       the dated default name in the folder you last saved to.
//   "window" (a window's save button, the selection toolbar): always the
//       window's own name (defaultName), in the folder you last saved to.
// Autosaves aren't in store.saves, so they are never used.

const saveDialogState = { windows: null, defaultName: '', kind: 'window' };

const pickBrowser = createSavesBrowser({
    listEl: document.getElementById('pick-list'),
    pathEl: document.getElementById('pick-path'),
    searchEl: document.getElementById('pick-search'),
    sortEl: document.getElementById('pick-sort'),
    newFolderBtn: document.getElementById('save-new-folder-btn'),
    mode: 'pick',
    onPick: (save) => selectSaveInDialog(save),
    onActivate: (save) => { selectSaveInDialog(save); submitSaveDialog(); },
    onRender: () => updateSaveDialog(),
});

// Clicking a save: use its name (and, from search results, go to its folder).
function selectSaveInDialog(save) {
    document.getElementById('save-name').value = save.name;
    if (pickBrowser.searchEl.value || pickBrowser.folder !== save.folder) {
        pickBrowser.selectedId = save.id;
        pickBrowser.openAt(save.folder); // re-renders, then updateSaveDialog
    } else {
        updateSaveDialog();
    }
}

// The existing save (if any) in the current folder with the typed name.
function saveMatchingName() {
    const name = document.getElementById('save-name').value.trim();
    const store = pickBrowser.store;
    if (!name || !store) return null;
    return store.saves.find(s => s.folder === pickBrowser.folder && s.name === name) || null;
}

function updateSaveDialog() {
    const match = saveMatchingName();
    pickBrowser.selectedId = match ? match.id : null;
    for (const row of pickBrowser.listEl.querySelectorAll('.pick-row')) {
        row.classList.toggle('picked', !!match && row.dataset.saveId === match.id);
    }
    const where = pickBrowser.folder ? `📁 ${pickBrowser.folder}` : 'the top level';
    document.getElementById('save-location').textContent = match
        ? `Saving in ${where}. "${match.name}" already exists here and will be replaced.`
        : `Saving in ${where}.`;
}

// The save Ctrl+S should offer to save over, or null.
function lastSessionSave(store) {
    const byId = store.saves.find(s => s.id === store.lastSessionSaveId);
    if (byId) return byId;
    if (store.lastSessionSaveId) return null; // it was deleted
    // Stores from before lastSessionSaveId: newest multi-window save.
    return store.saves
        .filter(s => (s.windows || []).length > 1)
        .reduce((best, s) => (!best || (s.at || 0) > (best.at || 0) ? s : best), null);
}

// Open the dialog to store `windows`. kind: "session" or "window" (see above).
async function openSaveDialog(windows, defaultName, { kind = 'window' } = {}) {
    if (!windows || !windows.length) {
        alert('Nothing to save.');
        return;
    }
    const store = await readSavesStore();
    const lastSaved = store.saves.find(s => s.id === store.lastSavedId) || null;
    const lastFolder = lastSaved ? lastSaved.folder : (store.folders.includes(lastSaveFolder) ? lastSaveFolder : '');
    const sessionSave = kind === 'session' ? lastSessionSave(store) : null;

    saveDialogState.windows = windows;
    saveDialogState.defaultName = defaultName || '';
    saveDialogState.kind = kind;
    document.getElementById('save-dialog-title').textContent =
        windows.length === 1 ? 'Save window internally' : 'Save session internally';
    document.getElementById('save-summary').textContent =
        `${windows.length} window${windows.length === 1 ? '' : 's'}, ${countTabs(windows)} tab(s)`;

    // A matching name pre-selects that save (updateSaveDialog).
    const nameInput = document.getElementById('save-name');
    nameInput.value = sessionSave ? sessionSave.name : saveDialogState.defaultName;
    const startFolder = sessionSave ? sessionSave.folder : lastFolder;

    const dialog = document.getElementById('save-dialog');
    dialog.showModal();
    await pickBrowser.openAt(startFolder);
    nameInput.focus();
    nameInput.select();
}

async function submitSaveDialog() {
    const dialog = document.getElementById('save-dialog');
    const nameInput = document.getElementById('save-name');
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        return;
    }
    const folder = pickBrowser.folder;
    const windows = saveDialogState.windows;
    const store = await readSavesStore();
    const existing = store.saves.find(s => s.folder === folder && s.name === name);
    let savedId;
    if (existing) {
        const where = folder ? `"${folder}"` : 'the top level';
        if (!confirm(`"${name}" already exists in ${where}.\nDo you want to replace it?`)) return;
        existing.windows = windows;
        existing.at = Date.now();
        savedId = existing.id;
    } else {
        savedId = newSaveId();
        store.saves.push({ id: savedId, name, folder, at: Date.now(), windows });
    }
    store.lastSavedId = savedId;
    if (saveDialogState.kind === 'session') store.lastSessionSaveId = savedId;
    await writeSavesStore(store);
    chrome.storage.local.remove('lastSaveAction').catch(() => { }); // no longer used
    lastSaveFolder = folder;
    saveDialogState.windows = null;
    dialog.close();
}

/* ---------------- actions ---------------- */

async function loadSave(save, replace) {
    document.getElementById('load-dialog').close();
    try {
        await restoreState(save.windows, { replace });
    } catch (err) {
        console.error(err);
        alert(`Could not load "${save.name}": ${err.message}`);
    }
}

function exportSave(save) {
    const safe = save.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'tab_layout';
    downloadJson(save.windows, safe + '.json');
}

async function deleteSave(b, save) {
    if (!confirm(`Delete the save "${save.name}"? This can't be undone.`)) return;
    const store = await readSavesStore();
    store.saves = store.saves.filter(s => s.id !== save.id);
    if (store.lastSavedId === save.id) delete store.lastSavedId;
    await writeSavesStore(store);
    b.render();
}

async function deleteFolder(b, path) {
    const store = await readSavesStore();
    const saves = store.saves.filter(s => isInFolderTree(s.folder, path)).length;
    const subs = store.folders.filter(f => f !== path && isInFolderTree(f, path)).length;
    const contents = saves || subs
        ? ` It contains ${saves} save(s)${subs ? ` and ${subs} subfolder(s)` : ''}, which will also be deleted.`
        : '';
    if (!confirm(`Delete the folder "${path}"?${contents} This can't be undone.`)) return;
    store.folders = store.folders.filter(f => !isInFolderTree(f, path));
    store.saves = store.saves.filter(s => !isInFolderTree(s.folder, path));
    if (store.lastSavedId && !store.saves.some(s => s.id === store.lastSavedId)) delete store.lastSavedId;
    await writeSavesStore(store);
    if (isInFolderTree(b.folder, path)) b.folder = parentFolder(path);
    if (isInFolderTree(lastSaveFolder, path)) lastSaveFolder = '';
    b.render();
}

// Ask for a folder name and create it inside `parent`. Returns the new
// folder's path, or null if cancelled / it already exists.
async function addFolder(parent) {
    const raw = prompt(`New folder in ${parent ? `"${parent}"` : 'the top level'}:`);
    if (raw == null) return null;
    const name = raw.trim().replace(/\//g, '-');
    if (!name) return null;
    const path = parent ? `${parent}/${name}` : name;
    const store = await readSavesStore();
    if (store.folders.includes(path)) {
        alert(`A folder named "${name}" already exists here.`);
        return null;
    }
    store.folders.push(path);
    await writeSavesStore(store);
    return path;
}

async function createFolder(b) {
    if (b.folder === AUTOSAVE_FOLDER) return;
    if (await addFolder(b.folder)) b.render();
}

/* ---------------- wiring ---------------- */

document.getElementById('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitSaveDialog();
});
document.getElementById('save-name').addEventListener('input', () => updateSaveDialog());
// Enter in the picker's search box shouldn't submit the form.
document.getElementById('pick-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
});
document.getElementById('save-dialog-cancel').addEventListener('click', () => {
    document.getElementById('save-dialog').close();
});
document.getElementById('load-dialog-cancel').addEventListener('click', () => {
    document.getElementById('load-dialog').close();
});
