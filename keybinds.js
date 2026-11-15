// Keybinds page (keybinds.html), opened from the board's Settings > Keybinds….
// Lists every changeable action from keybinds-core.js by group, lets you add
// (record) and remove keys per action, reset one action or all of them, and
// warns about keys used twice. Writes chrome.storage.local "keybinds" (only
// actions that differ from their defaults); every other page picks the change
// up through Keybinds.watch.
// Also shows the browser shortcuts (manifest "commands", read-only: only the
// browser can change them) and the fixed mouse controls.

const KEY = Keybinds.STORAGE_KEY;
const GROUPS = [
    ['Board', 'On the Reflection Board. Keys without Ctrl/Alt are ignored while you type in a text box.'],
    ['Any page', 'On every web page and on the board. Must include Ctrl or Alt, so typing on web pages is never taken over.'],
    ['Tab switcher', 'While the tab switcher is open (it captures all keys until it closes).'],
];
const MOUSE = [
    ['Select a tab', 'Click'],
    ['Add / remove a tab from the selection', 'Ctrl+click'],
    ['Select a range of tabs', 'Shift+click'],
    ['Select all tabs of a window', 'Click the window box\'s empty space'],
    ['Minimize / expand a window box', 'Double-click the window box\'s empty space'],
    ['Go to a tab', 'Right-click it'],
    ['Move tabs / windows', 'Drag'],
];

let stored = {};                 // overrides as saved
let map = Keybinds.resolve({});  // effective keys
let capturing = null;            // action id being recorded
let rowError = null;             // { id, text } shown under that row
let browserShortcuts = [];       // [{ name, description, combo }] from chrome.commands

/* ---------------- storage ---------------- */

async function reload() {
    const result = await chrome.storage.local.get(KEY);
    stored = result[KEY] && typeof result[KEY] === 'object' ? result[KEY] : {};
    map = Keybinds.resolve(stored);
    render();
}

function setCombos(id, combos) {
    const defaults = Keybinds.byId[id].defaults;
    const same = combos.length === defaults.length && combos.every((c, i) => c === defaults[i]);
    const next = { ...stored };
    if (same) delete next[id];
    else next[id] = combos;
    stored = next;
    map = Keybinds.resolve(stored);
    chrome.storage.local.set({ [KEY]: next });
    flashStatus('Saved.');
    render();
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) reload(); // e.g. changed in another keybinds tab
});

/* ---------------- conflicts ---------------- */

// Board keys and "any page" keys are both live on the board; switcher keys
// only while the switcher is open.
function scopesOverlap(a, b) {
    if (a === b) return true;
    return (a === 'board' && b === 'page') || (a === 'page' && b === 'board');
}

function conflictsFor(id, combo) {
    const me = Keybinds.byId[id];
    const out = Keybinds.ACTIONS
        .filter(a => a.id !== id && scopesOverlap(a.scope, me.scope) && (map[a.id] || []).includes(combo))
        .map(a => `"${a.label}"`);
    const browser = browserShortcuts.find(s => s.combo === combo);
    if (browser && me.scope !== 'switcher') out.push(`the browser shortcut "${browser.description}" (that one wins)`);
    return out;
}

// Chrome writes shortcuts like "Alt+Shift+Left"; ours say "ArrowLeft".
function normalizeBrowserShortcut(s) {
    if (!s) return '';
    const names = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Command: 'Meta', MacCtrl: 'Ctrl' };
    return s.split('+').map(p => names[p] || (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

/* ---------------- rendering ---------------- */

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node[k] = v;
    }
    node.append(...children.filter(c => c != null));
    return node;
}

function button(label, onclick, cls = 'state-btn small-btn') {
    return el('button', { type: 'button', class: cls, textContent: label, onclick });
}

function render() {
    const root = document.getElementById('kb-sections');
    root.replaceChildren();
    for (const [group, scopeText] of GROUPS) {
        const table = el('table', { class: 'kb-table' });
        for (const action of Keybinds.ACTIONS.filter(a => a.group === group)) table.appendChild(actionRow(action));
        root.append(el('h3', { textContent: group }), el('p', { class: 'kb-scope', textContent: scopeText }), table);
    }
}

function actionRow(action) {
    const combos = map[action.id] || [];
    const comboBox = el('div', { class: 'kb-combos' });
    for (const combo of combos) {
        comboBox.appendChild(el('span', { class: 'kb-combo' },
            Keybinds.format(combo),
            el('button', {
                type: 'button', textContent: '×', title: 'Remove this key',
                onclick: () => setCombos(action.id, combos.filter(c => c !== combo)),
            })));
    }
    if (capturing === action.id) {
        comboBox.appendChild(el('span', { class: 'kb-capturing', textContent: 'Press a key combination…' }));
    } else if (!combos.length) {
        comboBox.appendChild(el('span', { class: 'kb-none', textContent: 'no key' }));
    }

    const notes = el('div');
    for (const combo of combos) {
        const clash = conflictsFor(action.id, combo);
        if (clash.length) {
            notes.appendChild(el('div', { class: 'kb-warning', textContent: `${Keybinds.format(combo)} is also used by ${clash.join(' and ')}.` }));
        }
    }
    if (rowError && rowError.id === action.id) notes.appendChild(el('div', { class: 'kb-error', textContent: rowError.text }));

    const isDefault = !(action.id in stored);
    const actions = el('td', { class: 'kb-actions' },
        capturing === action.id
            ? button('Cancel', () => stopCapture())
            : button('Add key', () => startCapture(action.id)),
        Object.assign(button('Reset', () => setCombos(action.id, [...action.defaults])), {
            disabled: isDefault,
            title: `Default: ${action.defaults.length ? action.defaults.map(Keybinds.format).join(' / ') : 'no key'}`,
        }));

    return el('tr', {},
        el('td', { class: 'kb-label', textContent: action.label }),
        el('td', {}, comboBox, notes),
        actions);
}

/* ---------------- recording a key ---------------- */

function startCapture(id) {
    capturing = id;
    rowError = null;
    render();
}

function stopCapture() {
    capturing = null;
    render();
}

// Capture phase on window so the key is recorded before anything else sees it.
window.addEventListener('keydown', (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const combo = Keybinds.comboFromEvent(e);
    if (!combo) return; // just a modifier so far
    const action = Keybinds.byId[capturing];
    if (action.scope === 'page' && !Keybinds.hasCommandModifier(combo)) {
        rowError = { id: action.id, text: `${Keybinds.format(combo)} can't be used here: keys for every page need Ctrl or Alt. Try again, or Cancel.` };
        render();
        return;
    }
    const combos = map[action.id] || [];
    capturing = null;
    rowError = null;
    if (combos.includes(combo)) render();
    else setCombos(action.id, [...combos, combo]);
}, true);

// Leaving the page (or clicking outside the row) stops recording.
window.addEventListener('blur', () => { if (capturing) stopCapture(); });
document.addEventListener('mousedown', (e) => {
    if (capturing && !e.target.closest('.kb-actions')) stopCapture();
});

/* ---------------- browser shortcuts, mouse, reset ---------------- */

async function renderBrowserShortcuts() {
    const table = document.getElementById('kb-commands');
    table.replaceChildren();
    let commands = [];
    try { commands = await chrome.commands.getAll(); } catch (e) { /* not available */ }
    browserShortcuts = commands.map(c => ({ name: c.name, description: c.description || c.name, combo: normalizeBrowserShortcut(c.shortcut) }));
    for (const c of commands) {
        const keys = c.shortcut
            ? el('span', { class: 'kb-combo', textContent: Keybinds.format(normalizeBrowserShortcut(c.shortcut)) })
            : el('span', { class: 'kb-none', textContent: 'not set' });
        table.appendChild(el('tr', {},
            el('td', { class: 'kb-label', textContent: c.description || c.name }),
            el('td', {}, el('div', { class: 'kb-combos' }, keys)),
            el('td', { class: 'kb-actions' })));
    }
    render(); // conflicts with browser shortcuts can be shown now
}

function renderMouse() {
    const table = document.getElementById('kb-mouse');
    for (const [label, how] of MOUSE) {
        table.appendChild(el('tr', {},
            el('td', { class: 'kb-label', textContent: label }),
            el('td', {}, el('div', { class: 'kb-combos' }, el('span', { class: 'kb-combo', textContent: how, style: 'padding-right:10px' }))),
            el('td', { class: 'kb-actions' })));
    }
}

let statusTimer = null;
function flashStatus(text) {
    const status = document.getElementById('kb-status');
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 2000);
}

document.getElementById('kb-open-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

document.getElementById('kb-reset-all').addEventListener('click', async () => {
    if (!confirm('Reset every keybind to its default?')) return;
    capturing = null;
    rowError = null;
    await chrome.storage.local.remove(KEY);
    flashStatus('All keybinds reset.');
    reload();
});

// Shortcut changes made on the browser's page show up when you come back.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderBrowserShortcuts();
});

renderMouse();
reload();
renderBrowserShortcuts();
