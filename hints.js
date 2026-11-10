// Hover hints for the board: what buttons do and the board's own mouse/keyboard
// shortcuts (the global hotkeys live in chrome://extensions/shortcuts).
//
// Hints are shown as one line of text next to the "Reflection Board" heading,
// so they never cover anything. Hovering any element with data-hint (or a
// title attribute, converted on first hover so the browser's own tooltip
// doesn't also show) puts its hint there; tabs show the tab shortcuts.
// A hint stays up for the "hint seconds" setting, counted from when it
// appears (0 = it stays until the next hint replaces it). The "hints"
// checkbox turns them off.
// Once the heading row is scrolled even partly out of view, the line floats at
// the top of the window; it goes back when the whole row is visible again.
// Inside dialogs the heading is hidden behind the backdrop, so elements there
// keep the browser's normal tooltip.

const DEFAULT_HINT_SECONDS = 4;
let hintPersistMs = DEFAULT_HINT_SECONDS * 1000;
let hintsEnabled = true;

const TAB_HINT = 'Tab: Click to select · Ctrl+click to add/remove · Shift+click for a range · ' +
    'Right-click to go to the tab · Drag to move (off the board for a new window) · ' +
    'Delete closes selected · Esc clears selection';

const hintLine = document.getElementById('hint-line');
const boardHeader = document.querySelector('.board-header');
let hintTarget = null;
let hintClearTimer = null;

// The hint for whatever the pointer is over, or null.
function hintFor(node) {
    const el = node && node.closest ? node.closest('[data-hint], [title], .grid-item') : null;
    if (!el || el.closest('dialog')) return null;
    if (el.hasAttribute('title')) {
        if (el.title) el.dataset.hint = el.title;
        el.removeAttribute('title');
    }
    if (el.classList.contains('grid-item')) return { el, text: TAB_HINT };
    return el.dataset.hint ? { el, text: el.dataset.hint } : null;
}

function clearHint() {
    hintLine.classList.remove('visible');
}

document.addEventListener('mouseover', (e) => {
    if (!hintsEnabled) return;
    const hint = hintFor(e.target);
    const el = hint ? hint.el : null;
    if (el === hintTarget) return;
    hintTarget = el;
    if (!hint) return; // the last hint keeps its own timer
    hintLine.textContent = hint.text;
    hintLine.classList.add('visible');
    clearTimeout(hintClearTimer);
    if (hintPersistMs > 0) hintClearTimer = setTimeout(clearHint, hintPersistMs);
});

// "hints" setting (on by default).
const hintsCheckbox = document.getElementById('hints-enabled');
chrome.storage.local.get(['hintsEnabled'], (result) => {
    hintsEnabled = result.hintsEnabled !== false;
    hintsCheckbox.checked = hintsEnabled;
});
hintsCheckbox.addEventListener('change', () => {
    hintsEnabled = hintsCheckbox.checked;
    hintTarget = null;
    if (!hintsEnabled) { clearTimeout(hintClearTimer); clearHint(); }
    chrome.storage.local.set({ hintsEnabled });
});

// Float at the top while the heading row isn't fully in view.
function updateHintFloat() {
    const rect = boardHeader.getBoundingClientRect();
    const floating = rect.top < 0;
    hintLine.classList.toggle('floating', floating);
    // Same left edge as at home (right of the heading); as wide as the text
    // needs, up to the window's right edge, wrapping beyond that.
    if (floating) {
        const left = boardHeader.querySelector('h2').getBoundingClientRect().right + 16;
        hintLine.style.left = `${left}px`;
        hintLine.style.maxWidth = `${Math.max(200, window.innerWidth - left - 16)}px`;
    } else {
        hintLine.style.left = hintLine.style.maxWidth = '';
    }
}
window.addEventListener('scroll', updateHintFloat, { passive: true });
window.addEventListener('resize', updateHintFloat);
updateHintFloat();

// "hint seconds" setting, kept in storage so it survives restarts.
const hintSecondsInput = document.getElementById('hint-seconds');
function setHintSeconds(value) {
    const seconds = Number(value);
    hintPersistMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_HINT_SECONDS * 1000;
}
chrome.storage.local.get(['hintSeconds'], ({ hintSeconds }) => {
    if (hintSeconds == null) hintSeconds = DEFAULT_HINT_SECONDS;
    setHintSeconds(hintSeconds);
    hintSecondsInput.value = hintSeconds;
});
// 'input' applies it while typing or using the arrows; 'change' (on leaving
// the field) also tidies up an empty or invalid entry.
function saveHintSeconds(tidy) {
    let seconds = Number(hintSecondsInput.value);
    const valid = hintSecondsInput.value !== '' && Number.isFinite(seconds) && seconds >= 0;
    if (!valid) {
        if (!tidy) return;
        seconds = DEFAULT_HINT_SECONDS;
        hintSecondsInput.value = seconds;
    }
    setHintSeconds(seconds);
    chrome.storage.local.set({ hintSeconds: seconds });
    // Restart the current hint's timer with the new time (0 = keep it up).
    clearTimeout(hintClearTimer);
    if (hintPersistMs > 0 && hintLine.classList.contains('visible')) {
        hintClearTimer = setTimeout(clearHint, hintPersistMs);
    }
}
hintSecondsInput.addEventListener('input', () => saveHintSeconds(false));
hintSecondsInput.addEventListener('change', () => saveHintSeconds(true));
