// In background.js

chrome.action.onClicked.addListener(() => {
  chrome.windows.getAll({ populate: true }, (windows) => {
    // Save windows array only (tabs are in each window object)
    chrome.storage.local.set({ windows });
  });
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});

chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.local.get(["windows"]).then((data) => {
    let { windows } = data;
    // Find the window in windows array with this tab's windowId
    let win = windows.find(w => w.id === tab.windowId);
    if (win) {
      win.tabs.push(tab);
      chrome.storage.local.set({ windows });
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  chrome.storage.local.get(["windows"]).then((data) => {
    let { windows } = data;
    // Find the window by windowId
    let win = windows.find(w => w.id === tab.windowId);
    if (win) {
      // Find the tab by id and update it in-place
      let idx = win.tabs.findIndex(t => t.id === tabId);
      if (idx !== -1) {
        win.tabs[idx] = tab;
        chrome.storage.local.set({ windows });
      }
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get(["windows"]).then((data) => {
    let { windows } = data;
    // Find the window by windowId
    let win = windows.find(w => w.id === removeInfo.windowId);
    if (win) {
      // Remove tab by id
      win.tabs = win.tabs.filter(t => t.id !== tabId);
      chrome.storage.local.set({ windows });
    }
  });
});

chrome.windows.onCreated.addListener((window) => {
  chrome.storage.local.get(["windows"]).then((data) => {
    let { windows } = data;
    // Add new window (sanity check if already in array)
    if (!windows.find(w => w.id === window.id)) {
      // Especially with popups/extensions, might occur
      window.tabs = window.tabs || [];
      windows.push(window);
      chrome.storage.local.set({ windows });
    }
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(["windows"]).then((data) => {
    let { windows } = data;
    // Remove window by id
    windows = windows.filter(w => w.id !== windowId);
    chrome.storage.local.set({ windows });
  });
});
