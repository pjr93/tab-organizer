function getTabsAndWindows() {
    chrome.windows.getAll({ populate: true }, (windows) => {



        windows.forEach((win, i) => {
            const winDiv = document.createElement('div');

            winDiv.innerHTML = `<div class="window-title">Window ${i + 1}</div>`;

            const ul = document.createElement('ul');

            win.tabs.forEach(tab => {
                const li = document.createElement('li');
                li.textContent = tab.title + ' (' + tab.url + ')';
                ul.appendChild(li);
            });

            winDiv.appendChild(ul);
            output.appendChild(winDiv);
        });
    });
}

document.addEventListener('DOMContentLoaded', getTabsAndWindows);


//grabbing windows

chrome.storage.local.get("windowIds", (result) => {
  const ids = result.windowIds || [];
  ids.forEach(id => {
    chrome.windows.get(id, (window) => {
      if (chrome.runtime.lastError) {
        console.log(`Window with ID ${id} not found`);
      } else {
        console.log("Referred window object:", window);
        // Do something with the window
      }
    });
  });
});
