// Named internal saves, organised in folders (board page only).
//
// Storage: chrome.storage.local "internalSaves" =
//   { folders: ["Work", "Work/Research", ...],
//     saves: [{ id, name, folder, at, windows }] }
// `folder` is a "/"-separated path; "" is the top level. `windows` uses the
// same layout format as JSON files (serializeTabGroups in shared.js), so a
// save can be exported and later loaded with Upload JSON.
//
// The two autosave slots written by background.js are shown read-only in a
// virtual "Autosaves" folder.
//
// Uses from main.js: serializeGroups, restoreState, downloadJson, isBoardTab.

const AUTOSAVE_FOLDER = '\u0000autosaves'; // virtual folder id (can't clash with a real name)
const AUTOSAVE_SLOTS = [
    { name: 'Autosave', dataKey: 'autoSave', timeKey: 'autoSavedAt' },
    { name: 'Autosave from previous browser session', dataKey: 'autoSavePrev', timeKey: 'autoSavePrevAt' },
];

let savesBrowserFolder = '';   // folder currently open in the Load dialog
let lastSaveFolder = '';       // folder last saved into (default for the next save)

/* ---------------- storage ---------------- */

async function readSavesStore() {
    const { internalSaves, savedState, savedAt } = await chrome.storage.local.get(['internalSaves', 'savedState', 'savedAt']);
    const store = internalSaves && Array.isArray(internalSaves.saves)
        ? internalSaves
        : { folders: [], saves: [] };
    if (!Array.isArray(store.folders)) store.folders = [];
    // One-time migration of the old single Ctrl+S slot.
    if (Array.isArray(savedState) && savedState.length) {
        store.saves.push({ id: newSaveId(), name: 'Manual save', folder: '', at: savedAt || Date.now(), windows: savedState });
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

/* ---------------- Save dialog ---------------- */

// Ask for a name and folder, then store `windows` as a named save.
async function openSaveDialog(windows, defaultName) {
    if (!windows || !windows.length) {
        alert('Nothing to save.');
        return;
    }
    const store = await readSavesStore();
    const dialog = document.getElementById('save-dialog');
    const nameInput = document.getElementById('save-name');
    const folderSelect = document.getElementById('save-folder');
    const summary = document.getElementById('save-summary');

    document.getElementById('save-dialog-title').textContent =
        windows.length === 1 ? 'Save window internally' : 'Save session internally';
    summary.textContent = `${windows.length} window${windows.length === 1 ? '' : 's'}, ${countTabs(windows)} tab(s)`;
    nameInput.value = defaultName || '';

    folderSelect.replaceChildren();
    const folders = ['', ...[...store.folders].sort((a, b) => a.localeCompare(b))];
    for (const f of folders) {
        const opt = document.createElement('option');
        opt.value = f;
        const depth = f === '' ? 0 : f.split('/').length;
        opt.textContent = '  '.repeat(depth) + (f === '' ? '/ (top level)' : '📁 ' + f.split('/').pop());
        folderSelect.appendChild(opt);
    }
    folderSelect.value = store.folders.includes(lastSaveFolder) ? lastSaveFolder : '';

    dialog.onclose = null;
    dialog._pendingWindows = windows;
    dialog.showModal();
    nameInput.select();
}

async function submitSaveDialog() {
    const dialog = document.getElementById('save-dialog');
    const name = document.getElementById('save-name').value.trim();
    const folder = document.getElementById('save-folder').value;
    const windows = dialog._pendingWindows;
    if (!name) {
        document.getElementById('save-name').focus();
        return;
    }
    const store = await readSavesStore();
    const existing = store.saves.find(s => s.folder === folder && s.name === name);
    if (existing) {
        const where = folder ? `"${folder}"` : 'the top level';
        if (!confirm(`A save named "${name}" already exists in ${where}. Replace it?`)) return;
        existing.windows = windows;
        existing.at = Date.now();
    } else {
        store.saves.push({ id: newSaveId(), name, folder, at: Date.now(), windows });
    }
    await writeSavesStore(store);
    lastSaveFolder = folder;
    dialog._pendingWindows = null;
    dialog.close();
}

/* ---------------- Load dialog (saves browser) ---------------- */

async function openLoadDialog() {
    const dialog = document.getElementById('load-dialog');
    document.getElementById('saves-search').value = '';
    if (!dialog.open) dialog.showModal();
    await renderSavesBrowser();
    document.getElementById('saves-search').focus();
}

async function getAutosaves() {
    const keys = AUTOSAVE_SLOTS.flatMap(s => [s.dataKey, s.timeKey]);
    const result = await chrome.storage.local.get(keys);
    return AUTOSAVE_SLOTS
        .filter(s => Array.isArray(result[s.dataKey]) && result[s.dataKey].length)
        .map(s => ({ id: s.dataKey, name: s.name, folder: AUTOSAVE_FOLDER, at: result[s.timeKey], windows: result[s.dataKey], readOnly: true }));
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

function renderPathBar(container, folder) {
    container.replaceChildren();
    const parts = [];
    if (folder === AUTOSAVE_FOLDER) {
        parts.push(['Top level', ''], ['Autosaves', AUTOSAVE_FOLDER]);
    } else {
        parts.push(['Top level', '']);
        let acc = '';
        for (const seg of folder ? folder.split('/') : []) {
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
        crumb.addEventListener('click', () => { savesBrowserFolder = path; renderSavesBrowser(); });
        container.appendChild(crumb);
    });
}

function folderRow(label, path, meta, onDelete) {
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
        document.getElementById('saves-search').value = ''; // opening a folder leaves search
        savesBrowserFolder = path;
        renderSavesBrowser();
    });
    return row;
}

function saveRow(save, { showFolder = false, matchNote = '' } = {}) {
    const row = document.createElement('div');
    row.className = 'load-slot';
    const info = document.createElement('div');
    info.className = 'load-slot-info';
    const name = document.createElement('b');
    name.textContent = save.name;
    const meta = document.createElement('div');
    meta.className = 'load-slot-meta';
    const where = save.folder === AUTOSAVE_FOLDER ? 'Autosaves' : (save.folder || '/');
    meta.textContent = (showFolder ? `📁 ${where} · ` : '') + describeSave(save);
    info.append(name, meta);
    if (matchNote) {
        const note = document.createElement('div');
        note.className = 'load-slot-match';
        note.textContent = matchNote;
        info.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'load-slot-actions';
    actions.append(
        makeButton('Load', 'Replace all open tabs with this save', () => loadSave(save, true)),
        makeButton('Add', 'Open this save alongside your current tabs', () => loadSave(save, false)),
        makeButton('Export JSON', 'Download this save as a .json file (loadable with Upload JSON)', () => exportSave(save)),
    );
    if (!save.readOnly) {
        actions.appendChild(makeButton('Delete', 'Delete this save', () => deleteSave(save), 'danger-btn'));
    }
    row.append(info, actions);
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

async function renderSavesBrowser() {
    const store = await readSavesStore();
    const autosaves = await getAutosaves();
    const list = document.getElementById('saves-list');
    const pathBar = document.getElementById('saves-path');
    const newFolderBtn = document.getElementById('new-folder-btn');
    const q = document.getElementById('saves-search').value.trim().toLowerCase();
    list.replaceChildren();

    // The folder we were in may have been deleted.
    if (savesBrowserFolder !== AUTOSAVE_FOLDER && savesBrowserFolder !== '' && !store.folders.includes(savesBrowserFolder)) {
        savesBrowserFolder = '';
    }

    if (q) {
        // Search: flat results from every folder (and autosaves).
        pathBar.textContent = `Search results for "${q}"`;
        newFolderBtn.disabled = true;
        const results = [...store.saves, ...autosaves]
            .map(s => ({ s, m: searchMatch(s, q) }))
            .filter(r => r.m.hit)
            .sort((a, b) => (b.s.at || 0) - (a.s.at || 0));
        const folderHits = store.folders.filter(f => f.split('/').pop().toLowerCase().includes(q));
        for (const f of folderHits) list.appendChild(folderRow(f, f, 'folder', null));
        for (const { s, m } of results) list.appendChild(saveRow(s, { showFolder: true, matchNote: m.note }));
        if (!results.length && !folderHits.length) emptyNote(list, 'No saves match.');
        return;
    }

    renderPathBar(pathBar, savesBrowserFolder);

    if (savesBrowserFolder === AUTOSAVE_FOLDER) {
        newFolderBtn.disabled = true;
        for (const s of autosaves) list.appendChild(saveRow(s));
        if (!autosaves.length) emptyNote(list, 'No autosaves yet. Turn on the autosave checkbox on the board.');
        return;
    }

    newFolderBtn.disabled = false;
    if (savesBrowserFolder === '' && autosaves.length) {
        list.appendChild(folderRow('Autosaves', AUTOSAVE_FOLDER, `${autosaves.length} autosave(s) · read-only`, null));
    }
    for (const f of childFolders(store, savesBrowserFolder)) {
        const saves = store.saves.filter(s => isInFolderTree(s.folder, f)).length;
        const subs = store.folders.filter(x => x !== f && isInFolderTree(x, f)).length;
        list.appendChild(folderRow(f.split('/').pop(), f,
            `${saves} save(s)${subs ? `, ${subs} subfolder(s)` : ''}`,
            () => deleteFolder(f)));
    }
    const here = store.saves.filter(s => s.folder === savesBrowserFolder).sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const s of here) list.appendChild(saveRow(s));
    if (!list.children.length) emptyNote(list, savesBrowserFolder ? 'This folder is empty.' : "No internal saves yet. Use 'Save (Internal)' or Ctrl+S.");
}

function emptyNote(list, text) {
    const p = document.createElement('p');
    p.className = 'load-slot-meta';
    p.textContent = text;
    list.appendChild(p);
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

async function deleteSave(save) {
    if (!confirm(`Delete the save "${save.name}"? This can't be undone.`)) return;
    const store = await readSavesStore();
    store.saves = store.saves.filter(s => s.id !== save.id);
    await writeSavesStore(store);
    renderSavesBrowser();
}

async function deleteFolder(path) {
    const store = await readSavesStore();
    const saves = store.saves.filter(s => isInFolderTree(s.folder, path)).length;
    const subs = store.folders.filter(f => f !== path && isInFolderTree(f, path)).length;
    const contents = saves || subs
        ? ` It contains ${saves} save(s)${subs ? ` and ${subs} subfolder(s)` : ''}, which will also be deleted.`
        : '';
    if (!confirm(`Delete the folder "${path}"?${contents} This can't be undone.`)) return;
    store.folders = store.folders.filter(f => !isInFolderTree(f, path));
    store.saves = store.saves.filter(s => !isInFolderTree(s.folder, path));
    await writeSavesStore(store);
    if (isInFolderTree(savesBrowserFolder, path)) savesBrowserFolder = parentFolder(path);
    if (isInFolderTree(lastSaveFolder, path)) lastSaveFolder = '';
    renderSavesBrowser();
}

async function createFolder() {
    if (savesBrowserFolder === AUTOSAVE_FOLDER) return;
    const raw = prompt(`New folder in ${savesBrowserFolder ? `"${savesBrowserFolder}"` : 'the top level'}:`);
    if (raw == null) return;
    const name = raw.trim().replace(/\//g, '-');
    if (!name) return;
    const path = savesBrowserFolder ? `${savesBrowserFolder}/${name}` : name;
    const store = await readSavesStore();
    if (store.folders.includes(path)) {
        alert(`A folder named "${name}" already exists here.`);
        return;
    }
    store.folders.push(path);
    await writeSavesStore(store);
    renderSavesBrowser();
}

/* ---------------- wiring ---------------- */

document.getElementById('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitSaveDialog();
});
document.getElementById('save-dialog-cancel').addEventListener('click', () => {
    document.getElementById('save-dialog').close();
});
document.getElementById('load-dialog-cancel').addEventListener('click', () => {
    document.getElementById('load-dialog').close();
});
document.getElementById('new-folder-btn').addEventListener('click', createFolder);
document.getElementById('saves-search').addEventListener('input', () => renderSavesBrowser());
