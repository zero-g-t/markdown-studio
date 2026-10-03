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

/*
 * 站点适配器注入白名单。
 *
 * 内容脚本只能请求注入白名单内的脚本路径，避免（哪怕是被页面篡改后的）消息请求注入任意文件。
 * 这份列表必须与 src/feishu/site-providers.js 的 PROVIDERS 保持一致：
 * 新增站点适配器时两边都要加。
 */
const SITE_DOWNLOAD_BUNDLES = new Set([
  'bundles/feishu-download.js',
  'bundles/web-download.js'
]);
const SITE_DOWNLOAD_MESSAGE = 'MD_STUDIO_SITE_DOWNLOAD';

function handleSiteDownload(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    sendResponse({ ok: false, error: '无法定位当前标签页' });
    return;
  }

  if (!SITE_DOWNLOAD_BUNDLES.has(message.bundle)) {
    sendResponse({ ok: false, error: `不支持的站点适配器：${message.bundle}` });
    return;
  }

  // 转换器必须处于页面自身的 JS 上下文：
  //   · 飞书分支要读飞书页面运行时全局对象（window.PageMain）；
  //   · 通用网页分支要读 shadowRoot、并用页面上下文落盘。
  // 因此统一注入到 MAIN world。
  chrome.scripting
    .executeScript({
      files: [message.bundle],
      target: { tabId },
      world: 'MAIN'
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === SITE_DOWNLOAD_MESSAGE) {
    handleSiteDownload(message, sender, sendResponse);
    return true;
  }

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
