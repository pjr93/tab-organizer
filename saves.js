// Named internal saves, organised in folders (board page only).
//
// Storage: chrome.storage.local "internalSaves" =
//   { folders: ["Work", "Work/Research", ...],
//     saves: [{ id, name, folder, at, windows }],
//     lastSavedId }                 // save most recently created or overwritten
// and "saveDialogMode": "new" | "overwrite" (last choice in the save dialog).
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

// The save to suggest for "Overwrite": the one most recently saved or
// overwritten, else the newest one.
function defaultOverwriteTarget(store) {
    return store.saves.find(s => s.id === store.lastSavedId)
        || [...store.saves].sort((a, b) => (b.at || 0) - (a.at || 0))[0]
        || null;
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

/* ---------------- saves browser (shared by Load and the Overwrite picker) ---------------- */
//
// mode "manage": rows have Load / Add / Export JSON / Delete, folders can be
//                created and deleted, autosaves are shown.
// mode "pick":   clicking a save selects it (onPick); no actions, no
//                autosaves (they can't be overwritten).

function createSavesBrowser({ listEl, pathEl, searchEl, newFolderBtn = null, mode, onPick = null }) {
    const b = { folder: '', selectedId: null, listEl, pathEl, searchEl, newFolderBtn, mode, onPick };
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
        if (save.id === b.selectedId) row.classList.add('picked');
        row.title = 'Overwrite this save';
        row.addEventListener('click', () => {
            b.selectedId = save.id;
            if (b.onPick) b.onPick(save);
            b.render();
        });
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
    const store = await readSavesStore();
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

/* ---------------- Save dialog (New / Overwrite) ---------------- */

const saveDialogState = { windows: null, mode: 'new', target: null };

const pickBrowser = createSavesBrowser({
    listEl: document.getElementById('pick-list'),
    pathEl: document.getElementById('pick-path'),
    searchEl: document.getElementById('pick-search'),
    mode: 'pick',
    onPick: (save) => { saveDialogState.target = save; updateSaveDialog(); },
});

// Ask whether to create a new save (name + folder) or overwrite an existing
// one, then store `windows`. The New/Overwrite choice is remembered.
async function openSaveDialog(windows, defaultName) {
    if (!windows || !windows.length) {
        alert('Nothing to save.');
        return;
    }
    const store = await readSavesStore();
    const { saveDialogMode } = await chrome.storage.local.get('saveDialogMode');
    const dialog = document.getElementById('save-dialog');

    saveDialogState.windows = windows;
    saveDialogState.target = defaultOverwriteTarget(store);
    saveDialogState.mode = saveDialogMode === 'overwrite' && saveDialogState.target ? 'overwrite' : 'new';

    document.getElementById('save-dialog-title').textContent =
        windows.length === 1 ? 'Save window internally' : 'Save session internally';
    document.getElementById('save-summary').textContent =
        `${windows.length} window${windows.length === 1 ? '' : 's'}, ${countTabs(windows)} tab(s)`;

    // New: default name and folder list.
    document.getElementById('save-name').value = defaultName || '';
    const folderSelect = document.getElementById('save-folder');
    folderSelect.replaceChildren();
    for (const f of ['', ...[...store.folders].sort((a, c) => a.localeCompare(c))]) {
        const opt = document.createElement('option');
        opt.value = f;
        const depth = f === '' ? 0 : f.split('/').length;
        opt.textContent = '  '.repeat(depth) + (f === '' ? '/ (top level)' : '📁 ' + f.split('/').pop());
        folderSelect.appendChild(opt);
    }
    folderSelect.value = store.folders.includes(lastSaveFolder) ? lastSaveFolder : '';

    // Overwrite: picker opens at the default target's folder.
    const overwriteRadio = document.getElementById('save-mode-overwrite');
    overwriteRadio.disabled = !saveDialogState.target;
    pickBrowser.selectedId = saveDialogState.target ? saveDialogState.target.id : null;
    await pickBrowser.openAt(saveDialogState.target ? saveDialogState.target.folder : '');

    document.getElementById(saveDialogState.mode === 'overwrite' ? 'save-mode-overwrite' : 'save-mode-new').checked = true;
    updateSaveDialog();
    dialog.showModal();
    if (saveDialogState.mode === 'new') document.getElementById('save-name').select();
}

function updateSaveDialog() {
    const overwrite = saveDialogState.mode === 'overwrite';
    document.getElementById('save-new-fields').hidden = overwrite;
    document.getElementById('save-overwrite-fields').hidden = !overwrite;
    document.getElementById('save-name').required = !overwrite;
    const target = saveDialogState.target;
    const targetEl = document.getElementById('overwrite-target');
    targetEl.replaceChildren();
    if (target) {
        const name = document.createElement('b');
        name.textContent = target.name;
        targetEl.append('Overwriting ', name, ` in 📁 ${folderDisplay(target.folder)} (saved ${describeSave(target)})`);
    } else {
        targetEl.textContent = 'Pick a save to overwrite.';
    }
    const submit = document.getElementById('save-submit');
    submit.textContent = overwrite ? (target ? `Overwrite "${target.name}"` : 'Overwrite') : 'Save';
    submit.disabled = overwrite && !target;
}

async function submitSaveDialog() {
    const dialog = document.getElementById('save-dialog');
    const windows = saveDialogState.windows;
    const store = await readSavesStore();

    if (saveDialogState.mode === 'overwrite') {
        const target = saveDialogState.target && store.saves.find(s => s.id === saveDialogState.target.id);
        if (!target) {
            alert('That save no longer exists. Pick another one.');
            return;
        }
        target.windows = windows;
        target.at = Date.now();
        store.lastSavedId = target.id;
    } else {
        const name = document.getElementById('save-name').value.trim();
        const folder = document.getElementById('save-folder').value;
        if (!name) {
            document.getElementById('save-name').focus();
            return;
        }
        const existing = store.saves.find(s => s.folder === folder && s.name === name);
        if (existing) {
            const where = folder ? `"${folder}"` : 'the top level';
            if (!confirm(`A save named "${name}" already exists in ${where}. Replace it?`)) return;
            existing.windows = windows;
            existing.at = Date.now();
            store.lastSavedId = existing.id;
        } else {
            const id = newSaveId();
            store.saves.push({ id, name, folder, at: Date.now(), windows });
            store.lastSavedId = id;
        }
        lastSaveFolder = folder;
    }
    await writeSavesStore(store);
    await chrome.storage.local.set({ saveDialogMode: saveDialogState.mode });
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

async function createFolder(b) {
    if (b.folder === AUTOSAVE_FOLDER) return;
    const raw = prompt(`New folder in ${b.folder ? `"${b.folder}"` : 'the top level'}:`);
    if (raw == null) return;
    const name = raw.trim().replace(/\//g, '-');
    if (!name) return;
    const path = b.folder ? `${b.folder}/${name}` : name;
    const store = await readSavesStore();
    if (store.folders.includes(path)) {
        alert(`A folder named "${name}" already exists here.`);
        return;
    }
    store.folders.push(path);
    await writeSavesStore(store);
    b.render();
}

/* ---------------- wiring ---------------- */

document.getElementById('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitSaveDialog();
});
for (const id of ['save-mode-new', 'save-mode-overwrite']) {
    document.getElementById(id).addEventListener('change', (e) => {
        if (!e.target.checked) return;
        saveDialogState.mode = e.target.value;
        updateSaveDialog();
        if (saveDialogState.mode === 'new') document.getElementById('save-name').select();
    });
}
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
