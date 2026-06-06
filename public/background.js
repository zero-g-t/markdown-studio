chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('editor.html')
  });
});

function storageSet(area, values) {
  return new Promise((resolve) => {
    area.set(values, resolve);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OPEN_MARKDOWN_FILE') {
    return false;
  }

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false });
    return true;
  }

  const id = crypto.randomUUID();
  const key = `markdown-file:${id}`;
  const storage = chrome.storage.session || chrome.storage.local;

  storageSet(storage, {
    [key]: {
      url: message.url,
      name: message.name,
      content: message.content
    }
  }).then(() => {
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(`editor.html?import=${encodeURIComponent(id)}`)
    });
    sendResponse({ ok: true });
  });

  return true;
});
