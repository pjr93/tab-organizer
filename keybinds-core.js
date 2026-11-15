// Changeable keyboard shortcuts, shared by every place that handles keys:
// the board (app.html), the keybinds page (keybinds.html), the tab switcher
// window (switcher.html) and the in-page switcher overlay
// (switcher-overlay.js, a content script). Loaded before those scripts.
//
// Storage: chrome.storage.local "keybinds" = { actionId: ["Ctrl+S", ...] },
// holding only actions changed from their defaults (an empty list means the
// action has no key). Every context listens for changes, so edits on the
// keybinds page apply everywhere at once.
//
// A combo is "Ctrl+Alt+Shift+Meta+Key" (modifiers in that order, only those
// held). Letters and digits use the physical key (e.code), so Shift+1 is
// "Shift+1", not "Shift+!"; other keys use e.key ("ArrowUp", "Delete", "/").
//
// The browser shortcuts in manifest.json "commands" (Alt+Shift+Q, ...) aren't
// here: only the browser can change those (chrome://extensions/shortcuts).
//
// Written so it can be loaded more than once into the same page (the
// overlay is injected again by background.js when needed).
globalThis.Keybinds = globalThis.Keybinds || (() => {
    // scope: where the key works. "board" = on the board page (skipped while
    // typing in a text box unless it has Ctrl/Alt/Meta); "page" = on every web
    // page and the board (must have Ctrl or Alt, so typing is never taken
    // over); "switcher" = while the tab switcher is open (it captures all keys).
    const ACTIONS = [
        { id: 'saveSession', scope: 'board', group: 'Board', label: 'Save session internally', defaults: ['Ctrl+S', 'Meta+S'] },
        { id: 'closeSelected', scope: 'board', group: 'Board', label: 'Close selected tabs', defaults: ['Delete'] },
        { id: 'clearSelection', scope: 'board', group: 'Board', label: 'Clear selection', defaults: ['Escape'] },
        { id: 'minimizeAll', scope: 'board', group: 'Board', label: 'Minimize / expand all windows', defaults: [] },
        { id: 'loadAll', scope: 'board', group: 'Board', label: 'Load all tabs', defaults: [] },
        { id: 'pauseAll', scope: 'board', group: 'Board', label: 'Pause all media', defaults: [] },
        { id: 'switcherOpenOlder', scope: 'page', group: 'Any page', label: 'Open tab switcher on an older tab', defaults: ['Alt+Shift+ArrowDown'] },
        { id: 'switcherOpenNewer', scope: 'page', group: 'Any page', label: 'Open tab switcher on a newer tab', defaults: ['Alt+Shift+ArrowUp'] },
        { id: 'switcherOlder', scope: 'switcher', group: 'Tab switcher', label: 'Move to an older tab', defaults: ['ArrowLeft', 'ArrowDown'] },
        { id: 'switcherNewer', scope: 'switcher', group: 'Tab switcher', label: 'Move to a newer tab', defaults: ['ArrowRight', 'ArrowUp'] },
        { id: 'switcherCommit', scope: 'switcher', group: 'Tab switcher', label: 'Switch to the highlighted tab', defaults: ['Enter'] },
        { id: 'switcherCancel', scope: 'switcher', group: 'Tab switcher', label: 'Cancel', defaults: ['Escape'] },
    ];
    const STORAGE_KEY = 'keybinds';
    const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
    const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Dead', 'Unidentified', 'Process'];

    function keyName(e) {
        if (!e.key || MODIFIER_KEYS.includes(e.key)) return null;
        if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
        if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
        if (e.key === ' ') return 'Space';
        return e.key.length === 1 ? e.key.toUpperCase() : e.key;
    }

    // The combo for a keydown, or null for a lone modifier.
    function comboFromEvent(e) {
        const key = keyName(e);
        if (!key) return null;
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        parts.push(key);
        return parts.join('+');
    }

    function hasCommandModifier(combo) {
        return /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);
    }

    // Full map { actionId: [combos] } from the stored overrides.
    function resolve(stored) {
        const map = {};
        for (const a of ACTIONS) {
            const own = stored && Array.isArray(stored[a.id]) ? stored[a.id] : null;
            map[a.id] = own ? own.filter(c => typeof c === 'string') : [...a.defaults];
        }
        return map;
    }

    async function load() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            return resolve(result[STORAGE_KEY]);
        } catch (e) {
            return resolve({});
        }
    }

    // Calls cb(map) now (once loaded) and whenever the keybinds change.
    function watch(cb) {
        load().then(cb);
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[STORAGE_KEY]) cb(resolve(changes[STORAGE_KEY].newValue));
            });
        } catch (e) { /* extension context gone */ }
    }

    // Which of `ids` (in order) this keydown triggers, or null.
    function actionFor(e, map, ids) {
        const combo = comboFromEvent(e);
        if (!combo) return null;
        for (const id of ids) if ((map[id] || []).includes(combo)) return id;
        return null;
    }

    const KEY_LABELS = {
        ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
        Escape: 'Esc', Delete: 'Del', Meta: '⌘/Win', ' ': 'Space',
    };
    function format(combo) {
        return combo.split('+').map(p => KEY_LABELS[p] || p).join('+');
    }

    // "Ctrl+S / ⌘/Win+S", or `none` if the action has no key.
    function describe(map, id, none = 'not set') {
        const combos = map[id] || [];
        return combos.length ? combos.map(format).join(' / ') : none;
    }

    return {
        ACTIONS, STORAGE_KEY, byId,
        comboFromEvent, hasCommandModifier, resolve, load, watch, actionFor, format, describe,
        idsFor: (scope) => ACTIONS.filter(a => a.scope === scope).map(a => a.id),
    };
})();
