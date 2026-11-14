# Greetings

Welcome to a simple tab organizer! This app reflects the state of windows and tabs in your browser session, allowing you to manage your windows and tabs easier. In other words, whatever tabs and windows are opened in your browser will automatically appear in the main app

# Install

To install, here are the instructions:

1) First, download the zip file by clicking on the green code button near the top of the page and click download ZIP. Download it to a nice location.

2) Unpack the .zip file to a folder which will contain the app. (It should unpack to a folder "tab-organizer". You want it all to be contained)

3) Depending on your version of chromium navigate (type/ copy paste the relevant link below to your address bar) to either:

- brave://extensions
- chrome://extensions
- edge://extensions
- whateverChromiumBrowserYouHave://extensions

4) In the top right corner, turn on Developer mode

5) In the top left corner, click load unpacked, then find the folder which contains the app (wherever you unpacked your zip to). MAKE SURE to pick the folder which directly contains manifest.json (i.e. when you enter the folder, manifest.json should be there. Depending on your extraction method, the folder may contain another folder which THEN contains the app)

6) Enjoy!

## Update

1) Download the ZIP and unpack in same way you did above. The ZIP should be in the same location and you should unpack the folder in the exact same way (that way the folder structure is preserved)

2) go to the relevant extension page as in step 3) above, find the Tab Organizer extension from the list and click the refresh button. Your app should be updated now!

# How to use

First, you are going to want to click the extensions button on the toolbar (the puzzle icon) and find Tab Organizer. Click the pin icon to pin it

Then when you click the symbol for Tab Organizer, it will bring you to the main app page.

Each main box is a window. Each sub item is a tab. Windows are laid out in two columns, left to right in board order; each window goes into whichever column is shorter, so a window with a few tabs stays small instead of stretching to match a big one next to it. 

## Navigation

Simply hover over and right click on a tab to instantly be brought to it! The board's own tab always shows in green, and the page is called "Reflection Board".

You can always navigate back to it by clicking the icon on the toolbar at the top, or with `Alt+Shift+Home`. The board scrolls to the window you came from and briefly highlights it.

### Tab switcher

`Alt+Shift+Q` or `Alt+Shift` + any arrow key opens the tab switcher, a list of your recently used tabs (most recent at the top, the Reflection Board included), like Alt+Tab. It works on any page, whether or not the board is open.

- `Alt+Shift+Q`, `Alt+Shift+Left` or `Alt+Shift+Down` opens it on the previous tab (pressing Q or Left again goes further back); `Alt+Shift+Right` / `Alt+Shift+Up` on the current one.
- It appears on top of the page you're on, with a green banner reading "keyboard input is captured": while it's up, your keys and clicks go to the switcher, not the page.
- Use the arrow keys to move the highlight (Left/Down = older, Right/Up = newer). You can let go of Alt+Shift.
- Press **Enter** to switch to the highlighted tab, or click a row. Esc or clicking outside the list cancels.
- Only the tab you actually switch to moves to the front of the list.
- On pages extensions aren't allowed to draw on (chrome:// pages, the web store, the new tab page, PDFs), or while you're typing in the address bar, the list opens in a small separate window instead and works the same way. (There, only Alt+Shift+Q and Alt+Shift+Left/Right open it.)

"view history in app" checkbox: when checked, switching activates the tab inside its window but keeps you where you were (e.g. on the board, so you can watch the highlight move). When unchecked, the tab's window comes to the front.

Note for Windows: `Alt+Shift` is also Windows' default shortcut for changing keyboard language. If you have more than one input language and it gets in the way, change the extension's shortcuts at `chrome://extensions/shortcuts` (or your browser's equivalent). Alt+Shift+Up/Down are handled inside pages rather than as browser shortcuts (Chrome allows an extension only four suggested shortcuts), so they can't be changed there.

## Tab icons and previews

A 🔊 next to a tab means it's playing sound and 🔇 means it's muted. Click the icon to mute or unmute without leaving the board.

"audio glow" setting (on by default): a tab that's playing sound gets a blue border that pulses every 3 seconds. It stops as soon as you mute the tab (or the sound stops).

"full preview" checkbox: hovering a tab shows a screenshot of it at 1/8 of its real size (so it keeps the tab's shape), labelled with when it was taken. Screenshots are taken shortly after you view a tab, right before you leave it with the switcher or the board button/hotkey, and every 30 seconds for the tab you're looking at, so they show the tab roughly as you left it (e.g. a paused video). A tab is never loaded just to preview it, so a tab you haven't viewed since turning this on (e.g. one restored unloaded) shows no picture until you visit it. Browser-internal pages (chrome://, the web store) can't be previewed. The extension asks for access to all websites for this feature and for drawing the tab switcher over pages; screenshots stay on your computer.

## Creating tabs and windows

You can create a new tab by clicking the "+" tile after a window's last tab, or by hovering the window and clicking the "+" in its button row. Either way the tab opens at the end of that window, in the background. You can close a tab by hovering over the tab until the "x" button appears and then you can click it.

Hovering a window box shows its buttons in a row on the same line as its title, on the right: load its tabs (see **Load all tabs** below), download, save internally, new tab, minimize, and "x" to close the window and all its tabs.

**Minimize** ("–") shrinks a window box on the board to one line showing its tabs' icons and how many there are; the real browser window isn't touched. Click that line or the "□" button to expand it again. **Minimize all** at the top minimizes every box, or expands them all when they're all minimized. Minimized boxes stay minimized when the board is reloaded or the browser restarts, and saves (internal, JSON and autosave) remember which windows were minimized. Saves made before this existed open with every window expanded.

You can open a new window by clicking the "+" outside of all the other windows. The board scrolls to the new window and highlights it (the same happens when you drag tabs out of all the boxes to make a new window). Adding a tab with a window's own "+" doesn't scroll.

Drag a window by the empty space in its box (around or between its tabs) onto another box to move it there: the top half of a box drops it before that box, the bottom half after it. The browser has no window order of its own, so the board remembers this order itself; saves and autosaves keep it, and restoring recreates the windows in that order.

Click the title box in a window to name it. Names are kept while the window stays open (including when the board is reloaded) and are included in saves.

## Drag and drop features

You can rearrange tabs within a box and it will also change the order of the tab in the main browser UI. Click, Shift+click and Ctrl+click select several tabs to drag together.

Clicking a window box's empty space (around or between its tabs) selects all of its tabs, and Ctrl+click / Shift+click work the same way as on tabs: Ctrl+click adds the window's tabs (or removes them if they're all selected already), Shift+click selects everything from the last tab you clicked through that window. Dragging the box still moves the window. Clicking empty board space outside every window clears the selection.

Whenever a tab is selected, a small toolbar appears above the selection:

- **Download** / **Save internally**: saves just the selected tabs, the same way as a window's own buttons. Each tab is saved in the window it's in now, with that window's title. To save them together as one window, move them to a new window first.
- **Move to a new window**.
- **Close** all selected tabs (same as the Delete key). Esc clears the selection.

You can drag a tab between windows by moving them to a different box

If you drag a tab outside of all the boxes, it will open that tab in a new window. It will not focus to that window, but of course you can right click on it to get immediately to the new window and its first tab.

## Saving and loading

There are two kinds of save states: **internal** and **JSON file**. Both save every window, its tabs and its title.

- **Save (Internal)** / `Ctrl+S`: saves the whole session in the browser's extension storage, using a dialog that works like a normal "Save As" window:
  - Browse folders (click to open, use the path at the top to go back), search, or click **New folder** to make one where you are.
  - Type a name and press **Save**. If that name already exists in the folder, it's highlighted as you type, and Save asks whether to replace it.
  - Click an existing save to reuse its name; double-click it to save over it straight away (after confirming).
  - Ctrl+S / Save (Internal) opens on your last whole-session save (in its folder, pre-selected), so saving over it again is one step. Saving a single window doesn't change which save that is, and autosaves never count. If you haven't saved a session yet, a dated default name is filled in, in the folder you last saved to.
  - A window's own save button (and the selection toolbar's) always starts with that window's name: its title, or the first tab's title if it has none.
- **Save window internally** (the disk icon in each window box's button row): saves just that window the same way, as a one-window session.
- **autosave** checkbox: saves your session automatically about 10 seconds after tabs or windows change, into its own slot (it never touches your named saves). When the browser starts, the last autosave is kept as "Autosave from previous browser session", so a fresh empty session can't overwrite it.
- **Load (Internal)**: browse your internal saves.
  - Folders: click a folder to open it, use the path at the top to go back. **New folder** creates one inside the folder you're in (folders can be nested). Deleting a folder asks first and also deletes everything inside it.
  - Search: the search bar finds saves by name, or by the title/URL of any tab inside them, across all folders.
  - Each save has **Add** (opens it alongside your open tabs), **Export JSON** (downloads it as a file you can load later with Upload JSON), **Load** (replaces your open tabs) and **Delete** (asks first).
  - Autosaves are in the read-only "Autosaves" folder.
- In both the Save and Load dialogs:
  - **Sort** with the dropdown next to the search bar: newest/oldest first, name A–Z/Z–A, or most/fewest tabs. Folders stay above saves and sort the same way (by their newest save, or by all the tabs inside them). The choice is remembered and shared by both dialogs.
  - **Drag** a save or a folder onto a folder to move it there (drag near the top or bottom of the list, or above/below it, to scroll), or onto a folder in the path at the top (e.g. "Top level") to move it up. Hold it over a folder for a moment (it fills up blue) to open that folder, so you can drop inside it or go further down. After a drop, the dialog opens the folder it went into, briefly highlights the moved item and says what was moved where. Moving a folder takes its subfolders and saves with it. If a save with the same name is already there, you're asked whether to replace it; a folder with the same name already there blocks the move. Autosaves can't be moved.
- **Save JSON**: downloads `tab_layout.json`. I recommend saving it in the app's "saved-tabs" folder. The download icon in each window box's button row downloads just that window.
- **Upload JSON**: replaces your open tabs with the windows in a saved file.
- **Add JSON**: opens the windows from a saved file alongside the tabs you already have.

When loading, the saved windows are created first and only then are your old tabs closed, so a bad file won't wipe your session. Restored tabs are created unloaded: they appear immediately but each page only loads when you first open it.

WARNING: some browser-internal pages (e.g. brave://extensions) can't be reopened by extensions. Any tab that can't be restored is skipped and you'll be told how many; the list is in the console (F12).

Doing a save then an upload at least once will cache that folder location (at least unless you download or upload something else).


## Pausing media

**Pause all media** (in the top bar) pauses every video and audio player in all your open tabs, using the same pause as Load all tabs, so it works on any site. The tabs stay open, and the button briefly says how many players it paused. The selection toolbar has the same pause button for just the selected tabs. Tabs that aren't loaded and browser pages are skipped.

## Load all tabs

Restored tabs, tabs the browser unloaded to save memory, and tabs that haven't loaded since the browser restarted only load when you open them. **Load all tabs** (next to Settings) loads them in the background instead. The same button is in each window box's button row (just that window) and in the selection toolbar (just the selected tabs). Tabs that are already loaded are left alone.

- Tabs load 8 at a time (the "parallel loads" setting, 1–32). While a tab is waiting, loading or being screenshotted it keeps its place on the board with a pulsing purple border, and the button counts the progress.
- Each page moves on as soon as it finishes loading, or after the "load timeout seconds" setting (default 6), so slow ads and trackers don't hold things up. Screenshots are taken separately, so the next tabs keep loading meanwhile.
- Tabs are muted while they load, and any video or audio that starts playing is paused, from the moment the page starts loading until a few seconds after it has loaded (this works on any site, including players inside embedded frames). The mute is undone afterwards.
- How long each tab took (load, screenshot) is logged in the extension's service worker console: open chrome://extensions, click "service worker" under Tab Organizer, and look for "[force load]" lines.
- A screenshot is taken of each loaded page for the hover preview. To take screenshots of tabs you aren't looking at, the extension uses Chrome's debugging interface, so Chrome shows a "Tab Organizer started debugging this browser" bar while it runs. It goes away by itself when the loading finishes.
- The loading carries on if you close or reload the board.

# To do

- add persistences to chosen tabs. I.e. on load it keeps some of your tabs
- why does the favicon url flicker on upload?
- group tabs by parent host url. It should be a hotkey and button and then on right click it expands so that you can right click again to navigate