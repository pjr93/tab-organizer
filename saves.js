// Named internal saves, organised in folders (board page only).
//
// Storage: chrome.storage.local "internalSaves" =
//   { folders: ["Work", "Work/Research", ...],
//     saves: [{ id, name, folder, at, windows }],
//     lastSavedId }                 // save most recently created or overwritten
// and "lastSaveAction": "new" | "overwrite" (what the last save did).
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
    return store.folders.filter(f => parentFolder(f) === path).sort((a, b) => a.localeCompare(b));
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

function createSavesBrowser({ listEl, pathEl, searchEl, newFolderBtn = null, mode, onPick = null, onActivate = null, onRender = null }) {
    const b = { folder: '', selectedId: null, store: null, listEl, pathEl, searchEl, newFolderBtn, mode, onPick, onActivate, onRender };
    b.render = () => renderSavesBrowser(b);
    b.openAt = (folder) => { b.folder = folder; searchEl.value = ''; return b.render(); };
    searchEl.addEventListener('input', () => b.render());
    if (newFolderBtn) newFolderBtn.addEventListener('click', () => createFolder(b));
    return b;
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
    });
}

function folderRow(b, label, path, meta, onDelete) {
    const row = document.createElement('div');
    row.className = 'load-slot folder-row';
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

    if (b.mode === 'pick') {
        row.classList.add('pick-row');
        row.dataset.saveId = save.id;
        if (save.id === b.selectedId) row.classList.add('picked');
        row.title = 'Click to select, double-click to save over it';
        row.addEventListener('click', () => { if (b.onPick) b.onPick(save); });
        row.addEventListener('dblclick', () => { if (b.onActivate) b.onActivate(save); });
        return row;
    }

    const actions = document.createElement('div');
    actions.className = 'load-slot-actions';
    actions.append(
        makeButton('Load', 'Replace all open tabs with this save', () => loadSave(save, true)),
        makeButton('Add', 'Open this save alongside your current tabs', () => loadSave(save, false)),
        makeButton('Export JSON', 'Download this save as a .json file (loadable with Upload JSON)', () => exportSave(save)),
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
    if (b.onRender) b.onRender();
}

async function renderSavesBrowserInner(b) {
    const store = await readSavesStore();
    b.store = store;
    const autosaves = b.mode === 'manage' ? await getAutosaves() : [];
    const list = b.listEl;
    const q = b.searchEl.value.trim().toLowerCase();
    list.replaceChildren();

    // The folder we were in may have been deleted.
    if (b.folder !== AUTOSAVE_FOLDER && b.folder !== '' && !store.folders.includes(b.folder)) b.folder = '';
    if (b.folder === AUTOSAVE_FOLDER && b.mode !== 'manage') b.folder = '';

    if (q) {
        // Search: flat results from every folder (and autosaves).
        b.pathEl.textContent = `Search results for "${q}"`;
        if (b.newFolderBtn) b.newFolderBtn.disabled = true;
        const results = [...store.saves, ...autosaves]
            .map(s => ({ s, m: searchMatch(s, q) }))
            .filter(r => r.m.hit)
            .sort((x, y) => (y.s.at || 0) - (x.s.at || 0));
        const folderHits = store.folders.filter(f => f.split('/').pop().toLowerCase().includes(q));
        for (const f of folderHits) list.appendChild(folderRow(b, f, f, 'folder', null));
        for (const { s, m } of results) list.appendChild(saveRow(b, s, { showFolder: true, matchNote: m.note }));
        if (!results.length && !folderHits.length) emptyNote(list, 'No saves match.');
        return;
    }

    renderPathBar(b);

    if (b.folder === AUTOSAVE_FOLDER) {
        if (b.newFolderBtn) b.newFolderBtn.disabled = true;
        for (const s of autosaves) list.appendChild(saveRow(b, s));
        if (!autosaves.length) emptyNote(list, 'No autosaves yet. Turn on the autosave checkbox on the board.');
        return;
    }

    if (b.newFolderBtn) b.newFolderBtn.disabled = false;
    if (b.folder === '' && autosaves.length) {
        list.appendChild(folderRow(b, 'Autosaves', AUTOSAVE_FOLDER, `${autosaves.length} autosave(s) · read-only`, null));
    }
    for (const f of childFolders(store, b.folder)) {
        const saves = store.saves.filter(s => isInFolderTree(s.folder, f)).length;
        const subs = store.folders.filter(x => x !== f && isInFolderTree(x, f)).length;
        list.appendChild(folderRow(b, f.split('/').pop(), f,
            `${saves} save(s)${subs ? `, ${subs} subfolder(s)` : ''}`,
            b.mode === 'manage' ? () => deleteFolder(b, f) : null));
    }
    const here = store.saves.filter(s => s.folder === b.folder).sort((x, y) => (y.at || 0) - (x.at || 0));
    for (const s of here) list.appendChild(saveRow(b, s));
    if (!list.children.length) {
        emptyNote(list, b.folder ? 'This folder is empty.' : "No internal saves yet. Use 'Save (Internal)' or Ctrl+S.");
    }
}

/* ---------------- Load dialog ---------------- */

const loadBrowser = createSavesBrowser({
    listEl: document.getElementById('saves-list'),
    pathEl: document.getElementById('saves-path'),
    searchEl: document.getElementById('saves-search'),
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
// It opens in the folder you last saved to. If your last action replaced a
// save, that save is pre-selected (so saving over it again is one step);
// otherwise the default new name is filled in. ("lastSaveAction")

const saveDialogState = { windows: null, defaultName: '' };

const pickBrowser = createSavesBrowser({
    listEl: document.getElementById('pick-list'),
    pathEl: document.getElementById('pick-path'),
    searchEl: document.getElementById('pick-search'),
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

// Open the dialog to store `windows` (whole session or one window).
async function openSaveDialog(windows, defaultName) {
    if (!windows || !windows.length) {
        alert('Nothing to save.');
        return;
    }
    const store = await readSavesStore();
    const { lastSaveAction } = await chrome.storage.local.get('lastSaveAction');
    const lastSaved = store.saves.find(s => s.id === store.lastSavedId) || null;

    saveDialogState.windows = windows;
    saveDialogState.defaultName = defaultName || '';
    document.getElementById('save-dialog-title').textContent =
        windows.length === 1 ? 'Save window internally' : 'Save session internally';
    document.getElementById('save-summary').textContent =
        `${windows.length} window${windows.length === 1 ? '' : 's'}, ${countTabs(windows)} tab(s)`;

    // Start where you last saved; pre-select the last save if you last replaced one.
    const nameInput = document.getElementById('save-name');
    nameInput.value = lastSaveAction === 'overwrite' && lastSaved ? lastSaved.name : saveDialogState.defaultName;
    const startFolder = lastSaved ? lastSaved.folder : (store.folders.includes(lastSaveFolder) ? lastSaveFolder : '');

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
    let action;
    if (existing) {
        const where = folder ? `"${folder}"` : 'the top level';
        if (!confirm(`"${name}" already exists in ${where}.\nDo you want to replace it?`)) return;
        existing.windows = windows;
        existing.at = Date.now();
        store.lastSavedId = existing.id;
        action = 'overwrite';
    } else {
        const id = newSaveId();
        store.saves.push({ id, name, folder, at: Date.now(), windows });
        store.lastSavedId = id;
        action = 'new';
    }
    await writeSavesStore(store);
    await chrome.storage.local.set({ lastSaveAction: action });
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
