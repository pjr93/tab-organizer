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

Each main box is a window. Each sub item is a tab. 

## Navigation

Simply hover over and right click on a tab to instantly be brought to it! The main app window will always bee in green and it is called "Reflection Board"

You can always navigate back to it by click on the icon on the toolbar at the top.

## Creating tabs and windows

You can create a new tab by hovering the mouse and clicking the "+" button at the bottom right corner. You can close a tab by hovering over the tab until the "x" button appears and then you can click it.

You can also close an entire window by clicking the "x" at the top right corner of the main box. 

You can open a new window by clicking the "+" outside of all the other windows

## Drag and drop features

You can rearrange tabs within a box and it will also change the order of the tab in the main browser UI

You can drag a tab between windows by moving them to a different box

If you drag a tab outside of all the boxes, it will open that tab in a new window. It will not focus to that window, but of course you can right click on it to get immediately to the new window and its first tab.

## Saving and loading

**ATTENTION - internal save/load broken for now**

There are two kinds of save states: **internal** and **download**. 

Internal save states are states that are saved in the local chromium storage. You can save and load at will up to 50Mb I believe.

Download save states are states that are saved locally by a .json file. These have to be sent through downloads and uploads, but otherwise will save and restore all of your tabs

WARNING: I noticed brave://extensions tab not save properly. This might happen with other tabs. Let me know if you notice them

To save internally, press ```ctrl+s``` or click the ```Save (Internal)``` button. Then to load, just click the ```Load (Internal)``` button.

Download JSON will open a dialog window to save your tabs. I recommend navigating to the app folder and saving it in "saved-tabs"

Upload JSON will open a dialog window as well. Navigate to the folder where you saved your tabs and you can load from there.

Doing Download tehn Upload at least once will cache that location (at least unless you download or upload something else)


# To do

- add persistences to chosen tabs. I.e. on load it keeps some of your tabs
- refactor
- allow movement of windows like tabs
- add adaptive loading times based on number of tabs to load
- optimize: I believe there must be a faster way to do all of this. I know loading a bunch of websites at once is slow, but I still feel there must be something that could make it faster so the user doesn't have to wait long for many tabs
- why does the favicon url flicker on upload?